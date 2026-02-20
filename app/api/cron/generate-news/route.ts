/**
 * /api/cron/generate-news — AI News Generator v2 (Single-Shot Pipeline)
 * =====================================================================
 * Ultra-fast, single-shot pipeline: Prompt → Gemini → Firestore → Done.
 * No RSS. No retries. No retry loops. Target: <5-7 seconds total.
 *
 * Architecture:
 *   - 10 AI-heavy weighted prompts (80% AI, 20% general)
 *   - Random prompt selection per execution
 *   - Single Gemini Flash call (no retries = saves ~8-16s)
 *   - Firestore write for news + health tracking doc
 *   - Node.js runtime (firebase-admin incompatible with Edge)
 *
 * Health Tracking (system/cron_health):
 *   ✅ Success → { status: "✅ Success", timestamp, last_news_title }
 *   ❌ Failed  → { status: "❌ Failed", timestamp, error_message }
 */

import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { adminDb } from '@/lib/firebase-admin';

// ─── Config ──────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Gemini + Google Search grounding needs more time

const COLLECTION = 'news';
const HEALTH_DOC = 'system/cron_health';
const NEWS_TTL_HOURS = 24;

// ─── 10 AI-Heavy Weighted Prompts (80/20 Rule) ──────────────
// 8 AI-focused + 2 general/geopolitics. One is picked randomly per run.

const PROMPTS = [
    // ── AI PROMPTS (8) ──────────────────────────────────────
    {
        category: 'ai',
        topic: 'OpenAI & Anthropic',
        instruction: `Write a breaking AI news article about the latest developments from OpenAI, Anthropic, or their competitors. Cover new model releases (GPT, Claude, etc.), API updates, safety research, partnerships, or product launches. Include technical significance, market impact, and what it means for developers and businesses.`,
    },
    {
        category: 'ai',
        topic: 'Google DeepMind & Microsoft AI',
        instruction: `Write a breaking AI news article about Google DeepMind, Microsoft AI, or Copilot developments. Cover new Gemini models, Azure AI features, AI integration into Google/Microsoft products, research breakthroughs (AlphaFold, etc.), or enterprise AI adoption. Include competitive dynamics and technical implications.`,
    },
    {
        category: 'ai',
        topic: 'Open-Source AI & GitHub Trends',
        instruction: `Write a breaking AI news article about open-source AI developments. Cover new model releases on Hugging Face, trending GitHub AI repositories, Llama/Mistral/DeepSeek updates, community fine-tuning breakthroughs, open-source vs closed-source debates, or democratization of AI tools. Include practical developer impact.`,
    },
    {
        category: 'ai',
        topic: 'India AI Mission & Startups',
        instruction: `Write a breaking AI news article about India's AI ecosystem. Cover IndiaAI Mission progress, Indian AI startups (Krutrim, Sarvam AI, etc.), government AI policies, AI adoption in Indian industries, IIT/IISC research breakthroughs, or India's role in global AI competition. Include economic and social implications.`,
    },
    {
        category: 'ai',
        topic: 'AI Hardware & Nvidia',
        instruction: `Write a breaking AI news article about AI hardware and infrastructure. Cover Nvidia GPU launches (H100, B200, Blackwell), AMD/Intel AI chips, AI data center expansion, cloud GPU pricing, custom AI silicon (Google TPU, Amazon Trainium), or semiconductor supply chain updates. Include performance benchmarks and industry impact.`,
    },
    {
        category: 'ai',
        topic: 'AI Agents & Automation',
        instruction: `Write a breaking AI news article about AI agents and autonomous systems. Cover new AI agent frameworks, AutoGPT/CrewAI/LangChain updates, enterprise AI automation, coding assistants (Cursor, GitHub Copilot, Windsurf), AI in robotics, or multi-agent systems. Include practical applications and workforce implications.`,
    },
    {
        category: 'ai',
        topic: 'AI Safety & Regulation',
        instruction: `Write a breaking AI news article about AI safety, ethics, or regulation. Cover EU AI Act implementation, US AI executive orders, AI alignment research, deepfake concerns, AI in elections, responsible AI practices, or major company AI safety commitments. Include policy analysis and global coordination efforts.`,
    },
    {
        category: 'ai',
        topic: 'Generative AI & Creative Tools',
        instruction: `Write a breaking AI news article about generative AI advances. Cover text-to-image (Midjourney, DALL-E, Stable Diffusion), text-to-video (Sora, Runway, Kling), AI music generation, AI coding tools, or creative AI applications. Include quality improvements, accessibility, and impact on creative industries.`,
    },

    // ── GENERAL/GEOPOLITICS PROMPTS (2) ─────────────────────
    {
        category: 'world',
        topic: 'Global Tech & Geopolitics',
        instruction: `Write a breaking news article about a major global technology or geopolitical development. Cover US-China tech rivalry, semiconductor trade wars, space exploration milestones, cybersecurity incidents, digital currency developments, or major tech company antitrust actions. Include geopolitical context and global implications.`,
    },
    {
        category: 'world',
        topic: 'Science & Climate',
        instruction: `Write a breaking news article about a major scientific breakthrough or climate development. Cover fusion energy, quantum computing milestones, climate policy updates, renewable energy records, space discoveries, biotech breakthroughs, or environmental technology. Include scientific significance and societal impact.`,
    },
];

// ─── System Prompt (shared) ──────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class AI and technology journalist for "XeL News".

=== LENGTH REQUIREMENT ===
Your article MUST be between 150 and 200 words. This is NON-NEGOTIABLE.
Articles under 100 words will be REJECTED.
Write 2-3 concise but informative paragraphs.
=== END LENGTH REQUIREMENT ===

RULES:
1. Write as if reporting BREAKING NEWS happening TODAY (${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}).
2. Use flowing paragraphs only. NO bullet points, NO numbered lists, NO headers.
3. Do NOT start with the word "In" or "The". Start with something punchy and attention-grabbing.
4. Include specific company names, product names, and technical details.
5. Output ONLY the article body text. No title. No sign-off. No word count.
6. Write in an engaging, exciting tone.
7. IMPORTANT: Use your Google Search access to find REAL current news. Cite actual events.
8. End with one forward-looking sentence.
9. REMEMBER: 150-200 words, 2-3 paragraphs. No more, no less.`;

// Suffix added to every prompt to reinforce word count
const WORD_COUNT_SUFFIX = `\n\nIMPORTANT: Write exactly 150-200 words in 2-3 paragraphs. Not shorter, not longer.`;

// ─── Helpers ─────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

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
    const prefix = pickRandom(prefixes[category] || prefixes.general);
    const now = new Date();
    const timeTag = now.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    return `${prefix} ${topic} — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${timeTag}`;
}

// ─── Health Tracking (Tick/Cross System) ─────────────────────

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
        // Health logging should never crash the pipeline
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
    console.log('⚡ NEWS PIPELINE v2 — Single Shot');

    // 1. Pick random prompt
    const prompt = pickRandom(PROMPTS);
    console.log(`📌 Prompt: [${prompt.category.toUpperCase()}] ${prompt.topic}`);

    // 2. Init Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    const ai = new GoogleGenAI({ apiKey });
    const userPrompt = prompt.instruction + WORD_COUNT_SUFFIX;

    // Model fallback chain: latest → stable → legacy
    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    let responseText = '';
    let usedModel = '';

    // 3. Run cleanup + dedup check in parallel, then try models
    const [existingSnap] = await Promise.all([
        adminDb.collection(COLLECTION).orderBy('date', 'desc').limit(50).get(),
        cleanupOldArticles(),
    ]);

    // Helper to call Gemini with proper system instruction separation
    async function callGemini(modelName: string, contentText: string): Promise<string> {
        const result = await ai.models.generateContent({
            model: modelName,
            contents: contentText,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature: 0.95,
                maxOutputTokens: 2048,
                topP: 0.95,
                tools: [{ googleSearch: {} }],
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
            const firstWordCount = responseText.split(/\s+/).length;
            if (firstWordCount < 80) {
                console.log(`⚠️ First attempt too short (${firstWordCount} words), retrying...`);
                const retryPrompt = prompt.instruction + `\n\nCRITICAL: Your previous attempt was only ${firstWordCount} words. You MUST write 150-200 words in 2-3 paragraphs. Write a proper news article NOW.`;
                const retryText = await callGemini(modelName, retryPrompt);
                if (retryText && retryText.split(/\s+/).length > firstWordCount) {
                    responseText = retryText;
                    console.log(`✅ Retry produced ${retryText.split(/\s+/).length} words`);
                }
            }

            usedModel = modelName;
            console.log(`✅ Success with: ${modelName}`);
            break;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ ${modelName} failed: ${msg.substring(0, 100)}`);
            if (!msg.includes('429') && !msg.includes('quota') && !msg.includes('rate') && !msg.includes('not found')) {
                throw err; // Non-recoverable errors should fail immediately
            }
        }
    }

    if (!responseText) throw new Error('All Gemini models failed');

    const summary = responseText;
    const wordCount = summary.split(/\s+/).length;
    console.log(`📝 Response (${usedModel}): ${wordCount} words`);

    // 4. Generate title and check dups
    const title = generateTitle(prompt.topic, prompt.category);
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

    // 5. Save to Firestore
    const newsItem = {
        id: crypto.randomUUID(),
        title,
        summary,
        image_url: null,
        source_link: null,
        source_name: 'XeL AI News',
        category: prompt.category,
        date: new Date().toISOString(),
    };

    await adminDb.collection(COLLECTION).doc(newsItem.id).set(newsItem);
    const duration = Date.now() - t0;
    console.log(`✅ Saved: "${title}" in ${duration}ms`);

    // 6. Log health ✅
    await logHealth('✅ Success', {
        last_news_title: title,
        category: prompt.category,
        word_count: `${wordCount}`,
        duration_ms: `${duration}`,
    });

    return {
        status: 'ok',
        saved: 1,
        title,
        category: prompt.category,
        word_count: wordCount,
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

        // Log health ❌
        await logHealth('❌ Failed', { error_message: errorMsg });

        return NextResponse.json(
            { status: 'error', error: errorMsg },
            { status: 500 }
        );
    }
}
