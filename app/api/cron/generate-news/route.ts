/**
 * /api/cron/generate-news — AI News Generator v5 (Dynamic Query + Thumbnails)
 * =============================================================================
 * Pipeline: Dynamic Query → DuckDuckGo Search → Gemini (elite journalist) →
 *           Unsplash (descriptive keyword) → Cloudinary → Firestore.
 *
 * Architecture:
 *   - Dynamic Query Generation Algorithm: randomized keyword combos from
 *     6 categories (AI Models, Tech Giants, Sub-Niches, Indian AI, World, General)
 *   - DuckDuckGo search provides real-time context to Gemini
 *   - Gemini returns structured JSON: articleText + imageKeyword
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
const DDG_RESULT_COUNT = 8;

// ─── Dynamic Query Generation Algorithm ─────────────────────

const keywordCategories: Record<string, string[]> = {
    coreGiants: ['OpenAI', 'Google DeepMind', 'Microsoft AI', 'Anthropic', 'Meta AI', 'Apple Intelligence', 'Amazon AWS AI', 'xAI', 'Hugging Face'],
    aiHardware: ['Nvidia', 'AMD', 'TSMC', 'ARM', 'Qualcomm AI', 'Custom AI Silicon'],
    globalModels: ['DeepSeek R1', 'Qwen 2.5', 'Llama 3.5', 'Mistral Large', 'Gemini 2.0', 'Claude 3.5', 'Grok 3'],
    subNiches: ['Autonomous Agents', 'AI Robotics', 'Quantum Computing', 'AI Safety', 'Synthetic Data', 'Edge AI'],
    indianAI: ['Sarvam AI', 'Krutrim AI', 'India AI Mission', 'Bhashini', 'Reliance Jio AI', 'Tata AI'],
    worldNews: ['US-China AI tech war', 'EU AI Act', 'AI chip export bans', 'Global AI regulation', 'Tech layoffs 2026'],
};

// Anchor categories (60% weight) — the heavy-hitters
const ANCHOR_CATEGORIES = ['coreGiants', 'aiHardware', 'globalModels'];
// Wildcard categories (40% weight) — variety and niche topics
const WILDCARD_CATEGORIES = ['subNiches', 'indianAI', 'worldNews'];

function getRandomElement<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateDynamicQuery(): string {
    // 60/40 weighted single-keyword selection — NO multi-keyword combos
    let keyword: string;

    if (Math.random() < 0.6) {
        // ── 60% ANCHOR: one keyword from core categories ──
        const cat = getRandomElement(ANCHOR_CATEGORIES);
        keyword = getRandomElement(keywordCategories[cat]);
    } else {
        // ── 40% WILDCARD: one keyword from niche/world categories ──
        const cat = getRandomElement(WILDCARD_CATEGORIES);
        keyword = getRandomElement(keywordCategories[cat]);
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.toLocaleString('en-US', { month: 'long' });
    const timeModifiers = [
        'latest news today', 'recent updates', `news ${month} ${year}`,
        'latest developments', `${year} update`, 'news today',
    ];

    return `${keyword} ${getRandomElement(timeModifiers)}`.trim();
}

// ─── Detect category from dynamic query ─────────────────────

function detectCategory(query: string): string {
    const q = query.toLowerCase();
    const aiPatterns = ['openai', 'deepmind', 'microsoft ai', 'anthropic', 'meta ai',
        'apple intelligence', 'amazon aws ai', 'xai', 'hugging face',
        'nvidia', 'amd', 'tsmc', 'arm', 'qualcomm', 'custom ai silicon',
        'deepseek', 'qwen', 'llama', 'mistral', 'gemini', 'claude', 'grok',
        'autonomous agent', 'ai robot', 'quantum', 'ai safety', 'synthetic data', 'edge ai'];
    const indiaPatterns = ['sarvam', 'krutrim', 'india ai', 'bhashini', 'jio ai', 'tata ai'];
    const worldPatterns = ['us-china', 'eu ai act', 'chip export', 'global ai regulation',
        'tech layoffs'];

    if (indiaPatterns.some(p => q.includes(p))) return 'ai';
    if (worldPatterns.some(p => q.includes(p))) return 'world';
    if (aiPatterns.some(p => q.includes(p))) return 'ai';
    return Math.random() > 0.3 ? 'ai' : 'world';
}

// ─── Helpers ─────────────────────────────────────────────────

function generateTitle(topic: string, category: string): string {
    const prefixes: Record<string, string[]> = {
        ai: [
            'Breaking: Major AI Breakthrough in',
            'AI Industry Shakeup:',
            'Next-Gen AI:',
            'AI Revolution:',
            'Exclusive:',
            'Breaking:',
        ],
        general: [
            'Global Update:',
            'Breaking:',
            'Major Development:',
            'World Report:',
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

// ─── Parse Gemini JSON Response ──────────────────────────────

function parseGeminiResponse(text: string): { articleText: string; imageKeyword: string } {
    let clean = text.trim();
    if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
        const parsed = JSON.parse(clean);
        if (parsed.articleText && parsed.imageKeyword) {
            return {
                articleText: parsed.articleText.trim(),
                imageKeyword: parsed.imageKeyword.trim().toLowerCase(),
            };
        }
    } catch {
        // JSON parse failed — fall back
    }

    console.warn('⚠️ Could not parse JSON from Gemini — using fallback');
    return {
        articleText: text.trim(),
        imageKeyword: 'futuristic artificial intelligence technology lab',
    };
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
    console.log('⚡ NEWS PIPELINE v5 — Dynamic Query + DuckDuckGo + Thumbnails');

    // 1. Generate dynamic search query
    const searchQuery = generateDynamicQuery();
    console.log('📰 Generated dynamic query:', searchQuery);

    // 2. Detect category from query
    const category = detectCategory(searchQuery);
    const topic = extractTopic(searchQuery);
    console.log(`📌 Category: ${category.toUpperCase()}, Topic: "${topic}"`);

    // 3. Init Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    const ai = new GoogleGenAI({ apiKey });

    // 4. Run DuckDuckGo search + cleanup + dedup check in parallel
    const [ddgResult, existingSnap] = await Promise.all([
        searchDuckDuckGo(searchQuery),
        adminDb.collection(COLLECTION).orderBy('date', 'desc').limit(50).get(),
        cleanupOldArticles(),
    ]);

    const scrapedData = ddgResult.results;

    // 5. Build the strict factual reporter prompt with live context
    const userPrompt = `You are a strict, factual tech reporter.
The user searched DuckDuckGo for: "${searchQuery}"

Here is the raw scraped data:
${JSON.stringify(scrapedData, null, 2)}

CRITICAL RULES:
1. NO SPECULATION. Base your 150-200 word article STRICTLY on the facts provided in the scraped data.
2. Do not invent rumors, future partnerships, or exclusive leaks. If it is not in the DuckDuckGo data, DO NOT write it.
3. If the scraped data contains mixed or weak links, find the most prominent factual news event in the text and report ONLY on that.
4. Maintain a professional, objective journalistic tone.
5. Do NOT start with the word "In" or "The". Start with something punchy and attention-grabbing.
6. Write as if reporting news happening TODAY (${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}).
7. If the scraped data is completely empty, write about the most recent CONFIRMED, PUBLICLY KNOWN development for the query topic. Do not speculate.

You MUST return the response in strict JSON format with exactly TWO keys:
1. "articleText": The strictly factual 150-200 word article in 2-3 flowing paragraphs. NO bullet points, NO lists, NO headers.
2. "imageKeyword": A highly relevant 3-5 word cinematic Unsplash search phrase for a stunning editorial photograph.
   EXCELLENT examples: "nvidia gpu server rack closeup", "AI research lab dark screens", "semiconductor cleanroom neon light", "quantum computing processor macro", "robot arm factory assembly", "space satellite earth orbit"
   BAD examples: "technology", "robot", "AI", "computer"

Output ONLY the raw JSON object. No markdown code fences, no backticks, no explanation.`;

    // Model fallback chain
    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    let responseText = '';
    let usedModel = '';

    // 6. Call Gemini (no Google Search — we provide DuckDuckGo context)
    async function callGemini(modelName: string, contentText: string): Promise<string> {
        const result = await ai.models.generateContent({
            model: modelName,
            contents: contentText,
            config: {
                temperature: 0.95,
                maxOutputTokens: 2048,
                topP: 0.95,
            },
        });
        return result.text?.trim() || '';
    }

    for (const modelName of MODELS) {
        try {
            console.log(`🔄 Trying model: ${modelName}`);
            responseText = await callGemini(modelName, userPrompt);
            if (!responseText) throw new Error('Empty response');

            // Check word count — retry once if too short
            const parsed = parseGeminiResponse(responseText);
            const firstWordCount = parsed.articleText.split(/\s+/).length;
            if (firstWordCount < 80) {
                console.log(`⚠️ First attempt too short (${firstWordCount} words), retrying...`);
                const retryPrompt = userPrompt + `\n\nCRITICAL: Your previous attempt was only ${firstWordCount} words. You MUST write 150-200 words in 2-3 paragraphs. The imageKeyword MUST be 3-5 descriptive words for a cinematic photo. Output ONLY valid JSON.`;
                const retryText = await callGemini(modelName, retryPrompt);
                if (retryText) {
                    const retryParsed = parseGeminiResponse(retryText);
                    if (retryParsed.articleText.split(/\s+/).length > firstWordCount) {
                        responseText = retryText;
                        console.log(`✅ Retry produced ${retryParsed.articleText.split(/\s+/).length} words`);
                    }
                }
            }

            usedModel = modelName;
            console.log(`✅ Success with: ${modelName}`);
            break;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ ${modelName} failed: ${msg.substring(0, 100)}`);
            if (!msg.includes('429') && !msg.includes('quota') && !msg.includes('rate') && !msg.includes('not found')) {
                throw err;
            }
        }
    }

    if (!responseText) throw new Error('All Gemini models failed');

    // 7. Parse the structured JSON response
    const { articleText, imageKeyword } = parseGeminiResponse(responseText);
    const wordCount = articleText.split(/\s+/).length;
    console.log(`📝 Response (${usedModel}): ${wordCount} words, keyword: "${imageKeyword}"`);

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
        ddg_query: searchQuery,
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
        ddg_query: searchQuery,
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
