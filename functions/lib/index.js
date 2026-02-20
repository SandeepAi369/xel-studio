"use strict";
/**
 * Firebase Cloud Function: Daily AI & Tech News Generator
 * ========================================================
 * Replaces the old GitHub Actions + Python pipeline.
 *
 * Features:
 *   - Runs daily via Firebase Scheduled Function
 *   - Fetches AI/tech news from Google News RSS
 *   - Generates 200-250 word summaries via Gemini AI
 *   - Deduplicates by fuzzy title matching
 *   - Dynamic prompt re-try on duplicate topics
 *   - Auto-retry (3x) with backoff on Gemini failures
 *   - 24-hour auto-cleanup of old articles
 *
 * Env vars (set via firebase functions:config:set or .env):
 *   GEMINI_API_KEY — Google Gemini API key
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualNewsGenerate = exports.dailyNewsGenerator = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const generative_ai_1 = require("@google/generative-ai");
const rss_parser_1 = __importDefault(require("rss-parser"));
// ─── Initialize Firebase ─────────────────────────────────────
admin.initializeApp();
const db = admin.firestore();
// ─── Configuration ───────────────────────────────────────────
const FIRESTORE_COLLECTION = "news";
const NEWS_TTL_HOURS = 24;
const MAX_ARTICLES_PER_RUN = 1;
const MAX_GEMINI_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
// AI-focused RSS feeds (primary)
const AI_RSS_FEEDS = [
    "https://news.google.com/rss/search?q=artificial+intelligence+OR+machine+learning+OR+LLM+OR+deep+learning+OR+GPT+OR+neural+network&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=OpenAI+OR+Google+AI+OR+Microsoft+AI+OR+Meta+AI+OR+Anthropic+OR+Claude+OR+Gemini+AI+OR+Copilot+AI&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=open+source+AI+OR+Llama+OR+Mistral+OR+Hugging+Face+OR+Stable+Diffusion+OR+AI+model+release&hl=en-US&gl=US&ceid=US:en",
];
// Tech news fallback
const TECH_RSS_FEEDS = [
    "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
];
// AI keywords for categorization
const AI_KEYWORDS = [
    "artificial intelligence", "machine learning", "deep learning", "neural network",
    "llm", "large language model", "gpt", "chatgpt", "openai", "gemini ai", "copilot",
    "anthropic", "claude", "midjourney", "stable diffusion", "dall-e", "sora",
    "hugging face", "transformer", "diffusion model", "generative ai", "gen ai",
    "ai model", "ai agent", "ai chatbot", "ai assistant", "ai tool", "ai startup",
    "ai regulation", "ai safety", "ai chip", "nvidia ai", "google ai", "microsoft ai",
    "meta ai", "llama", "mistral", "deepseek", "perplexity",
    "computer vision", "nlp", "reinforcement learning", "ai research", "fine-tuning",
    "rag", "retrieval augmented", "vector database", "embedding",
    "text-to-image", "text-to-video", "text-to-speech",
    "ai-powered", "ai-driven", "ai-generated",
];
// ─── Helpers ─────────────────────────────────────────────────
function isAIArticle(title, summary = "") {
    const text = (title + " " + summary).toLowerCase();
    return AI_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}
function cleanTitle(title) {
    return title.replace(/\s*-\s*[^-]+$/, "").trim();
}
function titleSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    if (wordsA.size === 0 || wordsB.size === 0)
        return 0;
    let overlap = 0;
    wordsA.forEach((w) => { if (wordsB.has(w))
        overlap++; });
    return overlap / Math.min(wordsA.size, wordsB.size);
}
function isDuplicateTitle(title, existingTitles, threshold = 0.7) {
    return existingTitles.some((existing) => titleSimilarity(title, existing) >= threshold);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ─── Gemini AI ───────────────────────────────────────────────
async function getGeminiModel(apiKey) {
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    for (const modelName of GEMINI_MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            // Quick test to verify model is available
            await model.generateContent("test");
            console.log(`Using Gemini model: ${modelName}`);
            return model;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`Model ${modelName} not available: ${msg}`);
        }
    }
    console.error("No Gemini model available.");
    return null;
}
/**
 * Generate AI summary with retry logic and duplicate-aware re-prompting.
 * - Max 3 retries on failure
 * - If a topic already exists, the prompt asks Gemini for a unique angle
 */
async function generateSummary(model, title, originalSummary, category, skipTopics = []) {
    const skipClause = skipTopics.length > 0
        ? `\nIMPORTANT: Do NOT repeat or focus on these already-covered topics: ${skipTopics.join(", ")}. Find a unique angle or detail instead.`
        : "";
    const prompt = category === "ai"
        ? `You are a professional AI & technology journalist writing detailed coverage for AI enthusiasts.
Write a comprehensive, engaging summary of 200 to 250 words for this AI/technology news article.
Focus on: What AI technology/model/company is involved, what changed, technical significance,
industry implications, and why AI enthusiasts should care.
Make it exciting, well-structured, and accessible. No title. No bullet points - flowing paragraphs only.${skipClause}

Title: ${title}
Original: ${originalSummary}

Write ONLY the 200-250 word summary:`
        : `You are a professional tech journalist writing detailed news coverage for enthusiasts.
Write a comprehensive, engaging summary of 200 to 250 words for this technology news article.
Cover the key details, context, implications, and why it matters.
Make it exciting, well-structured, and accessible. No title. No bullet points - flowing paragraphs only.${skipClause}

Title: ${title}
Original: ${originalSummary}

Write ONLY the 200-250 word summary:`;
    for (let attempt = 1; attempt <= MAX_GEMINI_RETRIES; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();
            const words = text.split(/\s+/);
            // Trim if too long
            const summary = words.length > 280 ? words.slice(0, 250).join(" ") + "..." : text;
            console.log(`  Summary OK (attempt ${attempt}, ${words.length} words)`);
            return { summary, success: true };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`  Gemini attempt ${attempt}/${MAX_GEMINI_RETRIES} failed: ${msg}`);
            if (attempt < MAX_GEMINI_RETRIES) {
                await sleep(RETRY_DELAY_MS * attempt); // exponential-ish backoff
            }
        }
    }
    // Fallback: use raw summary truncated
    console.warn("  All Gemini retries exhausted — using fallback summary");
    const fallback = originalSummary.replace(/<[^>]*>/g, "").trim();
    const words = fallback.split(/\s+/).slice(0, 250);
    return { summary: words.join(" "), success: false };
}
async function fetchRSSFeeds() {
    const parser = new rss_parser_1.default({
        customFields: { item: [["media:content", "media"]] },
    });
    const seenLinks = new Set();
    const aiEntries = [];
    const techEntries = [];
    // AI feeds
    for (const url of AI_RSS_FEEDS) {
        try {
            const feed = await parser.parseURL(url);
            for (const item of feed.items) {
                const link = item.link || "";
                if (!link || seenLinks.has(link))
                    continue;
                seenLinks.add(link);
                aiEntries.push({
                    title: item.title || "Untitled",
                    link,
                    summary: item.contentSnippet || item.content || "",
                    pubDate: item.pubDate || item.isoDate,
                    source: item.creator || extractSourceFromTitle(item.title || ""),
                    feedType: "ai",
                });
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`RSS error: ${msg}`);
        }
    }
    // Tech feeds
    for (const url of TECH_RSS_FEEDS) {
        try {
            const feed = await parser.parseURL(url);
            for (const item of feed.items) {
                const link = item.link || "";
                if (!link || seenLinks.has(link))
                    continue;
                seenLinks.add(link);
                const title = item.title || "Untitled";
                const summary = item.contentSnippet || item.content || "";
                const type = isAIArticle(title, summary) ? "ai" : "tech";
                const target = type === "ai" ? aiEntries : techEntries;
                target.push({
                    title,
                    link,
                    summary,
                    pubDate: item.pubDate || item.isoDate,
                    source: item.creator || extractSourceFromTitle(title),
                    feedType: type,
                });
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`RSS error: ${msg}`);
        }
    }
    console.log(`Feeds: ${aiEntries.length} AI + ${techEntries.length} tech`);
    return { ai: aiEntries, tech: techEntries };
}
function extractSourceFromTitle(title) {
    const match = title.match(/-\s*([^-]+)$/);
    return match ? match[1].trim() : "Tech News";
}
// ─── Firestore Ops ────────────────────────────────────────────
async function loadExistingNews() {
    const snapshot = await db
        .collection(FIRESTORE_COLLECTION)
        .orderBy("date", "desc")
        .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
async function cleanupOldNews() {
    const cutoff = new Date(Date.now() - NEWS_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const old = await db
        .collection(FIRESTORE_COLLECTION)
        .where("date", "<", cutoff)
        .get();
    const batch = db.batch();
    old.docs.forEach((doc) => batch.delete(doc.ref));
    if (old.size > 0) {
        await batch.commit();
        console.log(`Cleaned up ${old.size} articles older than ${NEWS_TTL_HOURS}h`);
    }
    return old.size;
}
// ─── Main Logic ──────────────────────────────────────────────
async function generateDailyNews() {
    console.log("=== AI & TECH NEWS GENERATOR (Firebase) ===");
    // 1. Cleanup old articles
    await cleanupOldNews();
    // 2. Load existing for dedup
    const existing = await loadExistingNews();
    const existingLinks = new Set(existing.map((e) => e.source_link).filter(Boolean));
    const existingTitles = existing.map((e) => e.title);
    console.log(`Existing: ${existing.length} articles`);
    // 3. Init Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("FATAL: GEMINI_API_KEY not set");
        return;
    }
    const model = await getGeminiModel(apiKey);
    if (!model)
        return;
    // 4. Fetch RSS
    const { ai: aiEntries, tech: techEntries } = await fetchRSSFeeds();
    if (aiEntries.length === 0 && techEntries.length === 0) {
        console.log("No RSS entries found.");
        return;
    }
    // 5. Process — AI first, tech fallback
    let saved = 0;
    const skipTopics = [];
    // Phase 1: AI entries
    for (const entry of aiEntries) {
        if (saved >= MAX_ARTICLES_PER_RUN)
            break;
        if (existingLinks.has(entry.link))
            continue;
        const title = cleanTitle(entry.title);
        if (isDuplicateTitle(title, existingTitles)) {
            console.log(`  SKIP (dup): ${title.substring(0, 55)}...`);
            skipTopics.push(title); // track for dynamic prompt
            continue;
        }
        console.log(`[AI] ${title.substring(0, 55)}...`);
        const { summary } = await generateSummary(model, title, entry.summary, "ai", skipTopics);
        const newsItem = {
            id: crypto.randomUUID(),
            title,
            summary,
            image_url: entry.imageUrl || null,
            source_link: entry.link,
            source_name: entry.source || "AI News",
            date: entry.pubDate ? new Date(entry.pubDate).toISOString() : new Date().toISOString(),
            category: "ai",
        };
        await db.collection(FIRESTORE_COLLECTION).doc(newsItem.id).set(newsItem);
        console.log(`  ✓ Saved: ${title.substring(0, 50)}`);
        saved++;
    }
    // Phase 2: Tech fallback
    if (saved === 0) {
        console.log("No AI articles — trying tech...");
        for (const entry of techEntries) {
            if (saved >= MAX_ARTICLES_PER_RUN)
                break;
            if (existingLinks.has(entry.link))
                continue;
            const title = cleanTitle(entry.title);
            if (isDuplicateTitle(title, existingTitles)) {
                skipTopics.push(title);
                continue;
            }
            const category = isAIArticle(title, entry.summary) ? "ai" : "tech";
            console.log(`[${category.toUpperCase()}] ${title.substring(0, 55)}...`);
            const { summary } = await generateSummary(model, title, entry.summary, category, skipTopics);
            const newsItem = {
                id: crypto.randomUUID(),
                title,
                summary,
                image_url: entry.imageUrl || null,
                source_link: entry.link,
                source_name: entry.source || "Tech News",
                date: entry.pubDate ? new Date(entry.pubDate).toISOString() : new Date().toISOString(),
                category,
            };
            await db.collection(FIRESTORE_COLLECTION).doc(newsItem.id).set(newsItem);
            console.log(`  ✓ Saved: ${title.substring(0, 50)}`);
            saved++;
        }
    }
    console.log(`\nDONE: ${saved} articles saved. Total: ${existing.length + saved}`);
}
// ─── Exported Cloud Function ─────────────────────────────────
/**
 * Scheduled function — runs daily at midnight IST.
 */
exports.dailyNewsGenerator = (0, scheduler_1.onSchedule)({
    schedule: "every day 00:00",
    timeZone: "Asia/Kolkata",
    timeoutSeconds: 300,
    memory: "512MiB",
}, async () => {
    await generateDailyNews();
});
/**
 * HTTP trigger — for manual testing / on-demand runs.
 */
exports.manualNewsGenerate = (0, https_1.onRequest)({
    timeoutSeconds: 300,
    memory: "512MiB",
}, async (_req, res) => {
    console.log("Manual news generation triggered");
    await generateDailyNews();
    res.status(200).json({ status: "done", timestamp: new Date().toISOString() });
});
//# sourceMappingURL=index.js.map