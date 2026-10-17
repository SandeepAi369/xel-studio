/**
 * Articles-only feed data (RSS 2.0 + Atom).
 *
 * Shared by /articles/feed.xml and /articles/atom.xml. Deliberately
 * excludes AI News — the mixed /api/rss feed stays untouched for News.
 * These feeds are the public source of truth that discovery bridges
 * (WebSub, Bridgy Fed, feed readers) and the GitHub Actions
 * syndication workflow consume.
 */

import { getSupabaseAdmin } from './supabase';
import { markdownToSafeHtml } from './markdown-server';

export const SITE_URL = 'https://xel-studio.vercel.app';
export const ARTICLES_RSS_URL = `${SITE_URL}/articles/feed.xml`;
export const ARTICLES_ATOM_URL = `${SITE_URL}/articles/atom.xml`;
export const WEBSUB_HUB_URL = 'https://pubsubhubbub.appspot.com/';

export const FEED_TITLE = 'XeL Studio — Articles';
export const FEED_DESCRIPTION =
    'Original articles on AI research, LLMs, agents, and cyber security by Sandeep.';
export const FEED_AUTHOR = 'Sandeep';

const FEED_LIMIT = 50;

export interface FeedArticle {
    id: string;
    title: string;
    url: string;
    summary: string;
    html: string;
    published: Date;
    category?: string;
    image?: string;
}

/**
 * Markdown → plain text for summaries and meta descriptions.
 * Unlike the older stripper it keeps hyphens, parentheses and link text.
 */
export function markdownToPlainText(src: string): string {
    return (src || '')
        .replace(/\r\n/g, '\n')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/(\*\*|__|\*|_|`)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Truncate on a word boundary and add an ellipsis. */
export function excerpt(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function articleDate(a: { date?: string | null; created_at?: string | null }): Date {
    for (const raw of [a.date, a.created_at]) {
        if (!raw) continue;
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d;
    }
    return new Date(0);
}

export function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Wrap in CDATA, splitting any "]]>" so the section can't be broken out of. */
export function cdata(str: string): string {
    return `<![CDATA[${str.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export async function getFeedArticles(): Promise<FeedArticle[]> {
    const { data, error } = await getSupabaseAdmin()
        .from('articles')
        .select('id, title, content, date, category, image, created_at')
        .order('created_at', { ascending: false })
        .limit(FEED_LIMIT);

    if (error) throw new Error(`articles feed query failed: ${error.message}`);

    return (data || [])
        .map((a) => {
            const url = `${SITE_URL}/articles/${a.id}`;
            const image = a.image || undefined;
            const body = markdownToSafeHtml(a.content || '');
            const html = image
                ? `<p><img src="${escapeXml(image)}" alt="${escapeXml(a.title || '')}" /></p>\n${body}`
                : body;
            return {
                id: a.id,
                title: a.title || 'Untitled',
                url,
                summary: excerpt(markdownToPlainText(a.content || ''), 300),
                html: `${html}\n<p><a href="${url}">Read on XeL Studio</a></p>`,
                published: articleDate(a),
                category: a.category || undefined,
                image,
            };
        })
        .sort((x, y) => y.published.getTime() - x.published.getTime());
}
