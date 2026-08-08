/**
 * revalidate-feeds.ts (Phase 5)
 *
 * Single entry point to invalidate every AI / LLM discovery surface
 * after an article write. Keeps the indexing pipeline consistent:
 * whenever an article is created/updated/deleted, all of these
 * surfaces must reflect the new state on the very next request.
 *
 * All calls are wrapped in try/catch because a revalidation failure
 * should never block a successful write.
 */

import { revalidatePath } from 'next/cache';

const FEED_PATHS = [
    // Human-facing
    '/articles',
    '/sitemap.xml',
    // AI/LLM discovery feeds (Phase 1)
    '/llms.txt',
    '/llms-full.txt',
    '/articles.txt',
    // RSS / JSON
    '/api/rss',
] as const;

export function revalidateAIOFeeds(articleId?: string): void {
    for (const p of FEED_PATHS) {
        try {
            revalidatePath(p);
        } catch (e) {
            console.warn(`[revalidate] failed for ${p}:`, e);
        }
    }
    if (articleId) {
        // Per-article caches.
        const perArticle = [
            `/articles/${articleId}`,
            `/articles/${articleId}.md`,
            `/articles/${articleId}.txt`,
            `/articles/${articleId}.json`,
            `/articles/${articleId}/feed.json`,
            `/api/article/${articleId}`,
        ];
        for (const p of perArticle) {
            try {
                revalidatePath(p);
            } catch (e) {
                console.warn(`[revalidate] failed for ${p}:`, e);
            }
        }
    }
}
