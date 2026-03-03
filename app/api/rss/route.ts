/**
 * /api/rss — RSS 2.0 Feed (AI News + Articles)
 * Combines automated AI news from Firestore and original articles from Supabase
 * into a single sorted RSS feed for Google Publisher Center.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = 'https://xel-studio.vercel.app';
const FEED_TITLE = 'XeL Studio — AI Research & Cyber Security';
const FEED_DESCRIPTION =
    'Latest AI news, tech updates, cyber security insights, and original articles from XeL Studio.';

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

interface FeedItem {
    title: string;
    link: string;
    description: string;
    pubDate: string;
    category: string;
    imageUrl?: string;
}

export async function GET() {
    const items: FeedItem[] = [];

    // ── 1. AI News from Firestore ───────────────────────────────
    try {
        const newsSnap = await adminDb
            .collection('news')
            .orderBy('date', 'desc')
            .limit(50)
            .get();

        newsSnap.docs.forEach((doc) => {
            const d = doc.data();
            items.push({
                title: d.title || 'Untitled',
                link: `${SITE_URL}/ai-news/${doc.id}`,
                description: d.summary || '',
                pubDate: d.date ? new Date(d.date).toUTCString() : new Date().toUTCString(),
                category: d.category || 'ai-tech',
                imageUrl: d.image_url || undefined,
            });
        });
    } catch (e) {
        console.warn('RSS: failed to fetch news:', e);
    }

    // ── 2. Articles from Supabase ───────────────────────────────
    try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (url && key) {
            const supabase = createClient(url, key);
            const { data } = await supabase
                .from('articles')
                .select('id, title, content, date, category, image')
                .order('date', { ascending: false })
                .limit(50);

            if (data) {
                data.forEach((a) => {
                    const summary = a.content
                        ? a.content.replace(/[#*`>\-\[\]()!]/g, '').substring(0, 300).trim()
                        : '';
                    items.push({
                        title: a.title || 'Untitled',
                        link: `${SITE_URL}/articles/${a.id}`,
                        description: summary,
                        pubDate: a.date ? new Date(a.date).toUTCString() : new Date().toUTCString(),
                        category: a.category || 'article',
                        imageUrl: a.image || undefined,
                    });
                });
            }
        }
    } catch (e) {
        console.warn('RSS: failed to fetch articles:', e);
    }

    // ── 3. Sort by most recent date ─────────────────────────────
    items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

    // ── 4. Build RSS 2.0 XML ────────────────────────────────────
    const rssItems = items
        .map(
            (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${item.link}</link>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${item.pubDate}</pubDate>
      <category>${escapeXml(item.category)}</category>
      <guid isPermaLink="true">${item.link}</guid>${item.imageUrl
                    ? `\n      <enclosure url="${escapeXml(item.imageUrl)}" type="image/jpeg" />`
                    : ''
                }
    </item>`
        )
        .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/api/rss" rel="self" type="application/rss+xml" />
    <image>
      <url>${SITE_URL}/favicon.ico</url>
      <title>${escapeXml(FEED_TITLE)}</title>
      <link>${SITE_URL}</link>
    </image>
${rssItems}
  </channel>
</rss>`;

    return new NextResponse(xml, {
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
        },
    });
}
