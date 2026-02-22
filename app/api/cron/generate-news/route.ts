/**
 * /api/cron/generate-news — AI News Generator v10 (Cerebras GPT-OSS 120B + Tavily + Thumbnails)
 * =============================================================================
 * Pipeline: Dynamic Query → Tavily Search → Cerebras (GPT-OSS 120B strict factual JSON) →
 *           Unsplash (descriptive keyword) → Cloudinary → Firestore.
 *
 * Architecture:
 *   - Simple Query Generation: random selection from curated search queries
 *   - Tavily AI search provides LLM-optimized real-time news context
 *   - Cerebras returns structured JSON via response_format: json_object
 *   - Single Cerebras call returns both articleText + imageKeyword
 *   - Unsplash API fetches editorial-quality images using descriptive keyword
 *   - Cloudinary Fetch URL wraps the image for CDN optimization
 *   - Firestore write for news + health tracking doc
 *
 * Health Tracking (system/cron_health):
 *   ✅ Success → { status: "✅ Success", timestamp, last_news_title }
 *   ❌ Failed  → { status: "❌ Failed", timestamp, error_message }
 */

import { NextResponse } from 'next/server';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { adminDb } from '@/lib/firebase-admin';
import { tavily } from '@tavily/core';

// ─── Config ──────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COLLECTION = 'news';
const HEALTH_DOC = 'system/cron_health';
const NEWS_TTL_HOURS = 24;
const TAVILY_RESULT_COUNT = 10;

// ─── Simple Query Generation ─────────────────────────────

const searchQueries = [
    // AI & ML (broad, reliable queries)
    'artificial intelligence latest news',
    'AI breakthroughs developments',
    'OpenAI Google DeepMind AI announcements',
    'generative AI tools products launches',
    'AI industry updates acquisitions funding',
    'machine learning research papers breakthroughs',
    // Tech industry
    'technology news today',
    'Nvidia AMD semiconductor chip news',
    'Apple Google Microsoft tech announcements',
    'tech startup funding unicorn news',
    'cloud computing AWS Azure Google Cloud updates',
    // Emerging tech
    'cybersecurity threats data breach news',
    'space technology SpaceX NASA news',
    'quantum computing breakthrough news',
    'robotics automation industry news',
    'electric vehicle EV autonomous driving news',
    // Digital economy
    'tech regulation antitrust policy news',
    'social media platform changes updates',
];

function getRandomElement<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateDynamicQuery(): string {
    return getRandomElement(searchQueries);
}

function generateFallbackQuery(): string {
    const fallbacks = [
        'technology news',
        'AI artificial intelligence news',
        'tech industry news',
        'latest tech announcements',
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

// ─── Tavily Search ──────────────────────────────────────────

async function searchTavilyWithKey(apiKey: string, query: string, daysBack: number): Promise<{ context: string; results: Array<{ title: string; description: string }> }> {
    const client = tavily({ apiKey });

    const response = await client.search(query, {
        searchDepth: 'advanced',
        topic: 'news',
        days: daysBack,
        maxResults: TAVILY_RESULT_COUNT,
        includeAnswer: false,
    });

    if (!response?.results || response.results.length === 0) {
        return { context: '', results: [] };
    }

    const mapped = response.results.map((r: { title: string; content: string; url: string }) => ({
        title: r.title,
        description: r.content,
    }));

    const context = mapped
        .map((r: { title: string; description: string }, i: number) => `[${i + 1}] ${r.title}\n${r.description}`)
        .join('\n\n');

    return { context, results: mapped };
}

async function searchTavily(query: string, daysBack: number = 3): Promise<{ context: string; results: Array<{ title: string; description: string }> }> {
    const keys = [
        process.env.TAVILY_API_KEY,
        process.env.TAVILY_API_KEY_2,
    ].filter(Boolean) as string[];

    if (keys.length === 0) {
        console.warn('⚠️ No TAVILY_API_KEY set — skipping search');
        return { context: '', results: [] };
    }

    for (let i = 0; i < keys.length; i++) {
        const label = i === 0 ? 'primary' : 'fallback';
        try {
            console.log(`🔍 Tavily (${label}): searching "${query}" (last ${daysBack} days)...`);
            const result = await searchTavilyWithKey(keys[i], query, daysBack);

            if (result.results.length === 0) {
                console.warn(`⚠️ Tavily (${label}) returned no results for "${query}" (${daysBack} days)`);
                continue;
            }

            console.log(`🔍 Tavily (${label}): ${result.results.length} results for "${query}"`);
            return result;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ Tavily (${label}) failed: ${msg}`);
            if (i < keys.length - 1) {
                console.log('🔄 Switching to fallback Tavily API key...');
            }
        }
    }

    console.warn('⚠️ All Tavily keys exhausted — no results');
    return { context: '', results: [] };
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
    console.log('⚡ NEWS PIPELINE v10 — Cerebras GPT-OSS 120B + Tavily + Thumbnails');

    // 1. Generate dynamic search query
    const searchQuery = generateDynamicQuery();
    console.log('📰 Generated dynamic query:', searchQuery);

    // 2. Detect category from query
    const category = detectCategory(searchQuery);
    const topic = extractTopic(searchQuery);
    console.log(`📌 Category: ${category.toUpperCase()}, Topic: "${topic}"`);

    // 3. Init Cerebras
    const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
    if (!cerebrasApiKey) throw new Error('CEREBRAS_API_KEY not set');
    const cerebras = new Cerebras({ apiKey: cerebrasApiKey });

    // 4. Run Tavily search (3 days) + cleanup + dedup check
    const [initialSearchResult, existingSnap] = await Promise.all([
        searchTavily(searchQuery, 3),
        adminDb.collection(COLLECTION).orderBy('date', 'desc').limit(50).get(),
        cleanupOldArticles(),
    ]);

    // Check if initial search returned usable data
    let scrapedData = initialSearchResult.results;
    let usedQuery = searchQuery;
    const totalTextLength = scrapedData.map((r: { title?: string; description?: string }) =>
        `${r.title || ''} ${r.description || ''}`
    ).join('').length;

    if (!scrapedData.length || totalTextLength < 50) {
        // Fallback 1: broader query, still 3 days
        const fallbackQuery = generateFallbackQuery();
        console.log(`⚠️ Primary search weak (${scrapedData.length} results, ${totalTextLength} chars). Trying fallback: "${fallbackQuery}"`);
        const fallbackResult = await searchTavily(fallbackQuery, 3);
        if (fallbackResult.results.length > 0) {
            scrapedData = fallbackResult.results;
            usedQuery = fallbackQuery;
            console.log(`✅ Fallback search succeeded: ${scrapedData.length} results`);
        } else {
            // Fallback 2: even broader, 7 days
            console.log('⚠️ 3-day fallback empty. Trying 7-day window...');
            const widerResult = await searchTavily('latest technology AI news', 7);
            if (widerResult.results.length > 0) {
                scrapedData = widerResult.results;
                usedQuery = 'latest technology AI news (7d)';
                console.log(`✅ 7-day search succeeded: ${scrapedData.length} results`);
            } else {
                console.error('❌ All search attempts failed — cannot generate news without data');
                throw new Error('No search results found after all fallback attempts');
            }
        }
    } else {
        console.log(`✅ Primary search OK: ${scrapedData.length} results, ${totalTextLength} chars`);
    }

    // 5. CEREBRAS — Single call for BOTH articleText + imageKeyword
    const systemPrompt = `You are a strict, factual tech journalist. You MUST output valid JSON with exactly two keys: "articleText" and "imageKeyword". No other keys, no markdown, no explanation — ONLY the JSON object.`;

    const userPrompt = `Write a news article based ONLY on the search results below.

Search results:
${JSON.stringify(scrapedData, null, 2)}

STRICT RULES FOR articleText:
1. Write STRICTLY based on facts from the search results above. NO speculation, NO invented info.
2. Pick the single most prominent or interesting news story. Do NOT mix unrelated topics.
3. Write clean, professional prose that a news reader would enjoy. Rewrite facts naturally.
4. Structure as 2-3 well-developed paragraphs separated by double newlines.
5. Start with a punchy, attention-grabbing opening. Do NOT start with "In" or "The".
6. NEVER mention search engines, APIs, scraped data, prompts, or internal system details.
7. NEVER include specific dates like "as of February 2026" or "on February 22". Write timelessly — use phrases like "recently", "this week", or just state the news directly without date references.
8. Include relevant context: who, what, where, why, and implications.

WORD COUNT REQUIREMENT (CRITICAL):
- You MUST write BETWEEN 175 and 225 words. This is MANDATORY.
- Under 170 words is COMPLETELY UNACCEPTABLE.
- Count your words. If under 175, ADD factual context, background, or analysis.

RULES FOR imageKeyword:
- Based on your article, generate a 3-5 word cinematic Unsplash photo search phrase.
- Good examples: "nvidia gpu server rack closeup", "AI research lab dark screens", "semiconductor cleanroom neon light"
- Bad examples (too generic): "technology", "AI", "computer"

Return JSON: { "articleText": "your 175-225 word article", "imageKeyword": "your 3-5 word phrase" }`;

    // Models available on Cerebras (gpt-oss-120b for quality, llama3.1-8b as fallback)
    const MODELS = ['gpt-oss-120b', 'llama3.1-8b'];
    let articleText = '';
    let imageKeyword = '';
    let usedModel = '';

    // Helper to call Cerebras
    async function callCerebras(modelName: string, sysPrompt: string, usrPrompt: string): Promise<{ articleText: string; imageKeyword: string }> {
        const completion = await cerebras.chat.completions.create({
            model: modelName,
            messages: [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: usrPrompt },
            ],
            temperature: 0.4,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
        }) as { choices: Array<{ message: { content: string | null } }> };

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

    // --- Single Cerebras call with model fallback + word count retry ---
    for (const modelName of MODELS) {
        try {
            console.log(`🔄 Trying Cerebras model: ${modelName}`);
            const result = await callCerebras(modelName, systemPrompt, userPrompt);
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
                    const retryResult = await callCerebras(modelName, systemPrompt, retryUserPrompt);
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

    if (!articleText) throw new Error('All Cerebras models failed for article generation');

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
        search_query: usedQuery,
        search_results: `${scrapedData.length}`,
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
        search_query: usedQuery,
        search_results: scrapedData.length,
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
