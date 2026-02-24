import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Vercel serverless timeout (seconds)

// Lazy singleton — reuses client across requests within the same serverless instance
let _genAIClient: GoogleGenerativeAI | null = null;
let _cachedKey: string | null = null;

function getGenAIClient(apiKey: string): GoogleGenerativeAI {
    if (_genAIClient && _cachedKey === apiKey) return _genAIClient;
    _genAIClient = new GoogleGenerativeAI(apiKey);
    _cachedKey = apiKey;
    return _genAIClient;
}

// Available models — user can pick from frontend
const ALLOWED_MODELS: Record<string, string> = {
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-3-flash': 'gemini-3-flash-preview',
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

export async function POST(request: NextRequest) {
    try {
        const { message, history, model: requestedModel } = await request.json();

        if (!message || typeof message !== 'string') {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        // Read API key at request time (Vercel serverless compatible)
        const apiKey = process.env.GEMINI_CHAT_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
        }

        // Reuse cached client (module-level singleton per API key)
        const genAI = getGenAIClient(apiKey);
        const modelId = ALLOWED_MODELS[requestedModel] || DEFAULT_MODEL;

        const model = genAI.getGenerativeModel({
            model: modelId,
            systemInstruction: 'You are a helpful AI assistant. Be concise and friendly.',
        });

        // Build chat with history
        const chatHistory = (history || [])
            .filter((msg: { role: string; text: string }) => msg.text && msg.text.trim())
            .map((msg: { role: string; text: string }) => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }],
            }));

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(message);
        const response = result.response.text();

        return NextResponse.json({ reply: response, model: modelId });
    } catch (error: unknown) {
        console.error('Chat API error:', error);
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: `Failed to generate response: ${errMsg}` },
            { status: 500 }
        );
    }
}
