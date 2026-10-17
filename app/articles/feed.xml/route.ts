/**
 * /articles/feed.xml — RSS 2.0 feed of original Articles only (no AI News).
 *
 * Full HTML in content:encoded, Media RSS cover images, and a WebSub hub
 * link so subscribers get pushed updates. Cached (ISR) and revalidated
 * on every article write via revalidateAIOFeeds().
 */

import { NextResponse } from 'next/server';
import {
    ARTICLES_ATOM_URL, ARTICLES_RSS_URL, FEED_DESCRIPTION, FEED_TITLE, SITE_URL, WEBSUB_HUB_URL,
    cdata, escapeXml, getFeedArticles,
} from '@/lib/article-feed';

export const revalidate = 600;

export async function GET() {
    let articles;
    try {
        articles = await getFeedArticles();
    } catch (e) {
        console.error('[articles/feed.xml]', e);
        return new NextResponse('Feed temporarily unavailable', { status: 503 });
    }

    const lastBuild = articles[0]?.published ?? new Date();

    const items = articles.map((a) => `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${a.url}</link>
      <guid isPermaLink="true">${a.url}</guid>
      <pubDate>${a.published.toUTCString()}</pubDate>
      <dc:creator>Sandeep</dc:creator>${a.category ? `
      <category>${escapeXml(a.category)}</category>` : ''}
      <description>${escapeXml(a.summary)}</description>
      <content:encoded>${cdata(a.html)}</content:encoded>${a.image ? `
      <media:content url="${escapeXml(a.image)}" medium="image" />
      <media:thumbnail url="${escapeXml(a.image)}" />` : ''}
    </item>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${SITE_URL}/articles</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
    <atom:link href="${ARTICLES_RSS_URL}" rel="self" type="application/rss+xml" />
    <atom:link href="${WEBSUB_HUB_URL}" rel="hub" />
    <atom:link href="${ARTICLES_ATOM_URL}" rel="alternate" type="application/atom+xml" />
${items}
  </channel>
</rss>
`;

    return new NextResponse(xml, {
        headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Link': `<${WEBSUB_HUB_URL}>; rel="hub", <${ARTICLES_RSS_URL}>; rel="self"`,
        },
    });
}
