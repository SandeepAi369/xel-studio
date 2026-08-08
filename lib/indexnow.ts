export const INDEXNOW_KEY = 'd942c55b41224d45a963b655513ab0a9';
export const SITE_URL = 'https://xel-studio.vercel.app';

/**
 * Pings the IndexNow API to notify Bing, Yandex, Seznam, and Copilot/Perplexity
 * that an article has been added or updated.
 *
 * Phase 5 — extended urlList to cover every AI/LLM discovery surface we
 * now ship (Phase 1–4). Each ping is one API call; IndexNow accepts
 * up to 10,000 URLs per submission so we stay well within the limit.
 *
 * @param urlPath The path of the URL that was updated (e.g. '/articles/123')
 */
export async function pingIndexNow(urlPath: string) {
    if (!urlPath) return;

    try {
        const fullUrl = `${SITE_URL}${urlPath}`;

        const payload = {
            host: "xel-studio.vercel.app",
            key: INDEXNOW_KEY,
            keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
            urlList: [
                fullUrl,
                // Canonical URL mirrors for the article (Phase 2)
                `${fullUrl}.md`,
                `${fullUrl}.txt`,
                `${fullUrl}.json`,
                `${fullUrl}/feed.json`,
                // Aggregate discovery feeds (Phase 1)
                `${SITE_URL}/articles`,          // listing page
                `${SITE_URL}/llms.txt`,          // llms.txt index
                `${SITE_URL}/llms-full.txt`,     // full-content llms.txt
                `${SITE_URL}/articles.txt`,      // plain-text article index
                `${SITE_URL}/api/rss`,           // RSS 2.0 feed
                `${SITE_URL}/sitemap.xml`,       // sitemap (also changes)
            ],
        };

        const res = await fetch('https://api.indexnow.org/IndexNow', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            console.log(`[IndexNow] Successfully pinged ${payload.urlList.length} URLs for: ${urlPath}`);
        } else {
            console.warn(`[IndexNow] Ping failed with status: ${res.status}`);
        }
    } catch (e) {
        console.error('[IndexNow] Error pinging IndexNow API:', e);
    }
}
