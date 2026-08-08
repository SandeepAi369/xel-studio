/**
 * /articles/[id]/feed.json — Single-item JSON Feed (Phase 4)
 *
 * JSON Feed 1.1 (https://www.jsonfeed.org/) is a crawler-friendly
 * alternative to RSS. LLMs and modern scrapers handle JSON more reliably
 * than XML, and per-article endpoints let a bot walk the corpus
 * one URL at a time without parsing a giant combined feed.
 *
 * Gated behind ENABLE_ADVANCED_AIO.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { advancedAIOHeaderValue, advancedAIOResponse } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = 'https://xel-studio.vercel.app';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const blocked = advancedAIOResponse();
    if (blocked) return blocked;

    const { id } = await params;
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        return new NextResponse('Invalid id', { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        return new NextResponse('Backend unavailable', { status: 503 });
    }

    let article: {
        id: string;
        title: string;
        content: string;
        category?: string;
        date?: string;
        created_at?: string;
        image?: string;
    } | null = null;

    try {
        const supabase = createClient(url, key);
        const { data } = await supabase
            .from('articles')
            .select('id, title, content, category, date, created_at, image')
            .eq('id', id)
            .maybeSingle();
        article = data ?? null;
    } catch (e) {
        console.error('feed.json: supabase fetch failed:', e);
        return new NextResponse('Upstream error', { status: 502 });
    }

    if (!article) {
        return new NextResponse('Article not found', { status: 404 });
    }

    const dateIso = article.date || article.created_at || new Date().toISOString();
    const item = {
        id: `${SITE_URL}/articles/${article.id}`,
        url: `${SITE_URL}/articles/${article.id}`,
        title: article.title,
        content_html: article.content,
        // Provide plain-text mirror so consumers can render without HTML.
        content_text: article.content.replace(/[#*`>\[\]()!\-]/g, ''),
        summary: article.content.substring(0, 280),
        date_published: dateIso,
        date_modified: dateIso,
        authors: [{ name: 'Sandeep', url: 'https://github.com/SandeepAi369' }],
        tags: article.category ? [article.category] : [],
        image: article.image || undefined,
        _aio: {
            mirror_markdown: `${SITE_URL}/articles/${article.id}.md`,
            mirror_text: `${SITE_URL}/articles/${article.id}.txt`,
            api_markdown_accept: `${SITE_URL}/api/article/${article.id}`,
            llms_full: `${SITE_URL}/llms-full.txt`,
        },
    };

    return NextResponse.json(
        {
            version: 'https://jsonfeed.org/version/1.1',
            title: 'XeL Studio — Article',
            home_page_url: SITE_URL,
            feed_url: `${SITE_URL}/articles/${article.id}/feed.json`,
            items: [item],
        },
        {
            headers: {
                'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
                'X-AIO-Feature': advancedAIOHeaderValue(),
            },
        }
    );
}
