'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Volume2, Pause, Square, Loader2 } from 'lucide-react';
import { ttsCache } from '@/lib/tts-cache';

/* ─────────────────────────────────────────────────────────────────────
   SmartStreamPlayer — Full-featured TTS player with progress bar
   Uses in-memory cache (RAM only, cleared on tab close)
   ───────────────────────────────────────────────────────────────────── */

interface SmartStreamPlayerProps {
    text: string;
    className?: string;
    endpoint?: string;
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'error';

const MAX_LEN = 5000;
const FIRST_CHUNK = 15;
const CHUNK_TARGET = 80;
const DEFAULT_ENDPOINT = '/api/stream_audio';

function splitChunks(text: string): string[] {
    const clean = text
        .replace(/[#*`\[\]]/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_LEN);
    if (!clean) return [];
    const words = clean.split(' ');
    if (words.length <= FIRST_CHUNK) return [clean];
    const chunks: string[] = [words.slice(0, FIRST_CHUNK).join(' ')];
    let cur: string[] = [];
    for (let i = FIRST_CHUNK; i < words.length; i++) {
        const w = words[i];
        cur.push(w);
        if ((cur.length >= CHUNK_TARGET && /[.!?;:]$/.test(w)) || cur.length >= CHUNK_TARGET + 20) {
            chunks.push(cur.join(' '));
            cur = [];
        }
    }
    if (cur.length) chunks.push(cur.join(' '));
    return chunks;
}

export default function SmartStreamPlayer({
    text,
    className = '',
    endpoint = DEFAULT_ENDPOINT,
}: SmartStreamPlayerProps) {
    const [state, setState] = useState<PlayerState>('idle');
    const [progress, setProgress] = useState(0);
    const [elapsed, setElapsed] = useState('0:00');
    const [chunkInfo, setChunkInfo] = useState('');

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const urlsRef = useRef<string[]>([]);
    const chunksRef = useRef<string[]>([]);
    const currentIdx = useRef(0);
    const rafRef = useRef(0);

    const cleanup = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.removeAttribute('src');
            audioRef.current.load();
            audioRef.current.onended = null;
        }
        urlsRef.current = [];
        chunksRef.current = [];
        currentIdx.current = 0;
        cancelAnimationFrame(rafRef.current);
    }, []);

    const stop = useCallback(() => {
        cleanup();
        setState('idle');
        setProgress(0);
        setElapsed('0:00');
        setChunkInfo('');
    }, [cleanup]);

    useEffect(() => () => cleanup(), [cleanup]);

    const trackProgress = useCallback(() => {
        const tick = () => {
            const a = audioRef.current;
            if (adb connect 192.168.0.103:39403
 || a.paused || a.ended) return;
            if (a.duration && isFinite(a.duration)) {
                setProgress((a.currentTime / a.duration) * 100);
                const m = Math.floor(a.currentTime / 60);
                const s = Math.floor(a.currentTime % 60);
                setElapsed(`${m}:${s.toString().padStart(2, '0')}`);
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        tick();
    }, []);

    const fetchChunk = useCallback(
        async (chunkText: string, signal: AbortSignal): Promise<string> => {
            const cached = ttsCache.get(chunkText);
            if (cached) return cached;
            const res = await fetch(`${endpoint}?text=${encodeURIComponent(chunkText)}`, { signal });
            if (!res.ok) throw new Error(`TTS ${res.status}`);
            const blob = await res.blob();
            return ttsCache.set(chunkText, blob);
        },
        [endpoint]
    );

    const prefetchAhead = useCallback(
        async (fromIdx: number, signal: AbortSignal) => {
            for (let i = fromIdx; i < Math.min(fromIdx + 2, chunksRef.current.length); i++) {
                if (signal.aborted || urlsRef.current[i]) continue;
                try { urlsRef.current[i] = await fetchChunk(chunksRef.current[i], signal); } catch {}
            }
        },
        [fetchChunk]
    );

    const playChunk = useCallback(
        async (idx: number) => {
            if (idx >= chunksRef.current.length) { stop(); return; }
            const signal = abortRef.current?.signal;
            if (!signal || signal.aborted) return;
            currentIdx.current = idx;
            setChunkInfo(chunksRef.current.length > 1 ? `${idx + 1}/${chunksRef.current.length}` : '');
            try {
                if (!urlsRef.current[idx]) {
                    urlsRef.current[idx] = await fetchChunk(chunksRef.current[idx], signal);
                }
                if (!audioRef.current) audioRef.current = new Audio();
                audioRef.current.onended = () => playChunk(idx + 1);
                audioRef.current.src = urlsRef.current[idx];
                await audioRef.current.play();
                trackProgress();
                prefetchAhead(idx + 1, signal);
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    setState('error');
                    setTimeout(() => setState('idle'), 3000);
                }
            }
        },
        [stop, fetchChunk, prefetchAhead, trackProgress]
    );

    const play = useCallback(async () => {
        cleanup();
        setState('loading');
        abortRef.current = new AbortController();
        const signal = abortRef.current.signal;
        try {
            const chunks = splitChunks(text);
            if (!chunks.length) { setState('idle'); return; }
            chunksRef.current = chunks;
            urlsRef.current = new Array(chunks.length).fill(null);
            const fetches = [fetchChunk(chunks[0], signal)];
            if (chunks.length > 1) fetches.push(fetchChunk(chunks[1], signal));
            const results = await Promise.all(fetches);
            urlsRef.current[0] = results[0];
            if (results[1]) urlsRef.current[1] = results[1];
            if (signal.aborted) return;
            setState('playing');
            await playChunk(0);
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                setState('error');
                setTimeout(() => setState('idle'), 3000);
            }
        }
    }, [text, cleanup, fetchChunk, playChunk]);

    const toggle = useCallback(() => {
        if (state === 'playing' || state === 'loading') stop();
        else play();
    }, [state, stop, play]);

    const isPlaying = state === 'playing';
    const isLoading = state === 'loading';
    const isError = state === 'error';

    return (
        <div
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className={`
                inline-flex items-center gap-3 px-4 py-2.5 rounded-2xl
                bg-zinc-900/80 border border-zinc-800
                transition-all duration-300
                ${isPlaying ? 'border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.1)]' : ''}
                ${isError ? 'border-red-500/30' : ''}
                ${className}
            `}
        >
            <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
                disabled={isError}
                aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
                className={`
                    relative w-10 h-10 rounded-full flex items-center justify-center
                    transition-all duration-300 cursor-pointer
                    outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                    ${isPlaying
                        ? 'bg-blue-600/25 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                        : isLoading
                        ? 'bg-amber-500/20 text-amber-400'
                        : isError
                        ? 'bg-red-500/20 text-red-400 cursor-not-allowed'
                        : 'bg-white/10 text-white hover:bg-white/20 hover:scale-105'
                    }
                    active:scale-95
                `}
            >
                {isPlaying && (
                    <span className="absolute inset-0 rounded-full border border-blue-400/40 animate-ping pointer-events-none" />
                )}
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" />
                    : isPlaying ? <Square className="w-4 h-4 fill-current" />
                    : isError ? <span className="text-xs font-bold">!</span>
                    : <Volume2 className="w-5 h-5" />}
            </button>

            <div className="flex flex-col min-w-[100px]">
                <span className="text-xs font-medium text-zinc-300">
                    {isLoading ? 'Generating...'
                        : isPlaying ? `Playing ${chunkInfo}`
                        : isError ? 'Error — tap to retry'
                        : 'Listen to article'}
                </span>
                {(isPlaying || isLoading) && (
                    <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
                            {isLoading
                                ? <div className="h-full w-1/3 bg-amber-500/60 rounded-full animate-pulse" />
                                : <div className="h-full bg-blue-500 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />}
                        </div>
                        {isPlaying && <span className="text-[10px] text-zinc-500 tabular-nums">{elapsed}</span>}
                    </div>
                )}
                {isPlaying && (
                    <div className="flex items-end gap-[2px] mt-1 h-3">
                        {[0.6, 0.4, 0.5, 0.3, 0.7, 0.45].map((dur, i) => (
                            <span key={i} className="w-[2px] bg-blue-400/60 rounded-full animate-bounce"
                                style={{ animationDuration: `${dur}s`, animationDelay: `${i * 0.08}s`, height: `${40 + Math.random() * 60}%` }} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
