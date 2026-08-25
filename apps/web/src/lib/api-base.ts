import { ADMIN_URL_PLACEHOLDER } from '@line-harness/update-engine/pure'

/**
 * Resolve the admin UI's API base origin.
 *
 * `NEXT_PUBLIC_API_URL` is read at build time by Next.js and inlined as a
 * literal string into the bundle — there's no way around that, it's how
 * Next.js env vars work. What varies is what that literal turns out to be:
 *
 *   - Per-tenant builds and self-hosted installs: the release pipeline
 *     builds with `NEXT_PUBLIC_API_URL=https://__LH_WORKER_URL__` and the
 *     deploy step (`materializeAdminFiles`, see
 *     `@line-harness/update-engine`'s materialize.ts) rewrites that
 *     placeholder to the real Worker origin before the files are served.
 *     The bundle ends up with the real origin baked in, so we just use it.
 *   - Shared builds, reused unmodified across every tenant: nothing
 *     rewrites the placeholder (there is no single "real" URL to bake into
 *     one build shared by many tenants), so the literal string is still
 *     `https://__LH_WORKER_URL__` when this code runs. In that layout the
 *     admin is served by the tenant Worker itself, so the browser's own
 *     origin *is* the API origin — no configuration needed.
 *
 * This lets one shared build correctly serve every tenant while the
 * existing per-tenant-build and self-hosted paths keep working exactly as
 * they do today (their bundles never contain the placeholder by the time a
 * browser loads them, so the fallback branch never triggers for them).
 *
 * Returns `undefined` if `NEXT_PUBLIC_API_URL` was never set at all — the
 * same "unconfigured" signal `process.env.NEXT_PUBLIC_API_URL` gave before,
 * callers keep deciding what to do about that (throw, show a banner, fall
 * back to an empty string, ...).
 *
 * Browser-only fallback: `window` doesn't exist during the Node-side static
 * prerender pass (`next build` with `output: 'export'` renders each
 * 'use client' page once in Node to produce its initial HTML). If this runs
 * there with an unsubstituted placeholder, it returns the placeholder
 * unchanged rather than resolving anything — that value is only ever used
 * for a one-time prerendered snapshot, never for an actual fetch, since
 * fetches happen from effects/handlers that only run after the browser
 * hydrates the page (at which point `window` is defined and the real
 * origin is used).
 */
export function getApiBase(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_API_URL
  if (!configured || configured !== ADMIN_URL_PLACEHOLDER) {
    return configured
  }
  return typeof window !== 'undefined' ? window.location.origin : configured
}
