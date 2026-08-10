import { NextRequest, NextResponse } from 'next/server';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * /api/stream_audio — Text-to-Speech endpoint using Microsoft Edge TTS.
 *
 * Uses the free Microsoft Edge TTS service (same voices as Edge browser).
 * Streams audio back as MP3 for immediate playback in the SmartListenButton.
 *
 * Query params:
 *   text: string  — the text to synthesize (max 5000 chars)
 *   rate: string   — speaking rate (default: "+12%")
 */

const VOICE = 'en-US-AvaNeural';
const DEFAULT_RATE = '+12%';
const MAX_TEXT_LENGTH = 5000;

export async function GET(req: NextRequest) {
    const text = req.nextUrl.searchParams.get('text')?.trim();
    const rate = req.nextUrl.searchParams.get('rate') || DEFAULT_RATE;

    if (!text) {
        return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    if (text.length > MAX_TEXT_LENGTH) {
        return NextResponse.json(
            { error: `Text too long. Max ${MAX_TEXT_LENGTH} chars.` },
            { status: 400 }
        );
    }

    try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

        const readable = tts.toStream(text.slice(0, MAX_TEXT_LENGTH), { rate });

        // Collect audio chunks into a buffer
        const chunks: Buffer[] = [];

        await new Promise<void>((resolve, reject) => {
            readable.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            readable.on('end', () => resolve());
            readable.on('error', (err: Error) => reject(err));
        });

        const audioBuffer = Buffer.concat(chunks);

        if (audioBuffer.length === 0) {
            return NextResponse.json({ error: 'TTS produced no audio' }, { status: 500 });
        }

        return new NextResponse(audioBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(audioBuffer.length),
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (error) {
        console.error('TTS error:', error);
        return NextResponse.json(
            { error: 'TTS generation failed', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
