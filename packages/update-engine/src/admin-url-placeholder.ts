/**
 * Placeholder origin baked into every admin build by release.yml.
 *
 * The admin bundle is built once per release and its build tooling (Next.js)
 * needs *some* value for the API origin at compile time, but the real Worker
 * origin isn't known until install/deploy time. `__LH_WORKER_URL__` stands in
 * for it. Two different consumers reconcile the placeholder afterwards,
 * depending on deployment topology:
 *
 *   - Per-tenant builds and self-hosted installs, where the admin is served
 *     from a different host than the Worker API: {@link materializeAdminFiles}
 *     (materialize.ts) rewrites every occurrence to that install's real
 *     Worker origin before the files are ever served.
 *   - Shared builds served by the tenant Worker itself, where the admin and
 *     the API share one origin: nothing rewrites the placeholder (one build
 *     is reused across every tenant, so there is no single URL to bake in).
 *     The admin instead resolves it at runtime — see
 *     `apps/web/src/lib/api-base.ts` — by detecting the still-unsubstituted
 *     placeholder and falling back to the browser's own origin.
 *
 * Exported from both the Node-side entry point (`.`) and the browser-safe
 * entry point (`./pure`) because both the CLI/Worker materialization code
 * and the browser-side admin runtime need to agree on the exact same
 * placeholder string.
 */
export const ADMIN_URL_PLACEHOLDER = 'https://__LH_WORKER_URL__';
