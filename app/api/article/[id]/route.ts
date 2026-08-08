/**
 * /api/article/[id] — Content-negotiated article endpoint
 *
 * Phase 2 — responds based on the request's Accept header so LLM crawlers
 * (GPTBot, ClaudeBot, PerplexityBot, anthropic-ai, Google-Extended) that
 * send `Accept: text/markdown` get a single-article markdown body, while
 * regular browsers still get JSON.
 *
 * Gated behind ENABLE_ADVANCED_AIO.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { advancedAIOHeaderValue, advancedAIOResponse } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = 'https://xel-studio.vercel.app';

function stripMarkdown(text: string): string {
    return (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[#*`>\[\]()!\-]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function toMarkdown(a: {
    id: string;
    title: string;
    content: string;
    category?: string;
    date?: string;
    created_at?: string;
}): string {
    const date = a.date || a.created_at || '';
    const cat = a.category ? `> Category: ${a.category}\n` : '';
    return `# ${a.title}\n\n${cat}> Published: ${date}\n> URL: ${SITE_URL}/articles/${a.id}\n\n${a.content}\n`;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    // ── Kill-switch (Phase 2) ──────────────────────────────────
    const blocked = advancedAIOResponse();
    if (blocked) return blocked;

    const { id } = await params;

    // Defensive id validation
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
    } | null = null;

    try {
        const supabase = createClient(url, key);
        const { data } = await supabase
            .from('articles')
            .select('id, title, content, category, date, created_at')
            .eq('id', id)
            .maybeSingle();
        article = data ?? null;
    } catch (e) {
        console.error('api/article: supabase fetch failed:', e);
        return new NextResponse('Upstream error', { status: 502 });
    }

    if (!article) {
        return new NextResponse('Article not found', {
            status: 404,
            headers: { 'X-AIO-Feature': advancedAIOHeaderValue() },
        });
    }

    const accept = (request.headers.get('accept') || '').toLowerCase();
    const baseHeaders = {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
        'X-AIO-Feature': advancedAIOHeaderValue(),
    } as const;

    // 1. Markdown — preferred by GPTBot, ClaudeBot, PerplexityBot.
    if (accept.includes('text/markdown')) {
        return new NextResponse(toMarkdown(article), {
            status: 200,
            headers: { ...baseHeaders, 'Content-Type': 'text/markdown; charset=utf-8' },
        });
    }

    // 2. Plain text — used by readers, RSS aggregators, basic crawlers.
    if (accept.includes('text/plain') && !accept.includes('text/html')) {
        return new NextResponse(stripMarkdown(article.content), {
            status: 200,
            headers: { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    // 3. JSON — default for API clients.
    return NextResponse.json(
        {
            ...article,
            url: `${SITE_URL}/articles/${article.id}`,
            markdown_url: `${SITE_URL}/articles/${article.id}.md`,
            text_url: `${SITE_URL}/articles/${article.id}.txt`,
        },
        { headers: baseHeaders }
    );
}
