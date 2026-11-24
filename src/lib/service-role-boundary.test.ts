import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * src/lib/supabase/admin.ts builds the service-role client (bypasses RLS).
 * The "server-only" package isn't installed, so this test is the guard:
 *  - only route handlers (src/app/**\/route.ts) may reach it, directly or
 *    through the claim route helper (src/lib/claim-route.ts);
 *  - no "use client" file, and nothing a client file imports, may reach it;
 *  - SUPABASE_SERVICE_ROLE_KEY is read only where it already was.
 * Type-only imports are ignored (they are erased at build time).
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const ADMIN = "src/lib/supabase/admin.ts";
/** Server helpers that may import admin.ts; they in turn may only be imported by route handlers. */
const ROUTE_HELPERS = new Set(["src/lib/claim-route.ts"]);
const SERVICE_KEY_READERS = new Set([ADMIN, "src/app/api/push/send/route.ts"]);

type Files = Map<string, string>; // repo-relative path (posix) → source

function readSrc(): Files {
  const files: Files = new Map();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
        files.set(path.relative(ROOT, full).split(path.sep).join("/"), readFileSync(full, "utf8"));
      }
    }
  };
  walk(SRC);
  for (const top of ["middleware.ts", "next.config.ts"]) {
    try {
      files.set(top, readFileSync(path.join(ROOT, top), "utf8"));
    } catch {
      // not present
    }
  }
  return files;
}

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^"'`;]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    if (m[1]) continue; // import type / export type
    out.push(m[2] ?? m[3]);
  }
  return out;
}

function resolve(from: string, spec: string, files: Files): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null; // a package
  const stem = base.replace(/\.(ts|tsx|js|jsx)$/, "");
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

const isClient = (source: string) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source);
const isRouteHandler = (file: string) => /^src\/app\/(?:.+\/)?route\.(ts|js)$/.test(file);

/** Every rule broken in this set of files (empty = fine). */
export function boundaryViolations(files: Files): string[] {
  const graph = new Map<string, string[]>();
  for (const [file, source] of files) {
    graph.set(file, specifiers(source).map((s) => resolve(file, s, files)).filter((r): r is string => r !== null));
  }

  // Files that reach admin.ts, directly or not.
  const reaches = new Map<string, boolean>();
  const reachesAdmin = (file: string, seen = new Set<string>()): boolean => {
    if (file === ADMIN) return true;
    if (reaches.has(file)) return reaches.get(file)!;
    if (seen.has(file)) return false;
    seen.add(file);
    const result = (graph.get(file) ?? []).some((dep) => reachesAdmin(dep, seen));
    reaches.set(file, result);
    return result;
  };

  const problems: string[] = [];
  for (const [file, source] of files) {
    if (file === ADMIN || !reachesAdmin(file)) continue;
    if (isClient(source)) problems.push(`${file} is a "use client" file and reaches ${ADMIN}`);
    else if (!isRouteHandler(file) && !ROUTE_HELPERS.has(file)) problems.push(`${file} reaches ${ADMIN} but is not a route handler`);
  }
  // Route helpers: imported only by route handlers.
  for (const [file, deps] of graph) {
    for (const dep of deps) {
      if (ROUTE_HELPERS.has(dep) && !isRouteHandler(file)) problems.push(`${file} imports ${dep}, which only route handlers may import`);
    }
  }
  for (const [file, source] of files) {
    if (source.includes("SUPABASE_SERVICE_ROLE_KEY") && !file.endsWith(".test.ts") && !SERVICE_KEY_READERS.has(file)) {
      problems.push(`${file} reads SUPABASE_SERVICE_ROLE_KEY`);
    }
  }
  return problems;
}

describe("service-role client boundary", () => {
  const files = readSrc();

  it("admin.ts exists and the claim routes really use it (the check isn't vacuous)", () => {
    assert.ok(files.has(ADMIN));
    const graph = (f: string) => specifiers(files.get(f)!).map((s) => resolve(f, s, files));
    assert.ok(graph("src/lib/claim-route.ts").includes(ADMIN));
    assert.ok(graph("src/app/api/claim/preview/route.ts").includes("src/lib/claim-route.ts"));
    assert.ok(graph("src/app/api/claim/complete/route.ts").includes("src/lib/claim-route.ts"));
  });

  it("only route handlers reach admin.ts; no client component does", () => {
    assert.deepEqual(boundaryViolations(files), []);
  });

  it("catches a client component that imports admin.ts directly or through a helper", () => {
    const bad: Files = new Map(files);
    bad.set("src/components/Leaky.tsx", `"use client";\nimport { createAdminClient } from "@/lib/supabase/admin";\n`);
    bad.set("src/lib/leaky-helper.ts", `import { claimRouteDeps } from "./claim-route";\n`);
    bad.set("src/components/Leaky2.tsx", `'use client'\nimport { x } from "../lib/leaky-helper.ts";\n`);
    bad.set("src/app/kitchen/leaky-page.tsx", `import { createAdminClient } from "@/lib/supabase/admin";\n`);
    const problems = boundaryViolations(bad);
    assert.ok(problems.some((p) => p.startsWith("src/components/Leaky.tsx is a \"use client\" file")));
    assert.ok(problems.some((p) => p.startsWith("src/components/Leaky2.tsx is a \"use client\" file")));
    assert.ok(problems.some((p) => p.startsWith("src/lib/leaky-helper.ts imports src/lib/claim-route.ts")));
    assert.ok(problems.some((p) => p.startsWith("src/app/kitchen/leaky-page.tsx reaches")));
  });

  it("ignores type-only imports", () => {
    const ok: Files = new Map(files);
    ok.set("src/components/Typed.tsx", `"use client";\nimport type { SupabaseClient } from "@/lib/supabase/admin";\n`);
    assert.deepEqual(boundaryViolations(ok), []);
  });
});
