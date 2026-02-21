/**
 * /api/cron/generate-news — AI News Generator v7 (Gemini + DuckDuckGo + Thumbnails)
 * =============================================================================
 * Pipeline: Dynamic Query → DuckDuckGo Search → Gemini (strict factual JSON) →
 *           Unsplash (descriptive keyword) → Cloudinary → Firestore.
 *
 * Architecture:
 *   - Simple Query Generation: random selection from curated search queries
 *   - DuckDuckGo search provides real-time context with auto-retry fallback
 *   - Gemini returns structured JSON via responseMimeType: application/json
 *   - TWO separate Gemini calls: (1) article text, (2) image keyword
 *   - Unsplash API fetches editorial-quality images using descriptive keyword
 *   - Cloudinary Fetch URL wraps the image for CDN optimization
 *   - Firestore write for news + health tracking doc
 *
 * Health Tracking (system/cron_health):
 *   ✅ Success → { status: "✅ Success", timestamp, last_news_title }
 *   ❌ Failed  → { status: "❌ Failed", timestamp, error_message }
 */

import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
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
    console.log('⚡ NEWS PIPELINE v7 — Gemini + DuckDuckGo + Thumbnails');

    // 1. Generate dynamic search query
    const searchQuery = generateDynamicQuery();
    console.log('📰 Generated dynamic query:', searchQuery);

    // 2. Detect category from query
    const category = detectCategory(searchQuery);
    const topic = extractTopic(searchQuery);
    console.log(`📌 Category: ${category.toUpperCase()}, Topic: "${topic}"`);

    // 3. Init Gemini
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY not set');
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

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
        // FALLBACK: initial search was empty/weak — try a general topic
        const fallbackQuery = generateFallbackQuery();
        console.log(`⚠️ Primary search weak (${scrapedData.length} results, ${totalTextLength} chars). Retrying with fallback: "${fallbackQuery}"`);
        const fallbackResult = await searchDuckDuckGo(fallbackQuery);
        if (fallbackResult.results.length > 0) {
            scrapedData = fallbackResult.results;
            usedQuery = fallbackQuery;
            console.log(`✅ Fallback search succeeded: ${scrapedData.length} results`);
        } else {
            console.log('⚠️ Fallback also empty — Gemini will generate from general knowledge');
        }
    } else {
        console.log(`✅ Primary search OK: ${scrapedData.length} results, ${totalTextLength} chars`);
    }

    // 5. GEMINI CALL 1 — Generate the NEWS ARTICLE (articleText only)
    const articlePrompt = `You are a strict, factual tech reporter writing for a premium news publication.

Today's date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

Search data:
${JSON.stringify(scrapedData, null, 2)}

STRICT RULES:
1. Write STRICTLY based on facts from the data. NO speculation, NO invented info.
2. Pick the single most prominent news event. Do NOT mix unrelated topics.
3. Write clean, professional prose. Rewrite facts naturally — do not copy-paste raw snippets.
4. Structure as 2-3 well-developed paragraphs separated by double newlines (\\n\\n).
5. Do NOT start with "In" or "The". Start punchy and attention-grabbing.
6. NEVER mention search queries, DuckDuckGo, scraped data, or any internal pipeline details.
7. If scraped data is empty, write about the most recent CONFIRMED, publicly known development.

WORD COUNT REQUIREMENT (CRITICAL — READ CAREFULLY):
- You MUST write BETWEEN 175 and 225 words. This is MANDATORY.
- An article under 170 words is COMPLETELY UNACCEPTABLE and will be REJECTED.
- Count your words carefully before submitting. If your draft is under 175 words, ADD more factual context, background information, industry impact, or expert analysis to reach at least 175 words.
- Do NOT pad with filler. Add substantive, relevant information.

Return JSON with exactly one key: { "articleText": "your 175-225 word article here" }`;

    const MODELS = ['gemini-3.0-flash', 'gemini-2.5-flash'];
    let articleText = '';
    let imageKeyword = '';
    let usedModel = '';

    // Helper function to call Gemini for article generation
    async function callGeminiArticle(modelName: string, prompt: string): Promise<string> {
        const result = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
                temperature: 0.4,
                maxOutputTokens: 4096,
                responseMimeType: 'application/json',
            },
        });
        const raw = result.text?.trim() || '';
        if (!raw) throw new Error('Empty response');
        return parseArticleResponse(raw);
    }

    // --- Call 1: News Article (with auto-retry for word count) ---
    for (const modelName of MODELS) {
        try {
            console.log(`🔄 [Article] Trying Gemini model: ${modelName}`);
            articleText = await callGeminiArticle(modelName, articlePrompt);
            usedModel = modelName;

            const firstWordCount = articleText.split(/\s+/).length;
            console.log(`📝 [Article] First attempt: ${firstWordCount} words`);

            // AUTO-RETRY: If too short, retry with explicit word count feedback
            if (firstWordCount < 170) {
                console.log(`⚠️ [Article] Too short (${firstWordCount} words), retrying with stronger prompt...`);
                const retryPrompt = `${articlePrompt}

CRITICAL CORRECTION: Your previous attempt was ONLY ${firstWordCount} words. This is UNACCEPTABLE.
You MUST write AT LEAST 175 words and NO MORE than 225 words.
Expand the article with more factual details, background context, industry implications, or analysis.
Do NOT just repeat the same content. ADD NEW substantive information.

Return JSON: { "articleText": "your expanded 175-225 word article" }`;

                try {
                    const retryText = await callGeminiArticle(modelName, retryPrompt);
                    const retryWordCount = retryText.split(/\s+/).length;
                    console.log(`📝 [Article] Retry attempt: ${retryWordCount} words`);

                    // Use retry if it's longer than the first attempt
                    if (retryWordCount > firstWordCount) {
                        articleText = retryText;
                        console.log(`✅ [Article] Retry accepted: ${retryWordCount} words`);
                    } else {
                        console.log(`⚠️ [Article] Retry not better, keeping first attempt`);
                    }
                } catch (retryErr) {
                    console.warn('⚠️ [Article] Retry failed, keeping first attempt');
                }
            }

            console.log(`✅ [Article] Final success with: ${modelName}`);
            break;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ ${modelName} failed: ${msg.substring(0, 200)}`);
            // Always try the next model — don't throw on any error
            articleText = '';
        }
    }

    if (!articleText) throw new Error('All Gemini models failed for article generation');

    const wordCount = articleText.split(/\s+/).length;
    console.log(`📝 Article (${usedModel}): ${wordCount} words (final)`);

    // --- 3-second cooldown before image call to avoid Gemini rate limits ---
    console.log('⏳ Waiting 3 seconds before image keyword call...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // --- Call 2: Image Keyword (SEPARATE Gemini call based on article) ---
    const imagePrompt = `Based on this news article, generate a 3-5 word cinematic Unsplash photo search phrase (maximum 15 words) that would produce a stunning, relevant editorial photograph.

Article: "${articleText.substring(0, 400)}"

Good examples: "nvidia gpu server rack closeup", "AI research lab dark screens", "semiconductor cleanroom neon light", "quantum computing processor macro", "robot arm factory assembly", "cybersecurity dark hacker terminal glow", "data center corridor blue lights", "tech conference keynote stage lights", "silicon wafer golden chip manufacturing", "autonomous vehicle lidar sensor night", "neural network brain digital art", "stock market trading screens wall", "microchip circuit board extreme macro", "space satellite earth orbit", "Indian tech startup office modern"
Bad examples (too generic): "technology", "AI", "computer", "robot", "chip"

Return JSON with exactly one key: { "imageKeyword": "your 3-5 word phrase" }`;

    for (const imgModel of MODELS) {
        try {
            console.log(`🎨 [Image] Trying Gemini model: ${imgModel}`);
            const imageResult = await ai.models.generateContent({
                model: imgModel,
                contents: imagePrompt,
                config: {
                    temperature: 0.5,
                    maxOutputTokens: 150,
                    responseMimeType: 'application/json',
                },
            });

            const imageRaw = imageResult.text?.trim() || '';
            imageKeyword = parseImageKeyword(imageRaw);
            console.log(`🎨 [Image] Keyword: "${imageKeyword}"`);
            break; // success — exit loop
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ [Image] ${imgModel} failed: ${msg.substring(0, 100)}`);
            imageKeyword = 'futuristic artificial intelligence technology lab';
        }
    }

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
