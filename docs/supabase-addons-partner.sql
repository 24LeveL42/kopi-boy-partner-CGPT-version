-- KOPI BOY PARTNER — Add-ons (A3 + A4): cooks save a dish's add-on groups
-- and options in one go.
--
-- DO NOT RUN UNTIL THE APP IS DEPLOYED.
-- The Partner app's add-ons editor goes out first; until this file runs,
-- saving changed add-ons shows "Add-ons can't be saved yet" (the dish itself
-- still saves) and nothing else changes. The quick Sold out switch doesn't
-- need this file: it updates public.menu_options directly under RLS.
--
-- Builds on the add-ons tables already live (menu_option_groups,
-- menu_options, order_item_options, order_items.options_price) and their RLS:
-- a cook reads and writes the groups and options of their own kitchen's
-- dishes (menu_items.kitchen_id = auth.uid()). FKs: menu_options -> groups
-- and groups -> menu_items are ON DELETE CASCADE; order_item_options.option_id
-- is ON DELETE SET NULL, so deleting an option never touches order history.
--
-- Adds one function:
--   public.save_menu_item_options(p_menu_item_id uuid, p_groups jsonb)
--     p_groups: [{ "id"?: uuid, "name": text, "required": bool,
--                  "max_picks": int, "options": [{ "id"?: uuid, "name": text,
--                  "price": number, "sold_out": bool }] }]
--     Array order is the sort order. Groups/options with an id are updated
--     (only if they belong to THIS dish, else option_not_for_item), ones
--     without are inserted, and the dish's groups/options not in the payload
--     are deleted. Returns the dish's saved groups and options as jsonb.
--
-- SECURITY INVOKER: runs as the cook, so the tables' RLS still decides what
-- it may touch; the explicit checks below come on top. One statement, so one
-- transaction: any error leaves the dish's add-ons as they were.
--
-- The 20 groups per dish / 30 options per group limits are enforced here
-- (there are no count triggers).
--
-- Safe to run again: create or replace, and grants are idempotent. No data
-- is changed by running it.
--
-- Every name is schema-qualified and search_path = ''.


-- ############################################################################
-- 1. public.save_menu_item_options
-- ############################################################################

create or replace function public.save_menu_item_options(p_menu_item_id uuid, p_groups jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_group jsonb;
  v_option jsonb;
  v_group_id uuid;
  v_option_id uuid;
  v_group_ids uuid[] := '{}';
  v_option_ids uuid[] := '{}';
  v_gi integer;
  v_oi integer;
  v_name text;
  v_price numeric;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  if not exists (
    select 1 from public.profiles pr
    where pr.id = v_uid and pr.role = 'cook' and pr.is_active
  ) then
    raise exception 'not_a_cook';
  end if;

  -- The dish must be this cook's. FOR UPDATE: two saves of the same dish
  -- run one after the other instead of interleaving.
  perform 1
  from public.menu_items m
  where m.id = p_menu_item_id and m.kitchen_id = v_uid
  for update;
  if not found then
    raise exception 'item_not_in_kitchen';
  end if;

  -- ---- 1. Check the whole payload before writing anything ----------------
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'options_invalid';
  end if;
  if jsonb_array_length(p_groups) > 20 then
    raise exception 'too_many_groups';
  end if;

  for v_group in select g.value from jsonb_array_elements(p_groups) as g(value) loop
    if jsonb_typeof(v_group) <> 'object' then
      raise exception 'options_invalid';
    end if;

    v_name := btrim(coalesce(v_group->>'name', ''));
    if v_name = '' or char_length(v_name) > 60 then
      raise exception 'options_invalid';
    end if;
    if coalesce(jsonb_typeof(v_group->'max_picks'), '') <> 'number'
       or (v_group->>'max_picks') !~ '^[0-9]+$'
       or (v_group->>'max_picks')::numeric not between 1 and 20 then
      raise exception 'options_invalid';
    end if;
    if coalesce(jsonb_typeof(v_group->'required'), 'boolean') <> 'boolean' then
      raise exception 'options_invalid';
    end if;

    if coalesce(jsonb_typeof(v_group->'options'), '') <> 'array' or jsonb_array_length(v_group->'options') = 0 then
      raise exception 'options_invalid';
    end if;
    if jsonb_array_length(v_group->'options') > 30 then
      raise exception 'too_many_options';
    end if;

    if nullif(v_group->>'id', '') is not null then
      if (v_group->>'id') !~ v_uuid_re then
        raise exception 'options_invalid';
      end if;
      v_group_id := (v_group->>'id')::uuid;
      if v_group_id = any (v_group_ids) then
        raise exception 'options_invalid';
      end if;
      v_group_ids := v_group_ids || v_group_id;
    end if;

    for v_option in select o.value from jsonb_array_elements(v_group->'options') as o(value) loop
      if jsonb_typeof(v_option) <> 'object' then
        raise exception 'options_invalid';
      end if;

      v_name := btrim(coalesce(v_option->>'name', ''));
      if v_name = '' or char_length(v_name) > 60 then
        raise exception 'options_invalid';
      end if;
      if coalesce(jsonb_typeof(v_option->'price'), '') <> 'number' then
        raise exception 'options_invalid';
      end if;
      v_price := (v_option->>'price')::numeric;
      if v_price < 0 or v_price > 999 or v_price <> round(v_price, 2) then
        raise exception 'options_invalid';
      end if;
      if coalesce(jsonb_typeof(v_option->'sold_out'), 'boolean') <> 'boolean' then
        raise exception 'options_invalid';
      end if;

      if nullif(v_option->>'id', '') is not null then
        if (v_option->>'id') !~ v_uuid_re then
          raise exception 'options_invalid';
        end if;
        v_option_id := (v_option->>'id')::uuid;
        if v_option_id = any (v_option_ids) then
          raise exception 'options_invalid';
        end if;
        v_option_ids := v_option_ids || v_option_id;
      end if;
    end loop;
  end loop;

  -- ---- 2. Every id sent must belong to THIS dish -------------------------
  if exists (
    select 1 from unnest(v_group_ids) as x(id)
    where not exists (
      select 1 from public.menu_option_groups g
      where g.id = x.id and g.menu_item_id = p_menu_item_id
    )
  ) then
    raise exception 'option_not_for_item';
  end if;

  if exists (
    select 1 from unnest(v_option_ids) as x(id)
    where not exists (
      select 1
      from public.menu_options o
      join public.menu_option_groups g on g.id = o.group_id
      where o.id = x.id and g.menu_item_id = p_menu_item_id
    )
  ) then
    raise exception 'option_not_for_item';
  end if;

  -- ---- 3. Delete the options the cook removed ----------------------------
  delete from public.menu_options o
  using public.menu_option_groups g
  where g.id = o.group_id
    and g.menu_item_id = p_menu_item_id
    and not (o.id = any (v_option_ids));

  -- ---- 4. Update the rest, insert the new ones ---------------------------
  for v_group, v_gi in
    select g.value, (g.ord - 1)::integer from jsonb_array_elements(p_groups) with ordinality as g(value, ord)
  loop
    v_group_id := nullif(v_group->>'id', '')::uuid;
    if v_group_id is null then
      insert into public.menu_option_groups (menu_item_id, name, required, max_picks, sort_order)
      values (
        p_menu_item_id,
        btrim(v_group->>'name'),
        coalesce((v_group->>'required')::boolean, false),
        (v_group->>'max_picks')::integer,
        v_gi
      )
      returning id into v_group_id;
      v_group_ids := v_group_ids || v_group_id; -- kept by step 5
    else
      update public.menu_option_groups g set
        name = btrim(v_group->>'name'),
        required = coalesce((v_group->>'required')::boolean, false),
        max_picks = (v_group->>'max_picks')::integer,
        sort_order = v_gi
      where g.id = v_group_id and g.menu_item_id = p_menu_item_id;
      if not found then
        raise exception 'option_not_for_item';
      end if;
    end if;

    for v_option, v_oi in
      select o.value, (o.ord - 1)::integer from jsonb_array_elements(v_group->'options') with ordinality as o(value, ord)
    loop
      v_option_id := nullif(v_option->>'id', '')::uuid;
      if v_option_id is null then
        insert into public.menu_options (group_id, name, price, sold_out, sort_order)
        values (
          v_group_id,
          btrim(v_option->>'name'),
          (v_option->>'price')::numeric,
          coalesce((v_option->>'sold_out')::boolean, false),
          v_oi
        );
      else
        -- group_id may change: an option can move between this dish's groups.
        update public.menu_options o set
          group_id = v_group_id,
          name = btrim(v_option->>'name'),
          price = (v_option->>'price')::numeric,
          sold_out = coalesce((v_option->>'sold_out')::boolean, false),
          sort_order = v_oi
        where o.id = v_option_id
          and exists (
            select 1 from public.menu_option_groups g
            where g.id = o.group_id and g.menu_item_id = p_menu_item_id
          );
        if not found then
          raise exception 'option_not_for_item';
        end if;
      end if;
    end loop;
  end loop;

  -- ---- 5. Delete the groups the cook removed -----------------------------
  -- Last, so an option moved out of a removed group has already moved and
  -- isn't cascaded away; anything still in them was deleted in step 3.
  delete from public.menu_option_groups g
  where g.menu_item_id = p_menu_item_id
    and not (g.id = any (v_group_ids));

  -- ---- 6. Hand back what's saved, in order -------------------------------
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'required', g.required,
          'max_picks', g.max_picks,
          'options', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'sold_out', o.sold_out)
                order by o.sort_order, o.created_at
              ),
              '[]'::jsonb
            )
            from public.menu_options o
            where o.group_id = g.id
          )
        )
        order by g.sort_order, g.created_at
      ),
      '[]'::jsonb
    )
    from public.menu_option_groups g
    where g.menu_item_id = p_menu_item_id
  );
end;
$$;

revoke all on function public.save_menu_item_options(uuid, jsonb) from public, anon;
grant execute on function public.save_menu_item_options(uuid, jsonb) to authenticated;


-- ############################################################################
-- HOW TO CHECK (read-only)
-- ############################################################################
--
-- The function exists, is SECURITY INVOKER and has search_path = '':
--   select p.proname, p.prosecdef, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'save_menu_item_options';
--   -- expect prosecdef = false, proconfig = {search_path=""}
--
-- Only authenticated can run it:
--   select has_function_privilege('anon', 'public.save_menu_item_options(uuid, jsonb)', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.save_menu_item_options(uuid, jsonb)', 'execute') as authenticated;
--   -- expect anon = false, authenticated = true
--
-- The grants the function and the app's Sold out switch rely on (run as the
-- function is SECURITY INVOKER, the cook needs all of these):
--   select t.table_name,
--          has_table_privilege('authenticated', 'public.' || t.table_name, 'select') as sel,
--          has_table_privilege('authenticated', 'public.' || t.table_name, 'insert') as ins,
--          has_table_privilege('authenticated', 'public.' || t.table_name, 'update') as upd,
--          has_table_privilege('authenticated', 'public.' || t.table_name, 'delete') as del
--   from (values ('menu_option_groups'), ('menu_options'), ('order_item_options')) as t(table_name);
--   -- expect all true for menu_option_groups and menu_options (UPDATE on
--   -- menu_options is what the Sold out switch needs); sel true for
--   -- order_item_options
--
-- The lock on the dish (FOR UPDATE) needs the cook's existing UPDATE right on
-- their own menu_items, which the menu editor already uses.
