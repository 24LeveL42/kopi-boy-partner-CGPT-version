-- KOPI BOY PARTNER — Phase C1: cooks create and manage their own deals.
--
-- DO NOT RUN UNTIL THE APP IS DEPLOYED.
-- The Partner app's Promotions & Deals screen goes out first; until this file
-- runs, saving a deal shows "Deals can't be saved yet" (no write policies, no
-- grants, no save_my_promotion) and nothing else changes.
--
-- Builds on the Customer repo's docs/supabase-promotions.sql (PART 1 and
-- PART 2 must already be live: promotions, promotion_items, kitchen_deal_bans,
-- app_settings, orders.promotion_id). That file gives READ policies only; this
-- one adds the cook's writes:
--   1. write policies: a cook inserts, updates and deletes only their own
--      promotions and promotion_items
--   2. column grants limited to what the cook needs
--   3. guard triggers (SECURITY INVOKER, so current_user is the caller):
--      for cook writes only (current_user anon/authenticated and not an
--      admin) they keep the server- and Boss-owned columns, stamp
--      updated_at, keep every item in the cook's own kitchen, and lock the
--      offer of a deal that has orders
--   4. public.save_my_promotion(p jsonb, item_ids uuid[]) — the deal and its
--      items in one transaction (SECURITY INVOKER: the policies, grants and
--      guards above all still apply)
--
-- Nothing existing is weakened: the read policies, the revoke-all-then-grant-
-- select baseline, place_order, the release trigger and every view are left
-- as they are. service_role, postgres, cron and SECURITY DEFINER functions
-- (place_order, orders_release_promotion, release_stale_promotions) pass the
-- guards untouched. Foreign-key cascades also run as the table owner, so a
-- cook deleting a menu item still cascades its promotion_items rows; the
-- Partner app warns before that (KitchenSetupForm).
--
-- Safe to run again: create or replace, drop ... if exists before every
-- policy and trigger, and grants are idempotent. No data is changed.
--
-- Every function here uses search_path = '' and schema-qualifies every name.

create schema if not exists private;


-- ############################################################################
-- 1. WRITE POLICIES
-- A cook is an active profile with role 'cook' and a kitchen. A kitchen
-- banned from deals (kitchen_deal_bans) can still stop or delete its deals,
-- but not create one or leave one switched on.
-- ############################################################################

drop policy if exists "Cooks can create their own promotions" on public.promotions;
create policy "Cooks can create their own promotions"
  on public.promotions for insert
  to authenticated
  with check (
    auth.uid() = kitchen_id
    and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'cook' and pr.is_active)
    and exists (select 1 from public.kitchens k where k.id = auth.uid())
    and not exists (select 1 from public.kitchen_deal_bans b where b.kitchen_id = auth.uid())
  );

drop policy if exists "Cooks can update their own promotions" on public.promotions;
create policy "Cooks can update their own promotions"
  on public.promotions for update
  to authenticated
  using (
    auth.uid() = kitchen_id
    and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'cook' and pr.is_active)
  )
  with check (
    auth.uid() = kitchen_id
    and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'cook' and pr.is_active)
    and (not is_active or not exists (select 1 from public.kitchen_deal_bans b where b.kitchen_id = auth.uid()))
  );

drop policy if exists "Cooks can delete their own promotions" on public.promotions;
create policy "Cooks can delete their own promotions"
  on public.promotions for delete
  to authenticated
  using (
    auth.uid() = kitchen_id
    and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'cook' and pr.is_active)
  );

drop policy if exists "Cooks can add items to their own promotions" on public.promotion_items;
create policy "Cooks can add items to their own promotions"
  on public.promotion_items for insert
  to authenticated
  with check (
    exists (select 1 from public.promotions p where p.id = promotion_items.promotion_id and p.kitchen_id = auth.uid())
    and exists (select 1 from public.menu_items m where m.id = promotion_items.menu_item_id and m.kitchen_id = auth.uid())
    and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'cook' and pr.is_active)
  );

drop policy if exists "Cooks can remove items from their own promotions" on public.promotion_items;
create policy "Cooks can remove items from their own promotions"
  on public.promotion_items for delete
  to authenticated
  using (
    exists (select 1 from public.promotions p where p.id = promotion_items.promotion_id and p.kitchen_id = auth.uid())
    and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'cook' and pr.is_active)
  );


-- ############################################################################
-- 2. GRANTS — only the columns a cook writes
-- Not granted, so never writable from a browser: id, quantity_claimed,
-- disabled_by_admin_at, disabled_reason, created_at, updated_at (insert) and
-- also kitchen_id (update). The guard below re-asserts them anyway. No
-- update on promotion_items (rows are added or removed, never changed).
-- Nothing for anon.
-- ############################################################################

grant insert (kitchen_id, kind, title, description, terms, percent_off, amount_off, buy_qty, get_qty,
              min_spend, deal_price, free_item_id, quantity_limit, per_customer_limit, starts_at, ends_at, is_active)
  on public.promotions to authenticated;
grant update (kind, title, description, terms, percent_off, amount_off, buy_qty, get_qty,
              min_spend, deal_price, free_item_id, quantity_limit, per_customer_limit, starts_at, ends_at, is_active)
  on public.promotions to authenticated;
grant delete on public.promotions to authenticated;
grant insert, delete on public.promotion_items to authenticated;


-- ############################################################################
-- 3. GUARDS
-- SECURITY INVOKER (like the Customer repo's orders_client_guard), so
-- current_user is the caller: only anon/authenticated are checked, and an
-- admin (public.has_role('admin')) passes through for the Boss screens.
-- The guards read orders and menu_items as the cook, which the existing
-- "Cooks can read orders placed at their kitchen" and "Cooks can manage their
-- own menu items" policies allow for the cook's own kitchen.
--
-- "Has orders" = quantity_claimed > 0 OR any order points at the deal, in
-- any status: cancelling gives quantity_claimed back, but the order still
-- records the deal it used. (Written out in each guard rather than in a
-- helper: the guards run as the cook, who has no access to schema private.)
--
-- Errors (the Partner app turns these into words, src/lib/promotions.ts):
--   promotion_locked      the offer of a deal with orders can't change
--   promotion_has_orders  a deal with orders can't be deleted
--   promotion_ended       a new/changed end time, or switching on, after the end
--   promotion_invalid     the kind's own numbers are missing
--   item_not_in_kitchen   an item or free item from another kitchen
--   promotion_not_found   the deal isn't the cook's
-- ############################################################################

create or replace function private.promotions_cook_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_has_orders boolean := false;
  v_offer_changed boolean := true;
begin
  if current_user not in ('anon', 'authenticated') or public.has_role('admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then
    v_has_orders := old.quantity_claimed > 0
      or exists (select 1 from public.orders o where o.promotion_id = old.id);
  end if;

  if tg_op = 'DELETE' then
    if v_has_orders then
      raise exception 'promotion_has_orders';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Server- and Boss-owned columns start clean.
    new.kitchen_id := auth.uid();
    new.quantity_claimed := 0;
    new.disabled_by_admin_at := null;
    new.disabled_reason := null;
    new.created_at := now();
    new.updated_at := now();
    -- "Start now" is sent with the browser's clock; never let it start in the past.
    if new.starts_at < now() then
      new.starts_at := now();
    end if;
    if new.ends_at <= now() then
      raise exception 'promotion_ended';
    end if;
  else
    -- Server- and Boss-owned columns keep their values.
    new.id := old.id;
    new.kitchen_id := old.kitchen_id;
    new.quantity_claimed := old.quantity_claimed;
    new.disabled_by_admin_at := old.disabled_by_admin_at;
    new.disabled_reason := old.disabled_reason;
    new.created_at := old.created_at;
    new.updated_at := now();

    v_offer_changed := (new.kind, new.percent_off, new.amount_off, new.buy_qty, new.get_qty, new.min_spend,
                        new.deal_price, new.free_item_id, new.quantity_limit, new.per_customer_limit, new.starts_at)
      is distinct from (old.kind, old.percent_off, old.amount_off, old.buy_qty, old.get_qty, old.min_spend,
                        old.deal_price, old.free_item_id, old.quantity_limit, old.per_customer_limit, old.starts_at);

    if v_has_orders and v_offer_changed then
      raise exception 'promotion_locked';
    end if;
    if new.starts_at is distinct from old.starts_at and new.starts_at < now() then
      new.starts_at := now();
    end if;
    if new.ends_at is distinct from old.ends_at and new.ends_at <= now() then
      raise exception 'promotion_ended';
    end if;
    -- A stopped deal may be switched on again only while its end is ahead.
    if new.is_active and not old.is_active and new.ends_at <= now() then
      raise exception 'promotion_ended';
    end if;
  end if;

  -- The kind's own numbers, checked only when the offer is new or changing,
  -- so a deal whose free item was since deleted can still be stopped.
  if v_offer_changed then
    if not (case new.kind
      when 'percent_off' then new.percent_off is not null
      when 'amount_off' then new.amount_off is not null
      when 'buy_x_get_y' then new.buy_qty is not null and new.get_qty is not null
      when 'free_item' then new.free_item_id is not null
      when 'min_spend' then new.min_spend is not null and (new.percent_off is not null or new.amount_off is not null)
      when 'limited_qty' then new.deal_price is not null or new.percent_off is not null or new.amount_off is not null
      when 'flash' then new.deal_price is not null or new.percent_off is not null or new.amount_off is not null
      else false
    end) then
      raise exception 'promotion_invalid';
    end if;

    if new.free_item_id is not null and not exists (
      select 1 from public.menu_items m where m.id = new.free_item_id and m.kitchen_id = new.kitchen_id
    ) then
      raise exception 'item_not_in_kitchen';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.promotions_cook_guard() from public, anon, authenticated;

drop trigger if exists promotions_cook_guard on public.promotions;
create trigger promotions_cook_guard
  before insert or update or delete on public.promotions
  for each row execute function private.promotions_cook_guard();

create or replace function private.promotion_items_cook_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_promotion public.promotions;
  v_promotion_id uuid;
begin
  if current_user not in ('anon', 'authenticated') or public.has_role('admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_promotion_id := case when tg_op = 'DELETE' then old.promotion_id else new.promotion_id end;
  select * into v_promotion from public.promotions p where p.id = v_promotion_id;
  if not found or v_promotion.kitchen_id is distinct from auth.uid() then
    raise exception 'promotion_not_found';
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1 from public.menu_items m where m.id = new.menu_item_id and m.kitchen_id = v_promotion.kitchen_id
  ) then
    raise exception 'item_not_in_kitchen';
  end if;

  if v_promotion.quantity_claimed > 0
    or exists (select 1 from public.orders o where o.promotion_id = v_promotion.id) then
    raise exception 'promotion_locked';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.promotion_items_cook_guard() from public, anon, authenticated;

drop trigger if exists promotion_items_cook_guard on public.promotion_items;
create trigger promotion_items_cook_guard
  before insert or delete on public.promotion_items
  for each row execute function private.promotion_items_cook_guard();


-- ############################################################################
-- 4. SAVE MY PROMOTION — the deal and its eligible items in one transaction
-- p: the promotion's cook-editable fields as JSON; with "id" it updates that
-- deal, without it creates one. item_ids: the eligible menu items (empty =
-- whole menu); only the difference is written, so saving a locked deal with
-- its items unchanged writes no promotion_items rows. Returns the deal's id.
-- SECURITY INVOKER: runs as the cook, so the policies, grants and guards
-- above decide what it may do.
-- ############################################################################

create or replace function public.save_my_promotion(p jsonb, item_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.promotions;
  v_id uuid;
  v_items uuid[] := coalesce(item_ids, '{}');
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  v := jsonb_populate_record(null::public.promotions, p);
  v_id := nullif(p->>'id', '')::uuid;

  if v_id is null then
    insert into public.promotions (
      kitchen_id, kind, title, description, terms, percent_off, amount_off, buy_qty, get_qty,
      min_spend, deal_price, free_item_id, quantity_limit, per_customer_limit, starts_at, ends_at
    ) values (
      auth.uid(), v.kind, btrim(v.title), v.description, v.terms, v.percent_off, v.amount_off, v.buy_qty, v.get_qty,
      v.min_spend, v.deal_price, v.free_item_id, v.quantity_limit, v.per_customer_limit, v.starts_at, v.ends_at
    )
    returning id into v_id;
  else
    update public.promotions pr set
      kind = v.kind,
      title = btrim(v.title),
      description = v.description,
      terms = v.terms,
      percent_off = v.percent_off,
      amount_off = v.amount_off,
      buy_qty = v.buy_qty,
      get_qty = v.get_qty,
      min_spend = v.min_spend,
      deal_price = v.deal_price,
      free_item_id = v.free_item_id,
      quantity_limit = v.quantity_limit,
      per_customer_limit = v.per_customer_limit,
      starts_at = v.starts_at,
      ends_at = v.ends_at
    where pr.id = v_id;
    if not found then
      raise exception 'promotion_not_found';
    end if;
  end if;

  delete from public.promotion_items pi
  where pi.promotion_id = v_id
    and not (pi.menu_item_id = any (v_items));

  insert into public.promotion_items (promotion_id, menu_item_id)
  select v_id, s.menu_item_id
  from (select distinct unnest(v_items) as menu_item_id) s
  where not exists (
    select 1 from public.promotion_items pi
    where pi.promotion_id = v_id and pi.menu_item_id = s.menu_item_id
  );

  return v_id;
end;
$$;

revoke all on function public.save_my_promotion(jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.save_my_promotion(jsonb, uuid[]) to authenticated;


-- ############################################################################
-- HOW TO CHECK (read-only)
-- ############################################################################
-- 1. The new policies:
--      select tablename, policyname, cmd from pg_policies
--      where tablename in ('promotions', 'promotion_items') order by 1, 3, 2;
-- 2. What authenticated may write (expect insert/update on the listed
--    columns only, delete on promotions; insert/delete on promotion_items):
--      select table_name, privilege_type, column_name from information_schema.column_privileges
--      where grantee = 'authenticated' and table_name = 'promotions' and privilege_type in ('INSERT', 'UPDATE')
--      order by 2, 3;
--      select table_name, privilege_type from information_schema.role_table_grants
--      where grantee in ('anon', 'authenticated') and table_name in ('promotions', 'promotion_items') order by 1, 2;
-- 3. The guards are in place:
--      select tgrelid::regclass, tgname from pg_trigger
--      where tgname in ('promotions_cook_guard', 'promotion_items_cook_guard');
-- 4. Who may run save_my_promotion (expect authenticated only):
--      select grantee, privilege_type from information_schema.routine_privileges
--      where routine_name = 'save_my_promotion';
-- 5. Then test from the Partner app with a cook account: create, edit, stop,
--    switch on, delete a deal; try editing the offer of a deal with an order
--    (expect the locked message); save the menu with a deal's only item removed.
