import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdvancedAIOLoaded } from '@/lib/feature-flags';

/**
 * XeL Studio — Edge proxy
 *
 * Three layers of behaviour, all guarded by the AIO kill-switch:
 *
 *   LAYER A — Pre-existing baseline (always on)
 *     • /articles/latest            → 302 to newest article
 *     • /articles/oldest            → 302 to oldest article
 *     • /articles/<id>/next         → 302 to adjacent (newer) article
 *     • /articles/<id>/previous     → 302 to adjacent (older) article
 *
 *   LAYER B — AIO extension mirrors (Phase 2, gated by ENABLE_ADVANCED_AIO)
 *     • /articles/<id>.md           → 200 text/markdown  (kills hallucinated
 *                                       *.md fetches by GPTBot / ClaudeBot)
 *     • /articles/<id>.txt          → 200 text/plain
 *     • /articles/<id>.json         → 200 application/json
 *
 *   LAYER C — Slug-alias redirects (Phase 2, gated)
 *     • /articles/<kebab-slug>      → 308 to canonical /articles/<id>
 *
 * When the flag is OFF, Layers B and C become a no-op (NextResponse.next())
 * so the baseline keeps working with zero behavioural change.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,80}$/i;
const EXT_RE = /^\/articles\/([^/]+)\.(md|txt|json)$/i;

/** Minimal markdown serialiser — produces a single # heading + body. */
function toMarkdown(article: { title: string; content: string; category?: string; date?: string; created_at?: string }): string {
    const date = article.date || article.created_at || '';
    const cat = article.category ? `> Category: ${article.category}\n` : '';
    return `# ${article.title}\n\n${cat}> Published: ${date}\n\n${article.content}\n`;
}

function stripMarkdown(text: string): string {
    return (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[#*`>\[\]()!\-]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

interface SupabaseArticle {
    id: string;
    title: string;
    content: string;
    category?: string;
    date?: string;
    created_at?: string;
    slug?: string;
}

async function fetchArticleById(supabaseUrl: string, supabaseKey: string, id: string): Promise<SupabaseArticle | null> {
    try {
        // Defensive: only allow safe characters in the id param
        if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
        const res = await fetch(
            `${supabaseUrl}/rest/v1/articles?id=eq.${id}&select=id,title,content,category,date,created_at&limit=1`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                },
                next: { revalidate: 60 },
            }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as SupabaseArticle[];
        return data && data.length > 0 ? data[0] : null;
    } catch {
        return null;
    }
}

async function fetchArticleByTitleSlug(supabaseUrl: string, supabaseKey: string, titleSlug: string): Promise<SupabaseArticle | null> {
    // Fuzzy fallback: convert title to a lowercase-kebab slug and exact-match.
    // NOTE: `slug` column was not added to the Supabase schema; the
    //       title-derived slug is sufficient and avoids 4xx errors.
    try {
        const res = await fetch(
            `${supabaseUrl}/rest/v1/articles?select=id,title,content,category,date,created_at&order=created_at.desc&limit=200`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                },
                next: { revalidate: 60 },
            }
        );
        if (!res.ok) return null;
        const rows = (await res.json()) as SupabaseArticle[];
        const target = titleSlug.toLowerCase();
        const fromTitle = rows.find((r) =>
            (r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === target
        );
        return fromTitle || null;
    } catch {
        return null;
    }
}

function extensionResponse(article: SupabaseArticle, ext: string): Response {
    if (ext === 'md') {
        return new NextResponse(toMarkdown(article), {
            status: 200,
            headers: {
                'Content-Type': 'text/markdown; charset=utf-8',
                'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
                'X-AIO-Feature': 'enabled',
            },
        });
    }
    if (ext === 'txt') {
        return new NextResponse(stripMarkdown(article.content), {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
                'X-AIO-Feature': 'enabled',
            },
        });
    }
    // .json
    return NextResponse.json(
        {
            id: article.id,
            title: article.title,
            content: article.content,
            category: article.category ?? null,
            date: article.date ?? article.created_at ?? null,
            url: `https://xel-studio.vercel.app/articles/${article.id}`,
        },
        {
            headers: {
                'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
                'X-AIO-Feature': 'enabled',
            },
        }
    );
}

export async function proxy(request: NextRequest) {
    const url = request.nextUrl;

    // ── Scope guard ───────────────────────────────────────────
    if (!url.pathname.startsWith('/articles/')) return NextResponse.next();

    const pathParts = url.pathname.split('/').filter(Boolean);
    const aioEnabled = isAdvancedAIOLoaded();

    // ── LAYER B: extension mirrors (.md / .txt / .json) ───────
    if (aioEnabled) {
        const extMatch = url.pathname.match(EXT_RE);
        if (extMatch) {
            const rawId = extMatch[1];
            const ext = extMatch[2].toLowerCase();
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey =
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (supabaseUrl && supabaseKey) {
                const article = await fetchArticleById(supabaseUrl, supabaseKey, rawId);
                if (article) return extensionResponse(article, ext);
            }
            // No match — fall through to the route handler (will 404 normally).
        }
    }

    // ── LAYER C: slug alias (only when 2 path parts, not latest/oldest, not UUID) ──
    if (aioEnabled && pathParts.length === 2 && pathParts[0] === 'articles') {
        const candidate = pathParts[1];
        const intent = candidate.toLowerCase();
        // Don't shadow semantic routes or UUID-based canonical URLs.
        const isSemantic = intent === 'latest' || intent === 'oldest';
        const isUuid = UUID_RE.test(candidate);
        const looksLikeSlug = SLUG_RE.test(candidate) && !isUuid;
        if (!isSemantic && looksLikeSlug) {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey =
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (supabaseUrl && supabaseKey) {
                // ── Guard against 308 self-loops ────────────────────
                // If the candidate is already a canonical article ID,
                // pass through (no rewrite). This prevents an infinite
                // redirect when the slug column happens to match the
                // generated-id string.
                const asId = await fetchArticleById(supabaseUrl, supabaseKey, candidate);
                if (asId) {
                    // already canonical → fall through to LAYER A / page
                } else {
                    // The slug column does not exist in the schema; rely on
                    // title-derived fuzzy matching only.
                    const fuzzy = await fetchArticleByTitleSlug(supabaseUrl, supabaseKey, candidate);
                    if (fuzzy && fuzzy.id !== candidate) {
                        return NextResponse.redirect(new URL(`/articles/${fuzzy.id}`, request.url), 308);
                    }
                }
            }
        }
    }

    // ── LAYER A: baseline semantic routing (always on) ────────

    // /articles/latest | /articles/oldest
    if (pathParts.length === 2 && pathParts[0] === 'articles') {
        const intent = pathParts[1].toLowerCase();

        if (intent === 'latest' || intent === 'oldest') {
            try {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

                if (supabaseUrl && supabaseKey) {
                    const order = intent === 'latest' ? 'desc' : 'asc';
                    const res = await fetch(`${supabaseUrl}/rest/v1/articles?select=id&order=created_at.${order}&limit=1`, {
                        headers: {
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${supabaseKey}`,
                        },
                        next: { revalidate: 60 },
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.length > 0) {
                            return NextResponse.redirect(new URL(`/articles/${data[0].id}`, request.url), 302);
                        }
                    }
                }
            } catch (e) {
                console.error('Middleware semantic route error:', e);
            }
        }
    }

    // /articles/[id]/next | /articles/[id]/previous
    if (pathParts.length === 3 && pathParts[0] === 'articles') {
        const id = pathParts[1];
        const intent = pathParts[2].toLowerCase();

        if (intent === 'next' || intent === 'previous') {
            try {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

                if (supabaseUrl && supabaseKey) {
                    const currentRes = await fetch(`${supabaseUrl}/rest/v1/articles?select=id,created_at&id=eq.${id}`, {
                        headers: {
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${supabaseKey}`,
                        },
                        next: { revalidate: 60 },
                    });

                    if (currentRes.ok) {
                        const currentData = await currentRes.json();
                        if (currentData && currentData.length > 0) {
                            const createdAt = currentData[0].created_at;
                            const operator = intent === 'next' ? 'gt' : 'lt';
                            const order = intent === 'next' ? 'asc' : 'desc';

                            const adjRes = await fetch(`${supabaseUrl}/rest/v1/articles?select=id&created_at=${operator}.${createdAt}&order=created_at.${order}&limit=1`, {
                                headers: {
                                    'apikey': supabaseKey,
                                    'Authorization': `Bearer ${supabaseKey}`,
                                },
                                next: { revalidate: 60 },
                            });

                            if (adjRes.ok) {
                                const adjData = await adjRes.json();
                                if (adjData && adjData.length > 0) {
                                    return NextResponse.redirect(new URL(`/articles/${adjData[0].id}`, request.url), 302);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Middleware semantic routing error:', e);
            }

            return NextResponse.redirect(new URL(`/articles/${id}`, request.url), 302);
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/articles/:path*',
};
