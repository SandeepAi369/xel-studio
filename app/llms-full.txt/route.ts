/**
 * /llms-full.txt — Full-content variant of /llms.txt (Phase 1)
 *
 * Per the llms.txt spec (https://llmstxt.org), the short /llms.txt file
 * should LINK to /llms-full.txt when full content is available.
 *
 * This file contains the most recent N articles in full, with markdown
 * noise stripped, so any LLM can ingest the corpus end-to-end with one
 * GET request — no JS execution, no follow-up navigation.
 *
 * Gated behind ENABLE_ADVANCED_AIO (defaults to enabled).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { advancedAIOHeaderValue, advancedAIOResponse } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = 'https://xel-studio.vercel.app';
const RECENT_LIMIT = 50;

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

    let body = `# XeL Studio — Full Articles (LLM Ingestion)\n` +
        `# This file contains the ${RECENT_LIMIT} most recent articles with full content.\n` +
        `# For the index-only version see /llms.txt. For a flat article listing see /articles.txt.\n\n`;

    try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (url && key) {
            const supabase = createClient(url, key);
            const { data } = await supabase
                .from('articles')
                .select('id, title, content, date, category, created_at')
                .order('created_at', { ascending: false })
                .limit(RECENT_LIMIT);

            if (data && data.length > 0) {
                const blocks = data.map((a, i) => {
                    const dateStr = a.date || a.created_at || 'Unknown';
                    return `## Article ${i + 1}: ${a.title || 'Untitled'}\n` +
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
        console.warn('llms-full.txt: failed to fetch articles:', e);
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
