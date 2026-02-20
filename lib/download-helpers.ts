/**
 * Download utility functions — extracted from the old db.ts
 * Used by the download API route for rate limiting and URL validation.
 */

// ─── Rate Limiting ───────────────────────────────────────────
// Simple in-memory rate limiter (resets on deploy / cold start)
const downloadCounts: Map<string, { count: number; resetAt: number }> = new Map();

export function checkRateLimit(ip: string, limit: number = 5): boolean {
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    const entry = downloadCounts.get(ip);

    if (!entry || now > entry.resetAt) {
        downloadCounts.set(ip, { count: 1, resetAt: now + oneHourMs });
        return true;
    }

    if (entry.count >= limit) return false;

    entry.count++;
    return true;
}

// ─── URL Validation ──────────────────────────────────────────
const ALLOWED_DOMAINS = [
    'github.com',
    'raw.githubusercontent.com',
    'objects.githubusercontent.com',
    'github-releases.githubusercontent.com',
];

export function isValidDownloadUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return ALLOWED_DOMAINS.some(
            (domain) => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        );
    } catch {
        return false;
    }
}
