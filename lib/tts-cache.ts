/**
 * TTS Audio Cache — In-Memory (RAM-only, auto-clears on tab close)
 *
 * Architecture:
 *   - Uses a Map<hash, Blob> stored in a module-level variable
 *   - Key = SHA-like hash of the text chunk (fast djb2 hash)
 *   - Value = audio Blob
 *   - Memory limit: auto-evicts oldest entries when total size > MAX_CACHE_MB
 *   - Cleanup: everything lives in JS heap → gone on tab close/refresh
 *   - No localStorage, no IndexedDB, no sessionStorage
 *
 * Usage:
 *   import { ttsCache } from '@/lib/tts-cache';
 *   const blob = ttsCache.get(text) || await fetchAndCache(text);
 */

const MAX_CACHE_MB = 50; // Max cache size in MB
const MAX_CACHE_BYTES = MAX_CACHE_MB * 1024 * 1024;

interface CacheEntry {
    blob: Blob;
    objectUrl: string;
    size: number;
    timestamp: number;
}

class TTSCache {
    private cache = new Map<string, CacheEntry>();
    private totalSize = 0;

    /** Fast djb2 hash for text → cache key */
    private hash(text: string): string {
        let h = 5381;
        for (let i = 0; i < text.length; i++) {
            h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
        }
        return `tts_${h.toString(36)}`;
    }

    /** Check if audio for this text is cached */
    has(text: string): boolean {
        return this.cache.has(this.hash(text));
    }

    /** Get cached object URL (ready to play) */
    get(text: string): string | null {
        const entry = this.cache.get(this.hash(text));
        if (entry) {
            // Update timestamp (LRU)
            entry.timestamp = Date.now();
            return entry.objectUrl;
        }
        return null;
    }

    /** Store audio blob, returns object URL */
    set(text: string, blob: Blob): string {
        const key = this.hash(text);

        // If already cached, return existing URL
        const existing = this.cache.get(key);
        if (existing) return existing.objectUrl;

        // Evict oldest entries if cache is full
        while (this.totalSize + blob.size > MAX_CACHE_BYTES && this.cache.size > 0) {
            this.evictOldest();
        }

        const objectUrl = URL.createObjectURL(blob);
        const entry: CacheEntry = {
            blob,
            objectUrl,
            size: blob.size,
            timestamp: Date.now(),
        };

        this.cache.set(key, entry);
        this.totalSize += blob.size;

        return objectUrl;
    }

    /** Evict the oldest (LRU) entry */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            const entry = this.cache.get(oldestKey)!;
            URL.revokeObjectURL(entry.objectUrl);
            this.totalSize -= entry.size;
            this.cache.delete(oldestKey);
        }
    }

    /** Get cache stats */
    stats(): { entries: number; sizeMB: string } {
        return {
            entries: this.cache.size,
            sizeMB: (this.totalSize / (1024 * 1024)).toFixed(2),
        };
    }

    /** Manual clear (not needed — tab close does this) */
    clear(): void {
        for (const entry of this.cache.values()) {
            URL.revokeObjectURL(entry.objectUrl);
        }
        this.cache.clear();
        this.totalSize = 0;
    }
}

/** Singleton — lives in JS heap, dies with the tab */
export const ttsCache = new TTSCache();
