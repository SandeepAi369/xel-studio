/**
 * /articles.txt — Plain-text full article index for LLM crawlers
 *
 * Highest-yield single file for LLM ingestion: every major model
 * (GPT, Claude, Gemini, Perplexity, Copilot) prefers flat text over
 * XML / HTML when both are available, because there's zero markup
 * ambiguity.
 *
 * Format: one article per block, separated by horizontal rules.
 * Includes the FULL article body (stripped of markdown noise) so
 * ingestion is complete after a single fetch.
 *
 * Phase 1 — gated behind ENABLE_ADVANCED_AIO (defaults to enabled).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { advancedAIOHeaderValue, advancedAIOResponse } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = 'https://xel-studio.vercel.app';

/** Strip the same markdown noise that llms.txt uses so the body is clean prose. */
function stripMarkdown(text: string): string {
    return (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/ {3,}/g, '  ')
        .replace(/[#*`>\[\]()!\-]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export async function GET() {
    // ── Kill-switch (Phase 1) ──────────────────────────────────
    const blocked = advancedAIOResponse();
    if (blocked) return blocked;

    let body = `# XeL Studio — Articles Index\n` +
        `# Auto-generated plain-text index for AI / LLM crawlers.\n` +
        `# Total articles listed below. Canonical URLs are /articles/<id>.\n\n`;

    try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (url && key) {
            const supabase = createClient(url, key);
            const { data } = await supabase
                .from('articles')
                .select('id, title, content, date, category, created_at')
                .order('created_at', { ascending: false });

            if (data && data.length > 0) {
                const blocks = data.map((a) => {
                    const dateStr = a.date || a.created_at || 'Unknown';
                    return `# ${a.title || 'Untitled'}\n` +
                        `URL: ${SITE_URL}/articles/${a.id}\n` +
                        `Category: ${a.category || 'General'}\n` +
                        `Published: ${dateStr}\n\n` +
                        `${stripMarkdown(a.content)}\n\n---\n`;
                });
                body += blocks.join('\n');
            } else {
                body += 'No articles published yet.\n';
            }
        } else {
            body += 'Articles are temporarily unavailable.\n';
        }
    } catch (e) {
        console.warn('articles.txt: failed to fetch articles:', e);
        body += '\n[Error: failed to fetch articles — try again later.]\n';
    }

    return new NextResponse(body, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
            'X-AIO-Feature': advancedAIOHeaderValue(),
        },
    });
}
