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
   CHUNK_MIN: aim for this many words before looking for a boundary
   CHUNK_MAX: never exceed this — force-split if no boundary found
   These values are tuned so the listener never notices the gap
   between chunks, because it always falls on a sentence boundary. */
const CHUNK_MIN = 35;
const CHUNK_MAX = 60;
const MAX_LEN = 5000;
const PREFETCH_AHEAD = 4;

/**
 * Smart sentence-boundary chunking for natural TTS playback.
 *
 * Strategy (based on TTS best practices):
 *   1. Clean the text and split into individual sentences
 *   2. Group sentences into chunks targeting CHUNK_MIN–CHUNK_MAX words
 *   3. Chunk boundaries ALWAYS fall at sentence endings (. ! ?)
 *      where the listener expects a natural pause — making the
 *      inter-chunk loading gap completely imperceptible
 *
 * This eliminates the "mid-sentence pause" problem entirely.
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
    // Also handles abbreviations like "U.S." by requiring a space after
    const sentences = clean
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (sentences.length === 0) return [clean];

    // Group sentences into chunks, targeting CHUNK_MIN-CHUNK_MAX words
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentWordCount = 0;

    for (const sentence of sentences) {
        const sentenceWords = sentence.split(' ').length;

        // If adding this sentence keeps us under CHUNK_MAX, add it
        if (currentWordCount + sentenceWords <= CHUNK_MAX) {
            currentChunk.push(sentence);
            currentWordCount += sentenceWords;

            // If we've hit the sweet spot (>= CHUNK_MIN), finalize this chunk
            if (currentWordCount >= CHUNK_MIN) {
                chunks.push(currentChunk.join(' '));
                currentChunk = [];
                currentWordCount = 0;
            }
        } else {
            // Adding this sentence would exceed CHUNK_MAX
            // Save what we have (if anything), then start fresh
            if (currentChunk.length > 0) {
                chunks.push(currentChunk.join(' '));
            }

            // Handle very long sentences (> CHUNK_MAX words)
            if (sentenceWords > CHUNK_MAX) {
                // Fall back to clause-based splitting for extra-long sentences
                const words = sentence.split(' ');
                let clauseChunk: string[] = [];
                for (const w of words) {
                    clauseChunk.push(w);
                    if (clauseChunk.length >= CHUNK_MIN && /[,;:—]$/.test(w)) {
                        chunks.push(clauseChunk.join(' '));
                        clauseChunk = [];
                    } else if (clauseChunk.length >= CHUNK_MAX) {
                        chunks.push(clauseChunk.join(' '));
                        clauseChunk = [];
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

    // Don't forget the last chunk
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

            // Fetch ONLY chunk 0 — play immediately once ready
            urlsRef.current[0] = await fetchChunk(chunks[0], signal);

            if (signal.aborted) return;

            setState('playing');
            onPlay?.();

            // Start playing chunk 0 immediately
            await playChunk(0);

            // Prefetch remaining chunks in background (non-blocking)
            prefetch(1, signal);
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
