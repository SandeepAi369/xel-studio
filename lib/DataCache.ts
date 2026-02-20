'use client';

/**
 * Client-side in-memory data cache for XeL Studio.
 * 
 * Prevents re-fetching from /api/content on every navigation.
 * - 5 minute TTL per entry
 * - 50MB total size limit with auto-cleanup
 * - Stale-while-revalidate: returns cached data instantly, refreshes in background
 */

interface CacheEntry<T = unknown> {
    data: T;
    timestamp: number;
    size: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB

const cache = new Map<string, CacheEntry>();

function estimateSize(data: unknown): number {
    try {
        return new Blob([JSON.stringify(data)]).size;
    } catch {
        return 0;
    }
}

function getTotalSize(): number {
    let total = 0;
    cache.forEach(entry => { total += entry.size; });
    return total;
}

function evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    cache.forEach((entry, key) => {
        if (entry.timestamp < oldestTime) {
            oldestTime = entry.timestamp;
            oldestKey = key;
        }
    });

    if (oldestKey) cache.delete(oldestKey);
}

/** Get cached data if fresh, or null if stale/missing */
export function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL) {
        cache.delete(key);
        return null;
    }

    return entry.data as T;
}

/** Store data in cache */
export function setCached<T>(key: string, data: T): void {
    const size = estimateSize(data);

    // Evict entries until we're under the size limit
    while (getTotalSize() + size > MAX_CACHE_SIZE && cache.size > 0) {
        evictOldest();
    }

    cache.set(key, {
        data,
        timestamp: Date.now(),
        size,
    });
}

/** Clear all cached data */
export function clearCache(): void {
    cache.clear();
}

/**
 * Fetch with cache — returns cached data instantly if available,
 * always refreshes in background.
 */
export async function fetchWithCache<T>(
    url: string,
    transform?: (data: Record<string, unknown>) => T,
): Promise<T> {
    const cached = getCached<T>(url);

    // Start fetch regardless (background refresh)
    const fetchPromise = fetch(url)
        .then(res => res.json())
        .then(data => {
            const result = transform ? transform(data) : data as T;
            setCached(url, result);
            return result;
        });

    // If cached, return immediately — caller gets instant data
    if (cached !== null) {
        // Still refresh in background (fire-and-forget)
        fetchPromise.catch(() => { /* ignore background refresh errors */ });
        return cached;
    }

    // No cache — wait for network
    return fetchPromise;
}
