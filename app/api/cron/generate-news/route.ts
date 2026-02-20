/**
 * /api/cron/generate-news — AI News Generator (Cron-triggered)
 * =============================================================
 * Triggered every 30 min by cron-job.org (48 times/day).
 * Writes directly to Firebase Firestore.
 *
 * Features:
 *   - Gemini 3 Flash for high-speed, quality summaries
 *   - Smart category distribution: ~25/48 = General, ~23/48 = AI+Tech
 *   - Fuzzy duplicate prevention (title similarity)
 *   - 24h auto-cleanup of old articles
 *   - Secured with CRON_SECRET bearer token
 *   - All data stored in Firebase Firestore (not Supabase)
 */

import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel timeout fix

// ─── Configuration ───────────────────────────────────────────
const FIRESTORE_COLLECTION = 'news';
const NEWS_TTL_HOURS = 24;
const MAX_ARTICLES_PER_RUN = 1;
const MAX_GEMINI_RETRIES = 4;
const RETRY_DELAY_MS = 2000;
const MIN_SUMMARY_WORDS = 180; // slightly below 200 for margin
const MAX_SUMMARY_WORDS = 260; // slightly above 250 for margin

// Category distribution: use UTC hour to decide category
// Even half-hours → AI/Technology (23 slots)
// Odd half-hours  → General/Geopolitics (25 slots)
function getCategoryForRun(): 'ai' | 'technology' | 'general' {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const slot = hour * 2 + (minute >= 30 ? 1 : 0);

    // Slots 0-22 = AI+Tech (23 slots), 23-47 = General (25 slots)
    if (slot < 23) {
        return slot % 3 === 0 ? 'technology' : 'ai';
    }
    return 'general';
}

// ─── RSS Feeds ───────────────────────────────────────────────
const RSS_FEEDS: Record<string, string[]> = {
    ai: [
        'https://news.google.com/rss/search?q=artificial+intelligence+OR+machine+learning+OR+LLM+OR+deep+learning+OR+GPT+OR+neural+network&hl=en-US&gl=US&ceid=US:en',
        'https://news.google.com/rss/search?q=OpenAI+OR+Google+AI+OR+Microsoft+AI+OR+Meta+AI+OR+Anthropic+OR+Claude+OR+Gemini+AI+OR+Copilot+AI&hl=en-US&gl=US&ceid=US:en',
        'https://news.google.com/rss/search?q=open+source+AI+OR+Llama+OR+Mistral+OR+Hugging+Face+OR+Stable+Diffusion+OR+AI+model+release&hl=en-US&gl=US&ceid=US:en',
    ],
    technology: [
        'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
        'https://news.google.com/rss/search?q=cybersecurity+OR+cloud+computing+OR+quantum+computing+OR+blockchain+OR+robotics&hl=en-US&gl=US&ceid=US:en',
    ],
    general: [
        'https://news.google.com/rss/search?q=world+news+OR+geopolitics+OR+global+economy+OR+international+relations&hl=en-US&gl=US&ceid=US:en',
        'https://news.google.com/rss/search?q=breaking+news+OR+important+global+events+OR+climate+change+OR+space+exploration&hl=en-US&gl=US&ceid=US:en',
    ],
};

// AI keywords for smart categorization
const AI_KEYWORDS = [
    'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
    'llm', 'large language model', 'gpt', 'chatgpt', 'openai', 'gemini ai', 'copilot',
    'anthropic', 'claude', 'midjourney', 'stable diffusion', 'dall-e', 'sora',
    'hugging face', 'transformer', 'diffusion model', 'generative ai', 'gen ai',
    'ai model', 'ai agent', 'ai chatbot', 'ai assistant', 'ai tool', 'ai startup',
    'ai regulation', 'ai safety', 'ai chip', 'nvidia ai', 'google ai', 'microsoft ai',
    'meta ai', 'llama', 'mistral', 'deepseek', 'perplexity',
    'computer vision', 'nlp', 'reinforcement learning', 'ai research', 'fine-tuning',
    'rag', 'retrieval augmented', 'vector database', 'embedding',
    'text-to-image', 'text-to-video', 'text-to-speech',
    'ai-powered', 'ai-driven', 'ai-generated',
];

// ─── Helpers ─────────────────────────────────────────────────

function isAIArticle(title: string, summary = ''): boolean {
    const text = (title + ' ' + summary).toLowerCase();
    return AI_KEYWORDS.some((kw) => text.includes(kw));
}

function cleanTitle(title: string): string {
    return title.replace(/\s*-\s*[^-]+$/, '').trim();
}

function titleSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    wordsA.forEach((w) => { if (wordsB.has(w)) overlap++; });
    return overlap / Math.min(wordsA.size, wordsB.size);
}

function isDuplicateTitle(title: string, existingTitles: string[], threshold = 0.7): boolean {
    return existingTitles.some((existing) => titleSimilarity(title, existing) >= threshold);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSourceFromTitle(title: string): string {
    const match = title.match(/-\s*([^-]+)$/);
    return match ? match[1].trim() : 'News';
}

// ─── RSS Parser (lightweight, no external dep) ──────────────

interface RSSItem {
    title: string;
    link: string;
    description: string;
    pubDate?: string;
    source?: string;
}

async function parseRSSFeed(url: string): Promise<RSSItem[]> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const xml = await res.text();
        const items: RSSItem[] = [];

        const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
        for (const itemXml of itemMatches.slice(0, 15)) {
            const title = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1] || '';
            const link = itemXml.match(/<link>(.*?)<\/link>/i)?.[1] || '';
            const description = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] || '';
            const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1];

            if (title && link) {
                items.push({
                    title: title.replace(/<[^>]*>/g, '').trim(),
                    link: link.trim(),
                    description: description.replace(/<[^>]*>/g, '').trim(),
                    pubDate,
                    source: extractSourceFromTitle(title.replace(/<[^>]*>/g, '').trim()),
                });
            }
        }
        return items;
    } catch (e) {
        console.error(`RSS fetch error for ${url}:`, e instanceof Error ? e.message : e);
        return [];
    }
}

// ─── Gemini AI ───────────────────────────────────────────────

async function generateSummary(
    model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
    title: string,
    originalSummary: string,
    category: string,
    skipTopics: string[] = []
): Promise<{ summary: string; success: boolean }> {
    const skipClause = skipTopics.length > 0
        ? `\nIMPORTANT: Do NOT repeat or focus on these already-covered topics: ${skipTopics.join(', ')}. Find a unique angle.`
        : '';

    const prompts: Record<string, string> = {
        ai: `You are a professional AI & technology journalist writing detailed coverage for AI enthusiasts.
Write a comprehensive, engaging summary of EXACTLY 200 to 250 words for this AI news article.
Focus on: What AI technology/model/company is involved, what changed, technical significance,
industry implications, and why AI enthusiasts should care.
Make it exciting, well-structured, and accessible. No title. No bullet points - flowing paragraphs only.
CRITICAL: Your response MUST be between 200 and 250 words. Count carefully. Do not write fewer than 200 words.${skipClause}

Title: ${title}
Original: ${originalSummary}

Write ONLY the 200-250 word summary:`,

        technology: `You are a professional tech journalist writing detailed news coverage for enthusiasts.
Write a comprehensive, engaging summary of EXACTLY 200 to 250 words for this technology news article.
Cover the key details, context, implications, and why it matters.
Make it exciting, well-structured, and accessible. No title. No bullet points - flowing paragraphs only.
CRITICAL: Your response MUST be between 200 and 250 words. Count carefully. Do not write fewer than 200 words.${skipClause}

Title: ${title}
Original: ${originalSummary}

Write ONLY the 200-250 word summary:`,

        general: `You are a professional international journalist writing clear, informative news coverage.
Write a comprehensive, engaging summary of EXACTLY 200 to 250 words for this news article.
Cover: What happened, who is involved, why it matters globally, and implications.
Maintain journalistic neutrality. No title. No bullet points - flowing paragraphs only.
CRITICAL: Your response MUST be between 200 and 250 words. Count carefully. Do not write fewer than 200 words.${skipClause}

Title: ${title}
Original: ${originalSummary}

Write ONLY the 200-250 word summary:`,
    };

    const prompt = prompts[category] || prompts.general;

    for (let attempt = 1; attempt <= MAX_GEMINI_RETRIES; attempt++) {
        try {
            // On retry after too-short, use a stronger prompt
            const currentPrompt = attempt > 1
                ? prompt + `\n\nPREVIOUS ATTEMPT WAS TOO SHORT. You MUST write AT LEAST 200 words. Expand with more context, implications, background, and analysis. Be thorough and detailed.`
                : prompt;

            const result = await model.generateContent(currentPrompt);
            const text = result.response.text().trim();
            const words = text.split(/\s+/);
            const wordCount = words.length;

            // Check minimum word count
            if (wordCount < MIN_SUMMARY_WORDS) {
                console.warn(`  Attempt ${attempt}: too short (${wordCount} words, need ${MIN_SUMMARY_WORDS}+). Retrying...`);
                if (attempt < MAX_GEMINI_RETRIES) {
                    await sleep(RETRY_DELAY_MS);
                    continue;
                }
            }

            // Trim if too long (soft cap)
            const summary = wordCount > MAX_SUMMARY_WORDS
                ? words.slice(0, 250).join(' ') + '.'
                : text;

            console.log(`  Summary OK (attempt ${attempt}, ${wordCount} words)`);
            return { summary, success: true };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`  Gemini attempt ${attempt}/${MAX_GEMINI_RETRIES} failed: ${msg}`);
            if (attempt < MAX_GEMINI_RETRIES) {
                await sleep(RETRY_DELAY_MS * attempt);
            }
        }
    }

    // All retries exhausted — build a padded fallback from the original content
    console.warn('  All Gemini retries exhausted — using fallback summary');
    const cleaned = originalSummary.replace(/<[^>]*>/g, '').trim();
    const fallbackWords = cleaned.split(/\s+/);
    if (fallbackWords.length >= MIN_SUMMARY_WORDS) {
        return { summary: fallbackWords.slice(0, 250).join(' '), success: false };
    }
    // If original is too short, pad with context
    const padded = `${cleaned} This development marks a significant moment in the ${category === 'ai' ? 'artificial intelligence' : category === 'technology' ? 'technology' : 'global'} landscape, with experts closely monitoring its potential implications for the industry and beyond. Further details are expected to emerge as the story develops.`;
    return { summary: padded, success: false };
}

// ─── Main Logic ──────────────────────────────────────────────

async function generateNews() {
    console.log('=== AI NEWS GENERATOR (Vercel + Firestore + Gemini 3 Flash) ===');

    // 1. Cleanup articles older than 24h
    const cutoff = new Date(Date.now() - NEWS_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const oldDocs = await adminDb
        .collection(FIRESTORE_COLLECTION)
        .where('date', '<', cutoff)
        .get();

    if (oldDocs.size > 0) {
        const batch = adminDb.batch();
        oldDocs.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Cleaned up ${oldDocs.size} articles older than ${NEWS_TTL_HOURS}h`);
    }

    // 2. Load existing for dedup
    const existingSnap = await adminDb
        .collection(FIRESTORE_COLLECTION)
        .orderBy('date', 'desc')
        .get();

    const existingTitles = existingSnap.docs.map((doc) => doc.data().title as string);
    const existingLinks = new Set(
        existingSnap.docs.map((doc) => doc.data().source_link as string).filter(Boolean)
    );
    console.log(`Existing: ${existingTitles.length} articles`);

    // 3. Init Gemini 3 Flash
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('FATAL: GEMINI_API_KEY not set');
        return { error: 'GEMINI_API_KEY not configured', saved: 0 };
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.0-flash' });

    // 4. Determine category for this run
    const category = getCategoryForRun();
    console.log(`Category for this run: ${category.toUpperCase()}`);

    // 5. Fetch RSS for the chosen category
    const feeds = RSS_FEEDS[category] || RSS_FEEDS.general;
    const allEntries: RSSItem[] = [];
    const seenLinks = new Set<string>();

    for (const feedUrl of feeds) {
        const items = await parseRSSFeed(feedUrl);
        for (const item of items) {
            if (!seenLinks.has(item.link)) {
                seenLinks.add(item.link);
                allEntries.push(item);
            }
        }
    }

    console.log(`Fetched ${allEntries.length} RSS entries for category: ${category}`);
    if (allEntries.length === 0) {
        return { error: 'No RSS entries found', category, saved: 0 };
    }

    // 6. Process entries — find non-duplicate, generate, save to Firestore
    let saved = 0;
    const skipTopics: string[] = [];

    for (const entry of allEntries) {
        if (saved >= MAX_ARTICLES_PER_RUN) break;
        if (existingLinks.has(entry.link)) continue;

        const title = cleanTitle(entry.title);
        if (isDuplicateTitle(title, existingTitles)) {
            console.log(`  SKIP (dup): ${title.substring(0, 55)}...`);
            skipTopics.push(title);
            continue;
        }

        // Smart re-categorize: if a "general" article is actually about AI, upgrade it
        let finalCategory = category;
        if (category !== 'ai' && isAIArticle(title, entry.description)) {
            finalCategory = 'ai';
        }

        console.log(`[${finalCategory.toUpperCase()}] ${title.substring(0, 55)}...`);
        const { summary } = await generateSummary(model, title, entry.description, finalCategory, skipTopics);

        const newsItem = {
            id: crypto.randomUUID(),
            title,
            summary,
            image_url: null,
            source_link: entry.link,
            source_name: entry.source || 'News',
            category: finalCategory,
            date: entry.pubDate ? new Date(entry.pubDate).toISOString() : new Date().toISOString(),
        };

        // Save to Firestore
        await adminDb.collection(FIRESTORE_COLLECTION).doc(newsItem.id).set(newsItem);
        console.log(`  ✓ Saved to Firestore: ${title.substring(0, 50)}`);
        existingTitles.push(title);
        saved++;
    }

    console.log(`\nDONE: ${saved} articles saved to Firestore. Total: ${existingTitles.length}`);
    return { saved, category, total: existingTitles.length };
}

// ─── Route Handler ───────────────────────────────────────────

export async function GET(req: Request) {
    // Validate CRON_SECRET
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (token !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await generateNews();
        return NextResponse.json({
            status: 'ok',
            ...result,
            timestamp: new Date().toISOString(),
        });
    } catch (e) {
        console.error('News generation failed:', e);
        return NextResponse.json(
            { error: 'Generation failed', message: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
