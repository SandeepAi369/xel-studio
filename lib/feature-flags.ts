/**
 * Feature Flags — XeL Studio
 *
 * Centralised, single-source-of-truth for the Advanced AIO (AI Optimisation)
 * feature set described in the Principal Web Architect audit.
 *
 * ──────────────────────────────────────────────────────────────────
 * KILL-SWITCH ARCHITECTURE
 * ──────────────────────────────────────────────────────────────────
 * Every new dynamic route introduced for AI / LLM optimisation
 * (e.g. /articles.txt, /llms-full.txt, content-negotiation API,
 * .md / .txt mirrors, slug aliases) MUST gate its behaviour on
 * `ENABLE_ADVANCED_AIO`.
 *
 *  • Default ............................... ENABLED  (true)
 *  • Toggle to "false" in env .................. DISABLED → graceful
 *    404 (no 500s, no broken renders).
 *
 * Reading the flag:
 *   - `isAdvancedAIOLoaded()`  → boolean (defaults to true)
 *   - `advancedAIOResponse()` → returns the body or a 404 NextResponse
 *     so route handlers can do a one-liner early-return.
 *
 * This file MUST NOT import anything that touches the filesystem
 * or the network — it's hot-path safe for proxy.ts and route handlers.
 */

export type AdvancedAIOFlag = boolean;

/**
 * Returns true unless the env var is explicitly the literal string "false".
 *
 * Accepted disabling values: "false", "0", "off", "no" (case-insensitive).
 * Everything else (including undefined) means ENABLED.
 */
export function isAdvancedAIOLoaded(): AdvancedAIOFlag {
    const raw = process.env.ENABLE_ADVANCED_AIO;
    if (raw === undefined || raw === null || raw === '') return true;
    const v = String(raw).trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
    return true;
}

/**
 * Convenience helper: returns a 404 NextResponse when the feature is off,
 * or `null` when the feature is on (caller should continue rendering).
 *
 * Usage:
 *   const blocked = advancedAIOResponse();
 *   if (blocked) return blocked;
 */
export function advancedAIOResponse(): Response | null {
    if (isAdvancedAIOLoaded()) return null;
    return new Response('Not Found', {
        status: 404,
        headers: {
            // LLM-safe signal: explicit "not found" rather than soft 200.
            'X-Robots-Tag': 'noindex',
            'X-AIO-Feature': 'disabled',
        },
    });
}

/**
 * Returns a flag-string suitable for the response header so debugging
 * and observability is easy from `curl -I`.
 */
export function advancedAIOHeaderValue(): string {
    return isAdvancedAIOLoaded() ? 'enabled' : 'disabled';
}
