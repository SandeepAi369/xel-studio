/**
 * /api/cron/generate-news — AI News Generator v12 (Cerebras GPT-OSS 120B + Tavily + FLUX.1-schnell)
 * =============================================================================
 * Pipeline: Load URL History → Dynamic Query → Tavily Search → URL Dedup →
 *           Cerebras (GPT-OSS 120B strict factual JSON) → Pollinations FLUX (AI image) →
 *           Cloudinary (upload) → Firestore → Save to History.
 *
 *
 * Architecture:
 *   - Smart 10-Day History: news_history collection stores all source URLs
 *   - Strict URL-based dedup: only exact URL matches are filtered (no title guessing)
 *   - Related updates on same topic with different URLs pass through
 *   - Tavily AI search provides LLM-optimized real-time news context
 *   - Cerebras returns structured JSON via response_format: json_object
 *   - Pollinations.ai generates high-quality FLUX dev images (free, unlimited, no API key)
 *   - Cloudinary direct upload for CDN-optimized delivery
 *   - Firestore write for news + health tracking doc
 *   - Cleanup is handled by separate /api/cron/cleanup-history route
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
const HISTORY_COLLECTION = 'news_history';
const HEALTH_DOC = 'system/cron_health';
const HISTORY_TTL_DAYS = 10;
const TAVILY_RESULT_COUNT = 10;

// ─── Search Queries (categorized) ────────────────────────

const searchQueries = [
    // ── AI & Tech (merged category) ──
    'artificial intelligence latest news breakthroughs',
    'OpenAI Google DeepMind Anthropic AI announcements',
    'generative AI tools products launches',
    'AI industry acquisitions funding deals',
    'Nvidia AMD semiconductor chip AI hardware news',
    'Apple Google Microsoft tech announcements',
    'Sam Altman Sundar Pichai Satya Nadella CEO statements AI',
    'Elon Musk xAI Grok AI news',
    'Meta AI Mark Zuckerberg announcements',
    'Amazon AWS Bedrock AI cloud updates',
    'AI regulation policy government updates',
    'machine learning research papers breakthroughs',
    'robotics automation AI industry news',
    'quantum computing AI breakthrough news',
    'cybersecurity AI threats data breach news',
    'tech startup unicorn funding news',
    'cloud computing infrastructure updates',
    'space technology SpaceX NASA news',
    'electric vehicle autonomous driving AI news',
    // ── Disability ──
    'disability technology assistive tech accessibility news',
    'disability rights inclusion policy news',
    'accessible technology innovations disabled people',
    'disability employment inclusion workplace news',
    'disability awareness advocacy campaign news',
    'assistive devices AI disability healthcare',
    'special education disability inclusion schools news',
    'disability sports paralympics achievements news',
    // ── World ──
    'global technology regulation policy news',
    'geopolitical technology competition news',
    'international tech policy digital sovereignty',
    'global economy technology impact news',
    'climate technology clean energy innovation news',
    // ── General ──
    'social media platform changes updates news',
    'healthcare technology innovation news',
    'education technology digital learning news',
    'fintech digital payments banking innovation news',
    'entertainment streaming gaming industry news',
    'science discovery research breakthrough news',
];

function getRandomElement<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateDynamicQuery(): string {
    return getRandomElement(searchQueries);
}

function generateFallbackQuery(): string {
    const fallbacks = [
        'technology AI news today',
        'latest tech announcements',
        'disability accessibility news',
        'science innovation news',
    ];
    return getRandomElement(fallbacks);
}

// ─── Detect category from query ───────────────────────────

function detectCategory(query: string): string {
    const q = query.toLowerCase();
    // Disability keywords
    if (q.includes('disability') || q.includes('assistive') || q.includes('accessible') ||
        q.includes('accessibility') || q.includes('inclusion') || q.includes('paralympic') ||
        q.includes('special education')) return 'disability';
    // World / geopolitical
    if (q.includes('global') || q.includes('geopolitical') || q.includes('international') ||
        q.includes('sovereignty') || q.includes('climate') || q.includes('regulation policy')) return 'world';
    // AI & Tech (broad — includes AI, tech, cloud, chips, CEOs, etc.)
    if (q.includes('ai') || q.includes('artificial intelligence') || q.includes('openai') ||
        q.includes('nvidia') || q.includes('tech') || q.includes('chip') || q.includes('cloud') ||
        q.includes('quantum') || q.includes('robot') || q.includes('cyber') || q.includes('startup') ||
        q.includes('spacex') || q.includes('nasa') || q.includes('electric vehicle') ||
        q.includes('ceo') || q.includes('altman') || q.includes('pichai') || q.includes('nadella') ||
        q.includes('zuckerberg') || q.includes('musk')) return 'ai-tech';
    // General (healthcare, education, social media, entertainment, science, fintech)
    return 'general';
}

// ─── Helpers ─────────────────────────────────────────────────

function generateTitle(topic: string, category: string): string {
    const prefixes: Record<string, string[]> = {
        'ai-tech': [
            'AI & Tech:',
            'Tech Update:',
            'AI News:',
            'Innovation:',
            'Tech Spotlight:',
        ],
        disability: [
            'Accessibility:',
            'Disability News:',
            'Inclusion Update:',
            'Disability & Tech:',
        ],
        world: [
            'Global Update:',
            'World News:',
            'Global Tech:',
            'World Report:',
        ],
        general: [
            'News:',
            'Update:',
            'Report:',
            'Spotlight:',
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

// ─── Types ───────────────────────────────────────────────────

interface TavilyResult {
    title: string;
    description: string;
    url: string;
}

// ─── Tavily Search ──────────────────────────────────────────

async function searchTavilyWithKey(apiKey: string, query: string, daysBack: number): Promise<{ context: string; results: TavilyResult[] }> {
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

    const mapped: TavilyResult[] = response.results.map((r: { title: string; content: string; url: string }) => ({
        title: r.title,
        description: r.content,
        url: r.url,
    }));

    const context = mapped
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`)
        .join('\n\n');

    return { context, results: mapped };
}

async function searchTavily(query: string, daysBack: number = 3): Promise<{ context: string; results: TavilyResult[] }> {
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

// ─── Pollinations.ai FLUX Image Generation (Free & Unlimited) ───

const POLLINATIONS_WIDTH = 1024;
const POLLINATIONS_HEIGHT = 576; // 16:9 cinematic ratio
const POLLINATIONS_TIMEOUT_MS = 60000; // 60s — Pollinations can take time for high-quality
const POLLINATIONS_MAX_RETRIES = 2;

async function generatePollinationsImage(prompt: string): Promise<Buffer | null> {
    for (let attempt = 1; attempt <= POLLINATIONS_MAX_RETRIES; attempt++) {
        try {
            const seed = Math.floor(Math.random() * 999999);
            const encodedPrompt = encodeURIComponent(prompt);
            const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${POLLINATIONS_WIDTH}&height=${POLLINATIONS_HEIGHT}&seed=${seed}&model=flux&nologo=true`;

            console.log(`🎨 Pollinations FLUX: generating image (seed=${seed}, attempt ${attempt}/${POLLINATIONS_MAX_RETRIES})...`);

            const res = await fetch(url, {
                signal: AbortSignal.timeout(POLLINATIONS_TIMEOUT_MS),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                console.warn(`⚠️ Pollinations API error ${res.status}: ${errText.substring(0, 200)}`);
                if (attempt < POLLINATIONS_MAX_RETRIES) {
                    console.log('🔄 Retrying with new seed...');
                    continue;
                }
                return null;
            }

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('image')) {
                console.warn(`⚠️ Pollinations returned non-image content-type: ${contentType}`);
                if (attempt < POLLINATIONS_MAX_RETRIES) continue;
                return null;
            }

            const arrayBuffer = await res.arrayBuffer();
            if (arrayBuffer.byteLength < 5000) {
                console.warn(`⚠️ Pollinations returned suspiciously small image (${arrayBuffer.byteLength} bytes), retrying...`);
                if (attempt < POLLINATIONS_MAX_RETRIES) continue;
                return null;
            }

            console.log(`🎨 Pollinations image generated: ${Math.round(arrayBuffer.byteLength / 1024)}KB (seed=${seed})`);
            return Buffer.from(arrayBuffer);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ Pollinations attempt ${attempt} failed: ${msg}`);
            if (attempt >= POLLINATIONS_MAX_RETRIES) return null;
        }
    }
    return null;
}

// ─── Cloudinary Direct Upload ────────────────────────────────

async function uploadToCloudinary(imageBuffer: Buffer): Promise<string | null> {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dxlok864h';
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!apiKey || !apiSecret) {
        console.warn('⚠️ Cloudinary credentials not set — skipping upload');
        return null;
    }

    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = 'news-thumbnails';

        // Cloudinary signature: alphabetically sorted params + apiSecret
        const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;

        // Generate SHA-1 signature
        const encoder = new TextEncoder();
        const data = encoder.encode(paramsToSign);
        const hashBuffer = await crypto.subtle.digest('SHA-1', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Build multipart form
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
        formData.append('file', blob, 'news-thumbnail.png');
        formData.append('api_key', apiKey);
        formData.append('timestamp', String(timestamp));
        formData.append('signature', signature);
        formData.append('folder', folder);

        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`⚠️ Cloudinary upload failed ${res.status}: ${errText.substring(0, 200)}`);
            return null;
        }

        const result = await res.json();
        const url = result.secure_url || result.url;
        console.log(`☁️ Cloudinary upload OK: ${url?.substring(0, 80)}...`);
        return url;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ Cloudinary upload failed: ${msg}`);
        return null;
    }
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



// ─── Smart 10-Day URL History ────────────────────────────────

/** Normalize URL for consistent comparison */
function normalizeUrl(url: string): string {
    try {
        const u = new URL(url);
        // lowercase host, remove trailing slash, remove common tracking params
        u.hostname = u.hostname.toLowerCase();
        u.pathname = u.pathname.replace(/\/+$/, '');
        u.searchParams.delete('utm_source');
        u.searchParams.delete('utm_medium');
        u.searchParams.delete('utm_campaign');
        u.searchParams.delete('utm_content');
        u.searchParams.delete('utm_term');
        u.searchParams.delete('ref');
        u.searchParams.delete('source');
        return u.toString();
    } catch {
        return url.toLowerCase().replace(/\/+$/, '');
    }
}

/** Load all source URLs from news_history into a Set for O(1) lookup */
async function loadHistoryUrls(): Promise<Set<string>> {
    const snap = await adminDb.collection(HISTORY_COLLECTION).select('sourceUrls').get();
    const urls = new Set<string>();
    snap.docs.forEach(doc => {
        const data = doc.data();
        if (Array.isArray(data.sourceUrls)) {
            data.sourceUrls.forEach((u: string) => urls.add(normalizeUrl(u)));
        }
    });
    console.log(`📚 History loaded: ${urls.size} known URLs from ${snap.size} articles`);
    return urls;
}

/** Filter Tavily results — remove any whose URL exactly matches history */
function filterByUrlHistory(results: TavilyResult[], knownUrls: Set<string>): { fresh: TavilyResult[]; filtered: number } {
    const fresh = results.filter(r => !knownUrls.has(normalizeUrl(r.url)));
    const filtered = results.length - fresh.length;
    if (filtered > 0) {
        console.log(`🔗 URL filter: ${filtered} already-used URLs removed, ${fresh.length} fresh results remain`);
    }
    return { fresh, filtered };
}

/** Save generated article metadata + source URLs to history */
async function saveToHistory(title: string, content: string, sourceUrls: string[]) {
    try {
        // Normalize URLs before storing for consistent future comparisons
        const normalized = sourceUrls.map(normalizeUrl);
        await adminDb.collection(HISTORY_COLLECTION).add({
            title,
            content,
            sourceUrls: normalized,
            createdAt: new Date().toISOString(),
        });
        console.log(`📚 History saved: "${title.substring(0, 50)}" with ${normalized.length} URLs`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ History save failed (non-critical): ${msg}`);
    }
}



// ─── Main Pipeline ───────────────────────────────────────────

async function generateNews() {
    const t0 = Date.now();
    console.log('⚡ NEWS PIPELINE v13 — Cerebras GPT-OSS 120B + Tavily + Pollinations FLUX + URL History');

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

    // 4. Load URL history + Run Tavily search (parallel)
    const [initialSearchResult, knownUrls] = await Promise.all([
        searchTavily(searchQuery, 3),
        loadHistoryUrls(),
    ]);

    // 5. Filter search results by URL history
    let scrapedData = initialSearchResult.results;
    let usedQuery = searchQuery;
    let totalFiltered = 0;

    // Apply URL-based dedup filter
    const { fresh: freshResults, filtered: filteredCount } = filterByUrlHistory(scrapedData, knownUrls);
    scrapedData = freshResults;
    totalFiltered = filteredCount;

    const totalTextLength = scrapedData.map(r =>
        `${r.title || ''} ${r.description || ''}`
    ).join('').length;

    if (!scrapedData.length || totalTextLength < 50) {
        // Fallback 1: broader query, still 3 days
        const fallbackQuery = generateFallbackQuery();
        console.log(`⚠️ Primary search weak after URL filter (${scrapedData.length} fresh, ${filteredCount} filtered). Trying fallback: "${fallbackQuery}"`);
        const fallbackResult = await searchTavily(fallbackQuery, 3);
        const fallbackFresh = filterByUrlHistory(fallbackResult.results, knownUrls);
        if (fallbackFresh.fresh.length > 0) {
            scrapedData = fallbackFresh.fresh;
            totalFiltered += fallbackFresh.filtered;
            usedQuery = fallbackQuery;
            console.log(`✅ Fallback search succeeded: ${scrapedData.length} fresh results`);
        } else {
            // Fallback 2: even broader, 7 days
            console.log('⚠️ 3-day fallback empty after URL filter. Trying 7-day window...');
            const widerResult = await searchTavily('latest technology AI news', 7);
            const widerFresh = filterByUrlHistory(widerResult.results, knownUrls);
            if (widerFresh.fresh.length > 0) {
                scrapedData = widerFresh.fresh;
                totalFiltered += widerFresh.filtered;
                usedQuery = 'latest technology AI news (7d)';
                console.log(`✅ 7-day search succeeded: ${scrapedData.length} fresh results`);
            } else {
                console.error('❌ All search attempts failed — no fresh URLs after all fallbacks');
                throw new Error('No fresh search results found after URL history filtering');
            }
        }
    } else {
        console.log(`✅ Primary search OK: ${scrapedData.length} fresh results, ${totalTextLength} chars (${filteredCount} URLs filtered)`);
    }

    // Collect source URLs from the results we'll use for article generation
    const sourceUrls = scrapedData.map(r => r.url).filter(Boolean);

    // 6. CEREBRAS — article generation
    const systemPrompt = `You are a strict, factual tech journalist. You MUST output valid JSON with exactly one key: "articleText". No other keys, no markdown, no explanation — ONLY the JSON object.`;

    // Strip URLs from data sent to LLM (saves tokens, LLM doesn't need them)
    const cerebrasData = scrapedData.map(({ title, description }) => ({ title, description }));

    const userPrompt = `Write a news article based ONLY on the search results below.

Search results:
${JSON.stringify(cerebrasData, null, 2)}

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

Return JSON: { "articleText": "your 175-225 word article" }`;

    // Models available on Cerebras (gpt-oss-120b for quality, llama3.1-8b as fallback)
    const MODELS = ['gpt-oss-120b', 'llama3.1-8b'];
    let articleText = '';
    let imagePrompt = '';
    let usedModel = '';

    // Helper to call Cerebras
    async function callCerebras(modelName: string, sysPrompt: string, usrPrompt: string): Promise<{ articleText: string }> {
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
        return { articleText: article };
    }

    // --- Single Cerebras call with model fallback + word count retry ---
    for (const modelName of MODELS) {
        try {
            console.log(`🔄 Trying Cerebras model: ${modelName}`);
            const result = await callCerebras(modelName, systemPrompt, userPrompt);
            articleText = result.articleText;
            usedModel = modelName;

            const firstWordCount = articleText.split(/\s+/).length;
            console.log(`📝 First attempt: ${firstWordCount} words`);

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
    console.log(`📝 Article (${usedModel}): ${wordCount} words`);

    // 7. Generate cinematic image prompt from article (fast Cerebras call)
    try {
        const imgPromptCompletion = await cerebras.chat.completions.create({
            model: 'llama3.1-8b', // fast model for quick prompt generation
            messages: [
                { role: 'system', content: 'You generate stunning, futuristic, high-detail image descriptions for news article thumbnails. Output ONLY the description text, nothing else. No quotes, no explanation.' },
                { role: 'user', content: `Based on this news article, write a 40-60 word futuristic and stylish image description for an AI image generator. The image should be dramatic, editorial-quality, widescreen 16:9. Include: glowing neon light effects, rich vibrant colors, futuristic technology elements, cinematic depth-of-field, photorealistic detail. The image must fully cover the frame edge-to-edge with no borders or empty space. Do NOT include any text, words, or letters in the image.\n\nArticle: ${articleText.substring(0, 600)}` },
            ],
            temperature: 0.8,
            max_tokens: 150,
        }) as { choices: Array<{ message: { content: string | null } }> };
        imagePrompt = imgPromptCompletion.choices[0]?.message?.content?.trim() || '';
        console.log(`🎨 Image prompt: "${imagePrompt.substring(0, 100)}..."`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ Image prompt generation failed: ${msg}`);
        imagePrompt = 'futuristic technology command center with glowing holographic displays, neon blue and purple ambient lighting, sleek metallic surfaces with reflections, dramatic cinematic wide-angle shot, photorealistic editorial photograph, edge-to-edge composition';
    }

    // 8. Generate title
    const title = generateTitle(topic, category);

    // 9. Generate image with Pollinations FLUX → upload to Cloudinary
    let imageUrl: string | null = null;
    const imageBuffer = await generatePollinationsImage(imagePrompt);
    if (imageBuffer) {
        imageUrl = await uploadToCloudinary(imageBuffer);
        if (imageUrl) {
            console.log(`🌐 Image uploaded: ${imageUrl.substring(0, 80)}...`);
        }
    }
    if (!imageUrl) {
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

    // Save article + record in history (parallel)
    await Promise.all([
        adminDb.collection(COLLECTION).doc(newsItem.id).set(newsItem),
        saveToHistory(title, articleText, sourceUrls),
    ]);
    const duration = Date.now() - t0;
    console.log(`✅ Saved: "${title}" in ${duration}ms`);

    // 11. Log health ✅
    await logHealth('✅ Success', {
        last_news_title: title,
        category,
        word_count: `${wordCount}`,
        image_prompt: imagePrompt.substring(0, 100),
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
        image_prompt: imagePrompt.substring(0, 80),
        has_image: !!imageUrl,
        search_query: usedQuery,
        search_results: scrapedData.length,
        urls_filtered: totalFiltered,
        history_urls: knownUrls.size,
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
