/**
 * Credential-free discovery pings fired after an article write.
 *
 * Scheduled with next/server `after()` so they run once the response has
 * been sent but are still awaited by the platform — unlike the old
 * un-awaited promise, which Vercel could freeze mid-flight.
 *
 * Only tiny HTTP pings run here. Anything heavier (social posting,
 * retries, backfill) belongs in the GitHub Actions workflow that reads
 * the public articles feed.
 */

import { after } from 'next/server';
import { pingIndexNow } from './indexnow';
import { ARTICLES_ATOM_URL, ARTICLES_RSS_URL, WEBSUB_HUB_URL } from './article-feed';

/** Tell the WebSub hub both article feeds changed; the hub re-fetches and fans out. */
export async function pingWebSub(): Promise<void> {
    await Promise.all([ARTICLES_RSS_URL, ARTICLES_ATOM_URL].map(async (feedUrl) => {
        try {
            const res = await fetch(WEBSUB_HUB_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ 'hub.mode': 'publish', 'hub.url': feedUrl }),
            });
            if (res.ok) {
                console.log(`[WebSub] Published ${feedUrl} (${res.status})`);
            } else {
                console.warn(`[WebSub] Ping for ${feedUrl} failed with status: ${res.status}`);
            }
        } catch (e) {
            console.error(`[WebSub] Error pinging hub for ${feedUrl}:`, e);
        }
    }));
}

/** Schedule IndexNow + WebSub pings for an article to run after the response. */
export function scheduleDiscoveryPings(articleId: string): void {
    after(async () => {
        await Promise.all([
            pingIndexNow(`/articles/${articleId}`),
            pingWebSub(),
        ]);
    });
}
