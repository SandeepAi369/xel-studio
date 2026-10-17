import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Vercel serverless timeout (seconds)

// Lazy singleton — reuses client across requests within the same serverless instance
let _genAIClient: GoogleGenAI | null = null;
let _cachedKey: string | null = null;

function getGenAIClient(apiKey: string): GoogleGenAI {
    if (_genAIClient && _cachedKey === apiKey) return _genAIClient;
    _genAIClient = new GoogleGenAI({ apiKey });
    _cachedKey = apiKey;
    return _genAIClient;
}

// Available models — user can pick from frontend
const ALLOWED_MODELS: Record<string, string> = {
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-3-flash': 'gemini-3-flash-preview',
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

// ─── Abuse limits (the endpoint is public and spends our Gemini quota) ───
const MAX_MESSAGE_CHARS = 8_000;
const MAX_HISTORY_MESSAGES = 30;
const MAX_TOTAL_CHARS = 60_000;
const RATE_LIMIT = 20;               // requests…
const RATE_WINDOW_MS = 60 * 1000;    // …per minute per IP
// Best-effort, per serverless instance (no shared store needed).
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5_000) hits.clear(); // keep memory bounded
    return recent.length > RATE_LIMIT;
}

interface HistoryMessage { role: string; text: string }

export async function POST(request: NextRequest) {
    try {
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
        if (rateLimited(ip)) {
            return NextResponse.json({ error: 'Too many messages. Please wait a minute and try again.' }, { status: 429 });
        }

        const { message, history, model: requestedModel } = await request.json();

        if (!message || typeof message !== 'string' || !message.trim()) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }
        if (message.length > MAX_MESSAGE_CHARS) {
            return NextResponse.json({ error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` }, { status: 413 });
        }

        // Keep only well-formed recent history, within the size budget.
        const cleanHistory: HistoryMessage[] = (Array.isArray(history) ? history : [])
            .filter((m: HistoryMessage) => m && typeof m.text === 'string' && m.text.trim())
            .slice(-MAX_HISTORY_MESSAGES);
        // The chat page includes the new message as the last history entry too;
        // drop that copy so the model doesn't see it twice.
        const last = cleanHistory[cleanHistory.length - 1];
        if (last && last.role === 'user' && last.text === message) cleanHistory.pop();
        const totalChars = cleanHistory.reduce((n, m) => n + m.text.length, message.length);
        if (totalChars > MAX_TOTAL_CHARS) {
            return NextResponse.json({ error: 'This conversation is too long. Clear the chat to start a new one.' }, { status: 413 });
        }

        // Read API key at request time (Vercel serverless compatible)
        const apiKey = process.env.GEMINI_CHAT_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'Chat is not configured' }, { status: 500 });
        }

        const ai = getGenAIClient(apiKey);
        const modelId = ALLOWED_MODELS[requestedModel] || DEFAULT_MODEL;

        const chat = ai.chats.create({
            model: modelId,
            config: { systemInstruction: 'You are a helpful AI assistant. Be concise and friendly.' },
            history: cleanHistory.map((m) => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.text }],
            })),
        });

        const result = await chat.sendMessage({ message });
        const reply = result.text ?? '';

        return NextResponse.json({ reply, model: modelId });
    } catch (error: unknown) {
        // Details go to the server log only; callers get a generic message.
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: 'Failed to generate a response. Please try again.' },
            { status: 500 }
        );
    }
}
