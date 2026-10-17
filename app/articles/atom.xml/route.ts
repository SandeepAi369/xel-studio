/**
 * /articles/atom.xml — Atom 1.0 feed of original Articles only (no AI News).
 *
 * Same data as /articles/feed.xml; offered for readers and bridges that
 * prefer Atom. Includes a WebSub hub link.
 */

import { NextResponse } from 'next/server';
import {
    ARTICLES_ATOM_URL, ARTICLES_RSS_URL, FEED_AUTHOR, FEED_DESCRIPTION, FEED_TITLE, SITE_URL, WEBSUB_HUB_URL,
    cdata, escapeXml, getFeedArticles,
} from '@/lib/article-feed';

export const revalidate = 600;

export async function GET() {
    let articles;
    try {
        articles = await getFeedArticles();
    } catch (e) {
        console.error('[articles/atom.xml]', e);
        return new NextResponse('Feed temporarily unavailable', { status: 503 });
    }

    const updated = (articles[0]?.published ?? new Date()).toISOString();

    const entries = articles.map((a) => `  <entry>
    <title>${escapeXml(a.title)}</title>
    <link rel="alternate" type="text/html" href="${a.url}" />
    <id>${a.url}</id>
    <published>${a.published.toISOString()}</published>
    <updated>${a.published.toISOString()}</updated>
    <author><name>${FEED_AUTHOR}</name></author>${a.category ? `
    <category term="${escapeXml(a.category)}" />` : ''}
    <summary>${escapeXml(a.summary)}</summary>
    <content type="html">${cdata(a.html)}</content>
  </entry>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-us">
  <title>${escapeXml(FEED_TITLE)}</title>
  <subtitle>${escapeXml(FEED_DESCRIPTION)}</subtitle>
  <id>${SITE_URL}/articles</id>
  <link rel="alternate" type="text/html" href="${SITE_URL}/articles" />
  <link rel="self" type="application/atom+xml" href="${ARTICLES_ATOM_URL}" />
  <link rel="hub" href="${WEBSUB_HUB_URL}" />
  <link rel="alternate" type="application/rss+xml" href="${ARTICLES_RSS_URL}" />
  <updated>${updated}</updated>
  <author><name>${FEED_AUTHOR}</name><uri>${SITE_URL}</uri></author>
${entries}
</feed>
`;

    return new NextResponse(xml, {
        headers: {
            'Content-Type': 'application/atom+xml; charset=utf-8',
            'Link': `<${WEBSUB_HUB_URL}>; rel="hub", <${ARTICLES_ATOM_URL}>; rel="self"`,
        },
    });
}
