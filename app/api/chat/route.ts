import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Vercel serverless timeout (seconds)

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

        const genAI = new GoogleGenerativeAI(apiKey);
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
