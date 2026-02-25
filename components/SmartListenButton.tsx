'use client';

import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { Volume2, Pause, Loader2 } from 'lucide-react';
import { ttsCache } from '@/lib/tts-cache';
import { audioManager } from '@/lib/audio-manager';

/* ─────────────────────────────────────────────────────────────────────
   SmartListenButton — Streaming TTS with:
   ✅ Pause / Resume (resumes from where user stopped)
   ✅ Single-player-at-a-time (global AudioManager)
   ✅ In-memory cache (instant replay)
   ✅ Instant start: tiny first chunk (~1 sentence) + aggressive prefetch
   ✅ Smart sentence-boundary chunking (pauses hidden at natural breaks)
   ───────────────────────────────────────────────────────────────────── */

interface SmartListenButtonProps {
    text: string;
    iconOnly?: boolean;
    className?: string;
    endpoint?: string;
    /** Called when playback starts (useful for auto-expanding content) */
    onPlay?: () => void;
}

type BtnState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/* ── Smart chunking constants ─────────────────────────────────────
   FIRST_CHUNK_MAX: first chunk is just 1-2 sentences for instant start
   CHUNK_MIN/MAX: remaining chunks target natural sentence boundaries
   The first chunk is intentionally tiny (~10-20 words) so TTS generates
   audio almost instantly — like how Gemini/ChatGPT start speaking
   before the full response is ready. */
const FIRST_CHUNK_MAX = 25;  // First chunk: just 1-2 short sentences
const CHUNK_MIN = 35;        // Remaining chunks: 35-55 words
const CHUNK_MAX = 55;
const MAX_LEN = 5000;
const PREFETCH_AHEAD = 6;    // Prefetch 6 chunks ahead (aggressive)

/**
 * Smart sentence-boundary chunking optimized for instant playback.
 *
 * Strategy:
 *   1. First chunk = just the first sentence (or two short ones)
 *      → TTS generates ~1-2s of audio almost instantly
 *      → User hears audio within ~300-500ms of click
 *   2. Remaining chunks = sentences grouped to 35-55 words
 *      → Chunk boundaries fall at sentence endings (. ! ?)
 *      → Inter-chunk gap hidden behind natural speech pause
 *   3. Extra-long sentences (>55 words) split at clause boundaries
 */
function splitIntoChunks(text: string): string[] {
    const clean = text
        .replace(/[#*`\[\]]/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_LEN);
    if (!clean) return [];

    // Split into sentences at . ! ? (keeping the punctuation)
    const sentences = clean
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (sentences.length === 0) return [clean];

    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentWordCount = 0;
    let isFirstChunk = true;

    for (const sentence of sentences) {
        const sentenceWords = sentence.split(' ').length;
        const maxTarget = isFirstChunk ? FIRST_CHUNK_MAX : CHUNK_MAX;
        const minTarget = isFirstChunk ? 1 : CHUNK_MIN; // First chunk: finalize after ANY sentence

        // If adding this sentence keeps us under the max, add it
        if (currentWordCount + sentenceWords <= maxTarget) {
            currentChunk.push(sentence);
            currentWordCount += sentenceWords;

            // Finalize when we've hit our target
            if (currentWordCount >= minTarget) {
                chunks.push(currentChunk.join(' '));
                currentChunk = [];
                currentWordCount = 0;
                isFirstChunk = false;
            }
        } else {
            // Adding this sentence would exceed the max
            if (currentChunk.length > 0) {
                chunks.push(currentChunk.join(' '));
                isFirstChunk = false;
            }

            // Handle very long sentences (> CHUNK_MAX words)
            if (sentenceWords > CHUNK_MAX) {
                const words = sentence.split(' ');
                let clauseChunk: string[] = [];
                for (const w of words) {
                    clauseChunk.push(w);
                    if (clauseChunk.length >= CHUNK_MIN && /[,;:—]$/.test(w)) {
                        chunks.push(clauseChunk.join(' '));
                        clauseChunk = [];
                        isFirstChunk = false;
                    } else if (clauseChunk.length >= CHUNK_MAX) {
                        chunks.push(clauseChunk.join(' '));
                        clauseChunk = [];
                        isFirstChunk = false;
                    }
                }
                if (clauseChunk.length > 0) {
                    currentChunk = [clauseChunk.join(' ')];
                    currentWordCount = clauseChunk.length;
                } else {
                    currentChunk = [];
                    currentWordCount = 0;
                }
            } else {
                currentChunk = [sentence];
                currentWordCount = sentenceWords;
            }
        }
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
    }

    return chunks.length > 0 ? chunks : [clean];
}

export default function SmartListenButton({
    text,
    iconOnly = false,
    className = '',
    endpoint = '/api/stream_audio',
    onPlay,
}: SmartListenButtonProps) {
    const instanceId = useId();
    const [state, setState] = useState<BtnState>('idle');
    const [chunkInfo, setChunkInfo] = useState('');

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const urlsRef = useRef<(string | null)[]>([]);
    const chunksRef = useRef<string[]>([]);
    const currentIdx = useRef(0);
    const pausedTime = useRef(0); // Track position within current chunk

    // ── Hard stop (full reset) ───────────────────────────────────────
    const hardStop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.onended = null;
        }
        audioManager.release(instanceId);
        setState('idle');
        setChunkInfo('');
        // Reset position
        currentIdx.current = 0;
        pausedTime.current = 0;
    }, [instanceId]);

    // ── Soft pause (keep position) ───────────────────────────────────
    const pause = useCallback(() => {
        if (audioRef.current) {
            pausedTime.current = audioRef.current.currentTime;
            audioRef.current.pause();
        }
        audioManager.release(instanceId);
        setState('paused');
    }, [instanceId]);

    // Cleanup on unmount
    useEffect(() => () => {
        abortRef.current?.abort();
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.removeAttribute('src');
            audioRef.current.load();
        }
        audioManager.release(instanceId);
    }, [instanceId]);

    // ── Fetch with cache ─────────────────────────────────────────────
    const fetchChunk = useCallback(
        async (chunkText: string, signal: AbortSignal): Promise<string> => {
            const cached = ttsCache.get(chunkText);
            if (cached) return cached;
            const res = await fetch(
                `${endpoint}?text=${encodeURIComponent(chunkText)}`,
                { signal }
            );
            if (!res.ok) throw new Error(`TTS ${res.status}`);
            const blob = await res.blob();
            return ttsCache.set(chunkText, blob);
        },
        [endpoint]
    );

    // ── Pre-fetch ahead ──────────────────────────────────────────────
    const prefetch = useCallback(
        async (fromIdx: number, signal: AbortSignal) => {
            const chunks = chunksRef.current;
            const end = Math.min(fromIdx + PREFETCH_AHEAD, chunks.length);
            const promises = [];
            for (let i = fromIdx; i < end; i++) {
                if (!urlsRef.current[i] && !signal.aborted) {
                    promises.push(
                        fetchChunk(chunks[i], signal)
                            .then((url) => { urlsRef.current[i] = url; })
                            .catch(() => { })
                    );
                }
            }
            await Promise.all(promises);
        },
        [fetchChunk]
    );

    // ── Play a chunk ─────────────────────────────────────────────────
    const playChunk = useCallback(
        async (idx: number, startTime: number = 0) => {
            const chunks = chunksRef.current;
            if (idx >= chunks.length) { hardStop(); return; }

            const signal = abortRef.current?.signal;
            if (!signal || signal.aborted) return;

            currentIdx.current = idx;
            setChunkInfo(chunks.length > 1 ? `${idx + 1}/${chunks.length}` : '');

            try {
                if (!urlsRef.current[idx]) {
                    urlsRef.current[idx] = await fetchChunk(chunks[idx], signal);
                }

                if (!audioRef.current) audioRef.current = new Audio();
                const audio = audioRef.current;
                audio.onended = () => {
                    pausedTime.current = 0;
                    playChunk(idx + 1);
                };
                audio.src = urlsRef.current[idx]!;
                audio.currentTime = startTime;
                await audio.play();

                prefetch(idx + 1, signal);
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error('TTS playback error:', err);
                    setState('error');
                    setTimeout(() => setState('idle'), 3000);
                }
            }
        },
        [hardStop, fetchChunk, prefetch]
    );

    // ── Start fresh ──────────────────────────────────────────────────
    const startFresh = useCallback(async () => {
        // Reset everything
        abortRef.current?.abort();
        currentIdx.current = 0;
        pausedTime.current = 0;
        setState('loading');

        abortRef.current = new AbortController();
        const signal = abortRef.current.signal;

        // Register with global manager (stops any other player)
        audioManager.acquire(instanceId, hardStop);

        try {
            const chunks = splitIntoChunks(text);
            if (!chunks.length) { setState('idle'); return; }

            chunksRef.current = chunks;
            urlsRef.current = new Array(chunks.length).fill(null);

            // 🚀 KEY OPTIMIZATION: Fetch chunk 0 + prefetch chunks 1-6 IN PARALLEL
            // Chunk 0 (tiny first sentence) fetches fast → instant playback
            // While listening to chunk 0, chunks 1-6 are already loading
            const chunk0Promise = fetchChunk(chunks[0], signal)
                .then((url) => { urlsRef.current[0] = url; });

            // Fire prefetch in background (non-blocking)
            prefetch(1, signal);

            // Wait ONLY for chunk 0 — it's just 1 sentence, so it's fast
            await chunk0Promise;

            if (signal.aborted) return;

            setState('playing');
            onPlay?.();

            // Start playing chunk 0 immediately
            await playChunk(0);
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error('TTS error:', err);
                setState('error');
                setTimeout(() => setState('idle'), 3000);
            }
        }
    }, [text, instanceId, hardStop, fetchChunk, playChunk, prefetch, onPlay]);

    // ── Resume from pause ────────────────────────────────────────────
    const resume = useCallback(async () => {
        // Register with global manager (stops any other player)
        audioManager.acquire(instanceId, hardStop);

        if (!abortRef.current || abortRef.current.signal.aborted) {
            abortRef.current = new AbortController();
        }

        setState('playing');
        await playChunk(currentIdx.current, pausedTime.current);
    }, [instanceId, hardStop, playChunk]);

    // ── Toggle ───────────────────────────────────────────────────────
    const toggle = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (state === 'playing') {
                pause();
            } else if (state === 'loading') {
                hardStop();
            } else if (state === 'paused') {
                resume();
            } else {
                startFresh();
            }
        },
        [state, pause, hardStop, resume, startFresh]
    );

    const isPlaying = state === 'playing';
    const isLoading = state === 'loading';
    const isPaused = state === 'paused';

    // ── Icon-only ────────────────────────────────────────────────────
    if (iconOnly) {
        return (
            <button
                onClick={toggle}
                aria-label={isPlaying ? 'Pause audio' : isPaused ? 'Resume audio' : 'Listen to this article'}
                aria-pressed={isPlaying}
                title={isPlaying ? 'Pause' : 'Listen'}
                className={`
                    relative group/listen w-8 h-8 rounded-full
                    flex items-center justify-center
                    transition-all duration-300 ease-out cursor-pointer
                    outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                    focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950
                    ${isPlaying
                        ? 'bg-blue-600/25 border border-blue-500/40 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
                        : isLoading
                            ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400 animate-pulse'
                            : isPaused
                                ? 'bg-amber-500/15 border-2 border-amber-500/40 text-amber-400'
                                : 'bg-white/15 border-2 border-white/50 text-white hover:text-white hover:border-white/70 hover:bg-white/25 shadow-[0_0_8px_rgba(255,255,255,0.1)]'
                    }
                    hover:scale-110 active:scale-95
                    ${className}
                `}
            >
                {isPlaying && (
                    <span className="absolute inset-0 rounded-full border border-blue-400/40 animate-ping pointer-events-none" />
                )}
                {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 relative z-10 animate-spin" />
                ) : isPlaying ? (
                    <Pause className="w-3.5 h-3.5 relative z-10" />
                ) : isPaused ? (
                    <Volume2 className="w-3.5 h-3.5 relative z-10" />
                ) : (
                    <Volume2 className="w-3.5 h-3.5 relative z-10" />
                )}
            </button>
        );
    }

    // ── Pill ─────────────────────────────────────────────────────────
    return (
        <button
            onClick={toggle}
            aria-label={isPlaying ? 'Pause audio' : isPaused ? 'Resume audio' : 'Listen to this article'}
            aria-pressed={isPlaying}
            title={isPlaying ? 'Pause' : 'Listen'}
            className={`
                relative group/listen inline-flex items-center gap-1.5
                px-3 py-1.5 rounded-full text-xs font-medium
                transition-all duration-300 ease-out cursor-pointer
                outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950
                ${isPlaying
                    ? 'bg-blue-600/20 border border-blue-500/30 text-blue-400 shadow-[0_0_14px_rgba(59,130,246,0.2)]'
                    : isLoading
                        ? 'bg-amber-500/15 border border-amber-500/25 text-amber-400 animate-pulse'
                        : isPaused
                            ? 'bg-amber-500/15 border-2 border-amber-500/40 text-amber-400'
                            : 'bg-white/15 border-2 border-white/50 text-white hover:text-white hover:border-white/70 hover:bg-white/25 shadow-[0_0_8px_rgba(255,255,255,0.1)]'
                }
                hover:scale-105 active:scale-95
                ${className}
            `}
        >
            {isPlaying && (
                <span className="absolute inset-0 rounded-full border border-blue-400/30 animate-ping pointer-events-none" />
            )}
            {isLoading ? (
                <>
                    <Loader2 className="w-3.5 h-3.5 relative z-10 animate-spin" />
                    <span className="relative z-10">Loading...</span>
                </>
            ) : isPlaying ? (
                <>
                    <Pause className="w-3.5 h-3.5 relative z-10" />
                    <span className="relative z-10 flex items-center gap-[2px]">
                        <span className="w-[2px] h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDuration: '0.6s' }} />
                        <span className="w-[2px] h-3 bg-blue-400 rounded-full animate-bounce" style={{ animationDuration: '0.4s', animationDelay: '0.1s' }} />
                        <span className="w-[2px] h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDuration: '0.5s', animationDelay: '0.2s' }} />
                    </span>
                    {chunkInfo && (
                        <span className="relative z-10 text-[10px] text-blue-400/60 ml-0.5">{chunkInfo}</span>
                    )}
                </>
            ) : isPaused ? (
                <>
                    <Volume2 className="w-3.5 h-3.5 relative z-10" />
                    <span className="relative z-10">Resume</span>
                    {chunkInfo && (
                        <span className="relative z-10 text-[10px] text-amber-400/60 ml-0.5">{chunkInfo}</span>
                    )}
                </>
            ) : (
                <>
                    <Volume2 className="w-3.5 h-3.5 relative z-10" />
                    <span className="relative z-10">Listen</span>
                </>
            )}
        </button>
    );
}
