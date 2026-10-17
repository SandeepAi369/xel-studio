/**
 * /llms.txt — Machine-readable content index for LLMs
 * 
 * llmstxt.org-style index: a short site summary plus one Markdown link
 * per article. Full article text is served by /llms-full.txt.
 * Any new article published to Supabase is automatically included.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { excerpt, markdownToPlainText } from '@/lib/article-feed';
import { advancedAIOHeaderValue, advancedAIOResponse } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = 'https://xel-studio.vercel.app';

export async function GET() {
    // ── Kill-switch (Phase 1) ──────────────────────────────────
    // When ENABLE_ADVANCED_AIO="false" we return a clean 404 instead
    // of the dynamic index so the baseline is preserved.
    const blocked = advancedAIOResponse();
    if (blocked) return blocked;

    // Index format per https://llmstxt.org — one link per article to its
    // clean Markdown copy. Full text lives in /llms-full.txt.
    let articlesSection = '';

    try {
        const { data } = await getSupabaseAdmin()
            .from('articles')
            .select('id, title, content, created_at')
            .order('created_at', { ascending: false });

        if (data && data.length > 0) {
            articlesSection = data
                .map((a) => {
                    const summary = excerpt(markdownToPlainText(a.content || ''), 160);
                    return `- [${(a.title || 'Untitled').replace(/[\[\]]/g, '')}](${SITE_URL}/articles/${a.id}.md): ${summary}`;
                })
                .join('\n');
        }
    } catch (e) {
        console.warn('llms.txt: failed to fetch articles:', e);
    }

    const output = `# XeL Studio

> Original articles on AI research, LLMs, agents, and cyber security by Sandeep, plus automated AI tech news.

Every article is available as clean Markdown by appending \`.md\` to its URL (also \`.txt\` and \`.json\`), or by requesting the article URL with \`Accept: text/markdown\`. Article pages are fully server-rendered HTML with schema.org BlogPosting data.

## Site Structure
- Home: ${SITE_URL}
- Articles: ${SITE_URL}/articles
- AI Tech News: ${SITE_URL}/ai-news
- AI Chat: ${SITE_URL}/ai
- Security Tools: ${SITE_URL}/shield
- App Store: ${SITE_URL}/store
- RSS Feed: ${SITE_URL}/api/rss

## Articles

${articlesSection || 'No articles published yet.'}

## Feeds
- [Articles RSS](${SITE_URL}/articles/feed.xml): RSS 2.0 with full article HTML
- [Articles Atom](${SITE_URL}/articles/atom.xml): Atom 1.0 with full article HTML

## Optional
- [Full text of all articles](${SITE_URL}/llms-full.txt): every article's complete text in one file
`;

    return new NextResponse(output, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
            'X-AIO-Feature': advancedAIOHeaderValue(),
        },
    });
}
