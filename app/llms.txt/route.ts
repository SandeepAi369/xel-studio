/**
 * /llms.txt — Machine-readable content index for LLMs
 * 
 * Dynamically generates a structured text file listing all articles
 * and their full content so AI models can ingest them directly.
 * Any new article published to Supabase is automatically included.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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

    let articlesSection = '';

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
                articlesSection = data
                    .map((a, i) => {
                        const cleanContent = (a.content || '')
                            .replace(/[#*`>\[\]()!]/g, '')
                            .trim();
                        const dateStr = a.date || a.created_at || 'Unknown';
                        return `## Article ${i + 1}: ${a.title || 'Untitled'}
- URL: ${SITE_URL}/articles/${a.id}
- Category: ${a.category || 'General'}
- Published: ${dateStr}

${cleanContent}`;
                    })
                    .join('\n\n---\n\n');
            }
        }
    } catch (e) {
        console.warn('llms.txt: failed to fetch articles:', e);
    }

    const output = `# XeL Studio
> AI Research, Cyber Security, and Technology Platform

## About
XeL Studio is a platform for AI research articles, automated AI tech news, cyber security tools, and AI-powered applications.

## Site Structure
- Home: ${SITE_URL}
- Articles: ${SITE_URL}/articles
- AI Tech News: ${SITE_URL}/ai-news
- AI Chat: ${SITE_URL}/ai
- Security Tools: ${SITE_URL}/shield
- App Store: ${SITE_URL}/store
- RSS Feed: ${SITE_URL}/api/rss

## All Articles

${articlesSection || 'No articles published yet.'}
`;

    return new NextResponse(output, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
            'X-AIO-Feature': advancedAIOHeaderValue(),
        },
    });
}
