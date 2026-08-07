export const INDEXNOW_KEY = 'd942c55b41224d45a963b655513ab0a9';
export const SITE_URL = 'https://xel-studio.vercel.app';

/**
 * Pings the IndexNow API to notify Bing, Yandex, Seznam, and Copilot/Perplexity
 * that an article has been added or updated.
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
                `${SITE_URL}/articles`, // Also notify that the list page changed
                `${SITE_URL}/llms.txt`, // Notify that llms.txt changed
                `${SITE_URL}/api/rss`   // Notify that RSS changed
            ]
        };

        const res = await fetch('https://api.indexnow.org/IndexNow', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            console.log(`[IndexNow] Successfully pinged updates for: ${urlPath}`);
        } else {
            console.warn(`[IndexNow] Ping failed with status: ${res.status}`);
        }
    } catch (e) {
        console.error('[IndexNow] Error pinging IndexNow API:', e);
    }
}
