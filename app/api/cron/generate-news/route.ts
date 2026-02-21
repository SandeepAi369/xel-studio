/**
 * /api/cron/generate-news — AI News Generator v8 (Groq Llama 4 + DuckDuckGo + Thumbnails)
 * =============================================================================
 * Pipeline: Dynamic Query → DuckDuckGo Search → Groq (Llama 4 strict factual JSON) →
 *           Unsplash (descriptive keyword) → Cloudinary → Firestore.
 *
 * Architecture:
 *   - Simple Query Generation: random selection from curated search queries
 *   - DuckDuckGo search provides real-time context with auto-retry fallback
 *   - Groq returns structured JSON via response_format: json_object
 *   - Single Groq call returns both articleText + imageKeyword
 *   - Unsplash API fetches editorial-quality images using descriptive keyword
 *   - Cloudinary Fetch URL wraps the image for CDN optimization
 *   - Firestore write for news + health tracking doc
 *
 * Health Tracking (system/cron_health):
 *   ✅ Success → { status: "✅ Success", timestamp, last_news_title }
 *   ❌ Failed  → { status: "❌ Failed", timestamp, error_message }
 */

import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { adminDb } from '@/lib/firebase-admin';
import { search, SafeSearchType, SearchTimeType } from 'duck-duck-scrape';

// ─── Config ──────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COLLECTION = 'news';
const HEALTH_DOC = 'system/cron_health';
const NEWS_TTL_HOURS = 24;
const DDG_RESULT_COUNT = 15;

// ─── Simple Query Generation ─────────────────────────────

const searchQueries = [
    // AI news
    'latest artificial intelligence news today',
    'AI breakthroughs and developments today',
    'OpenAI Google Microsoft AI news today',
    'new AI tools and products launched today',
    'AI industry updates and announcements',
    // Tech news
    'latest technology news today',
    'Nvidia AMD TSMC chip semiconductor news today',
    'big tech companies news today',
    'new tech products and launches today',
    'Silicon Valley startup news today',
    // Global / geopolitical tech
    'global technology regulation news today',
    'cybersecurity threats and updates today',
    'tech industry layoffs and hiring news',
    'space technology and innovation news today',
    'quantum computing robotics breakthrough news today',
];

function getRandomElement<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateDynamicQuery(): string {
    return getRandomElement(searchQueries);
}

function generateFallbackQuery(): string {
    // Always falls back to the broadest possible query
    const fallbacks = [
        'latest technology news today',
        'AI news and updates today',
        'big tech news today',
    ];
    return getRandomElement(fallbacks);
}

// ─── Detect category from query ───────────────────────────

function detectCategory(query: string): string {
    const q = query.toLowerCase();
    if (q.includes('ai') || q.includes('artificial intelligence') || q.includes('openai') || q.includes('nvidia')) return 'ai';
    if (q.includes('global') || q.includes('regulation') || q.includes('cybersecurity') || q.includes('geopolitical')) return 'world';
    return 'tech';
}

// ─── Helpers ─────────────────────────────────────────────────

function generateTitle(topic: string, category: string): string {
    const prefixes: Record<string, string[]> = {
        ai: [
            'AI Update:',
            'AI Development:',
            'AI News:',
            'AI Progress:',
        ],
        tech: [
            'Tech Update:',
            'Tech News:',
            'Technology:',
            'Industry Update:',
        ],
        world: [
            'Global Tech:',
            'World Update:',
            'Global News:',
            'World Tech:',
        ],
        general: [
            'Update:',
            'News:',
            'Report:',
        ],
    };
    const prefix = getRandomElement(prefixes[category] || prefixes.general);
    return `${prefix} ${topic}`;
}

// Extract a clean topic name from the dynamic query
function extractTopic(query: string): string {
    // Remove time modifiers to get the core topic
    const timePatterns = /\s*(latest breaking news|updates today|news \w+ \d+|fresh developments|this week|breaking today|\d+ breakthrough|exclusive update)$/i;
    let topic = query.replace(timePatterns, '').trim();
    // Remove AND/OR connectors for cleaner title
    topic = topic.replace(/\s+(AND|OR)\s+/g, ' & ');
    return topic;
}

// ─── DuckDuckGo Search ──────────────────────────────────────

async function searchDuckDuckGo(query: string): Promise<{ context: string; results: Array<{ title: string; description: string }> }> {
    try {
        console.log(`🔍 DuckDuckGo: searching "${query}"...`);

        const results = await Promise.race([
            search(query, {
                safeSearch: SafeSearchType.MODERATE,
                time: SearchTimeType.DAY,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('DuckDuckGo timeout')), 8000)
            ),
        ]);

        if (!results?.results || results.results.length === 0) {
            console.log('🔄 No recent results, retrying without time filter...');
            const retryResults = await Promise.race([
                search(query, {
                    safeSearch: SafeSearchType.MODERATE,
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('DuckDuckGo retry timeout')), 6000)
                ),
            ]);

            if (!retryResults?.results || retryResults.results.length === 0) {
                console.warn('⚠️ DuckDuckGo returned no results');
                return { context: '', results: [] };
            }

            const topResults = retryResults.results.slice(0, DDG_RESULT_COUNT);
            const context = topResults
                .map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`)
                .join('\n\n');
            console.log(`🔍 DuckDuckGo: ${topResults.length} results (unfiltered)`);
            return { context, results: topResults.map(r => ({ title: r.title, description: r.description })) };
        }

        const topResults = results.results.slice(0, DDG_RESULT_COUNT);
        const context = topResults
            .map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`)
            .join('\n\n');

        console.log(`🔍 DuckDuckGo: ${topResults.length} results for "${query}"`);
        return { context, results: topResults.map(r => ({ title: r.title, description: r.description })) };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ DuckDuckGo search failed: ${msg}`);
        return { context: '', results: [] };
    }
}

// ─── Unsplash Image Fetch ────────────────────────────────────

async function fetchUnsplashImage(keyword: string): Promise<string | null> {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey || accessKey === 'YOUR_KEY_HERE') {
        console.log('⚠️ UNSPLASH_ACCESS_KEY not configured — skipping image');
        return null;
    }

    try {
        const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(keyword)}&orientation=landscape&content_filter=high`;
        const res = await fetch(url, {
            headers: { Authorization: `Client-ID ${accessKey}` },
            signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
            console.warn(`⚠️ Unsplash API returned ${res.status}: ${res.statusText}`);
            return null;
        }

        const data = await res.json();
        const imageUrl = data?.urls?.regular || data?.urls?.small || null;

        if (imageUrl) {
            console.log(`🖼️ Unsplash image fetched for keyword: "${keyword}"`);
        }

        return imageUrl;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ Unsplash fetch failed: ${msg}`);
        return null;
    }
}

// ─── Cloudinary Fetch URL Builder ────────────────────────────

function buildCloudinaryFetchUrl(imageUrl: string): string {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dxlok864h';
    return `https://res.cloudinary.com/${cloudName}/image/fetch/f_auto,q_auto,w_800,h_450,c_fill/${imageUrl}`;
}

// ─── Parse JSON Responses ────────────────────────────────────

function parseArticleResponse(text: string): string {
    let clean = text.trim();
    if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    try {
        const parsed = JSON.parse(clean);
        if (parsed.articleText) return parsed.articleText.trim();
    } catch { /* not JSON, use raw text */ }
    return clean;
}

function parseImageKeyword(text: string): string {
    let clean = text.trim();
    if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    try {
        const parsed = JSON.parse(clean);
        if (parsed.imageKeyword) return parsed.imageKeyword.trim().toLowerCase();
    } catch { /* not JSON, use raw text */ }
    return clean.toLowerCase().replace(/["']/g, '').substring(0, 60);
}

// ─── Health Tracking ─────────────────────────────────────────

async function logHealth(
    status: '✅ Success' | '❌ Failed',
    details: Record<string, string>
) {
    try {
        await adminDb.doc(HEALTH_DOC).set({
            status,
            timestamp: new Date().toISOString(),
            last_run: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            ...details,
        });
    } catch (e) {
        console.error('Health log write failed:', e);
    }
}

// ─── Cleanup old articles ────────────────────────────────────

async function cleanupOldArticles() {
    const cutoff = new Date(Date.now() - NEWS_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const old = await adminDb.collection(COLLECTION).where('date', '<', cutoff).get();
    if (old.size > 0) {
        const batch = adminDb.batch();
        old.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`🧹 Cleaned ${old.size} old articles`);
    }
}

// ─── Duplicate check ─────────────────────────────────────────

function titleSimilarity(a: string, b: string): number {
    const wa = new Set(a.toLowerCase().split(/\s+/));
    const wb = new Set(b.toLowerCase().split(/\s+/));
    if (wa.size === 0 || wb.size === 0) return 0;
    let overlap = 0;
    wa.forEach(w => { if (wb.has(w)) overlap++; });
    return overlap / Math.min(wa.size, wb.size);
}

// ─── Main Pipeline ───────────────────────────────────────────

async function generateNews() {
    const t0 = Date.now();
    console.log('⚡ NEWS PIPELINE v8 — Groq Llama 4 + DuckDuckGo + Thumbnails');

    // 1. Generate dynamic search query
    const searchQuery = generateDynamicQuery();
    console.log('📰 Generated dynamic query:', searchQuery);

    // 2. Detect category from query
    const category = detectCategory(searchQuery);
    const topic = extractTopic(searchQuery);
    console.log(`📌 Category: ${category.toUpperCase()}, Topic: "${topic}"`);

    // 3. Init Groq
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) throw new Error('GROQ_API_KEY not set');
    const groq = new Groq({ apiKey: groqApiKey });

    // 4. Run DuckDuckGo search with AUTO-RETRY FALLBACK + cleanup + dedup check
    const [initialDdgResult, existingSnap] = await Promise.all([
        searchDuckDuckGo(searchQuery),
        adminDb.collection(COLLECTION).orderBy('date', 'desc').limit(50).get(),
        cleanupOldArticles(),
    ]);

    // Check if initial search returned usable data
    let scrapedData = initialDdgResult.results;
    let usedQuery = searchQuery;
    const totalTextLength = scrapedData.map((r: { title?: string; description?: string }) =>
        `${r.title || ''} ${r.description || ''}`
    ).join('').length;

    if (!scrapedData.length || totalTextLength < 50) {
        const fallbackQuery = generateFallbackQuery();
        console.log(`⚠️ Primary search weak (${scrapedData.length} results, ${totalTextLength} chars). Retrying with fallback: "${fallbackQuery}"`);
        const fallbackResult = await searchDuckDuckGo(fallbackQuery);
        if (fallbackResult.results.length > 0) {
            scrapedData = fallbackResult.results;
            usedQuery = fallbackQuery;
            console.log(`✅ Fallback search succeeded: ${scrapedData.length} results`);
        } else {
            console.log('⚠️ Fallback also empty — Llama will generate from general knowledge');
        }
    } else {
        console.log(`✅ Primary search OK: ${scrapedData.length} results, ${totalTextLength} chars`);
    }

    // 5. GROQ — Single call for BOTH articleText + imageKeyword
    const systemPrompt = `You are a strict, factual tech reporter. You MUST output valid JSON with exactly two keys: "articleText" and "imageKeyword". No other keys, no markdown, no explanation — ONLY the JSON object.`;

    const userPrompt = `Write a news article based on the search data below.

Today's date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

Search data:
${JSON.stringify(scrapedData, null, 2)}

STRICT RULES FOR articleText:
1. Write STRICTLY based on facts from the data. NO speculation, NO invented info.
2. Pick the single most prominent news event. Do NOT mix unrelated topics.
3. Write clean, professional prose. Rewrite facts naturally.
4. Structure as 2-3 well-developed paragraphs separated by double newlines.
5. Do NOT start with "In" or "The". Start punchy and attention-grabbing.
6. NEVER mention search queries, DuckDuckGo, scraped data, or internal details.
7. If data is empty, write about the most recent CONFIRMED, publicly known development.

WORD COUNT REQUIREMENT (CRITICAL):
- You MUST write BETWEEN 175 and 225 words. This is MANDATORY.
- Under 170 words is COMPLETELY UNACCEPTABLE.
- Count your words. If under 175, ADD factual context, background, or analysis.

RULES FOR imageKeyword:
- Based on your article, generate a 3-5 word cinematic Unsplash photo search phrase.
- Good examples: "nvidia gpu server rack closeup", "AI research lab dark screens", "semiconductor cleanroom neon light"
- Bad examples (too generic): "technology", "AI", "computer"

Return JSON: { "articleText": "your 175-225 word article", "imageKeyword": "your 3-5 word phrase" }`;

    // Llama 4 models on Groq
    const MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];
    let articleText = '';
    let imageKeyword = '';
    let usedModel = '';

    // Helper to call Groq
    async function callGroq(modelName: string, sysPrompt: string, usrPrompt: string): Promise<{ articleText: string; imageKeyword: string }> {
        const completion = await groq.chat.completions.create({
            model: modelName,
            messages: [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: usrPrompt },
            ],
            temperature: 0.4,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
        });

        const raw = completion.choices[0]?.message?.content?.trim() || '';
        if (!raw) throw new Error('Empty response');

        const article = parseArticleResponse(raw);
        let imgKw = 'futuristic artificial intelligence technology';
        try {
            const parsed = JSON.parse(raw);
            if (parsed.imageKeyword) imgKw = parsed.imageKeyword.trim().toLowerCase();
        } catch { /* use fallback */ }

        return { articleText: article, imageKeyword: imgKw };
    }

    // --- Single Groq call with model fallback + word count retry ---
    for (const modelName of MODELS) {
        try {
            console.log(`🔄 Trying Groq model: ${modelName}`);
            const result = await callGroq(modelName, systemPrompt, userPrompt);
            articleText = result.articleText;
            imageKeyword = result.imageKeyword;
            usedModel = modelName;

            const firstWordCount = articleText.split(/\s+/).length;
            console.log(`📝 First attempt: ${firstWordCount} words, image: "${imageKeyword}"`);

            // AUTO-RETRY if too short
            if (firstWordCount < 170) {
                console.log(`⚠️ Too short (${firstWordCount} words), retrying...`);
                const retryUserPrompt = `${userPrompt}

CRITICAL CORRECTION: Your previous attempt was ONLY ${firstWordCount} words. UNACCEPTABLE.
You MUST write AT LEAST 175 words and NO MORE than 225 words.
Expand with more factual details, background context, industry implications.
Do NOT repeat the same content. ADD NEW substantive information.`;

                try {
                    const retryResult = await callGroq(modelName, systemPrompt, retryUserPrompt);
                    const retryWordCount = retryResult.articleText.split(/\s+/).length;
                    console.log(`📝 Retry: ${retryWordCount} words`);

                    if (retryWordCount > firstWordCount) {
                        articleText = retryResult.articleText;
                        imageKeyword = retryResult.imageKeyword;
                        console.log(`✅ Retry accepted: ${retryWordCount} words`);
                    }
                } catch {
                    console.warn('⚠️ Retry failed, keeping first attempt');
                }
            }

            console.log(`✅ Success with: ${modelName}`);
            break;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ ${modelName} failed: ${msg.substring(0, 200)}`);
            articleText = '';
        }
    }

    if (!articleText) throw new Error('All Groq models failed for article generation');

    const wordCount = articleText.split(/\s+/).length;
    console.log(`📝 Article (${usedModel}): ${wordCount} words, imageKeyword: "${imageKeyword}"`);

    // 8. Generate title and check dups
    const title = generateTitle(topic, category);
    const existingTitles = existingSnap.docs.map(d => d.data().title as string);
    const isDup = existingTitles.some(t => titleSimilarity(title, t) >= 0.85);

    if (isDup) {
        console.log('⚠️ Duplicate detected — skipping save');
        await logHealth('✅ Success', {
            last_news_title: title,
            note: 'Duplicate — not saved',
            duration_ms: `${Date.now() - t0}`,
        });
        return { status: 'duplicate', title, duration_ms: Date.now() - t0 };
    }

    // 9. Fetch image from Unsplash + wrap with Cloudinary
    let imageUrl: string | null = null;
    const unsplashUrl = await fetchUnsplashImage(imageKeyword);
    if (unsplashUrl) {
        imageUrl = buildCloudinaryFetchUrl(unsplashUrl);
        console.log(`🌐 Cloudinary URL: ${imageUrl.substring(0, 80)}...`);
    } else {
        console.log('📷 No image — article will be saved without thumbnail');
    }

    // 10. Save to Firestore
    const newsItem = {
        id: crypto.randomUUID(),
        title,
        summary: articleText,
        image_url: imageUrl,
        source_link: null,
        source_name: 'XeL AI News',
        category,
        date: new Date().toISOString(),
    };

    await adminDb.collection(COLLECTION).doc(newsItem.id).set(newsItem);
    const duration = Date.now() - t0;
    console.log(`✅ Saved: "${title}" in ${duration}ms`);

    // 11. Log health ✅
    await logHealth('✅ Success', {
        last_news_title: title,
        category,
        word_count: `${wordCount}`,
        image_keyword: imageKeyword,
        has_image: imageUrl ? 'yes' : 'no',
        ddg_query: usedQuery,
        ddg_results: `${scrapedData.length}`,
        duration_ms: `${duration}`,
    });

    return {
        status: 'ok',
        saved: 1,
        title,
        category,
        word_count: wordCount,
        image_keyword: imageKeyword,
        has_image: !!imageUrl,
        ddg_query: usedQuery,
        ddg_results: scrapedData.length,
        duration_ms: duration,
    };
}

// ─── Route Handler ───────────────────────────────────────────

export async function GET(req: Request) {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (token !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await generateNews();
        return NextResponse.json({
            ...result,
            timestamp: new Date().toISOString(),
        });
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        console.error('❌ Pipeline failed:', errorMsg);

        await logHealth('❌ Failed', { error_message: errorMsg });

        return NextResponse.json(
            { status: 'error', error: errorMsg },
            { status: 500 }
        );
    }
}
