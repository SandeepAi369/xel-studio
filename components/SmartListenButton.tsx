'use client';

import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { Volume2, Pause, Loader2, Square } from 'lucide-react';
import { audioManager } from '@/lib/audio-manager';

/* ─────────────────────────────────────────────────────────────────────
   SmartListenButton — Browser SpeechSynthesis TTS
   ✅ No server dependency — uses browser's built-in speech engine
   ✅ Smart chunking by sentences for natural pauses
   ✅ Pause / Resume support
   ✅ Single-player-at-a-time (global AudioManager)
   ✅ Voice selection (prefers high-quality English voices)
   ───────────────────────────────────────────────────────────────────── */

interface SmartListenButtonProps {
    text: string;
    iconOnly?: boolean;
    className?: string;
    /** Called when playback starts */
    onPlay?: () => void;
}

type BtnState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

const MAX_LEN = 5000;

// Split text into sentence-level chunks for natural speech
function splitIntoChunks(text: string): string[] {
    const clean = text
        .replace(/[#*`\[\]]/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_LEN);
    if (!clean) return [];

    // Split by sentence boundaries (., !, ?) keeping 2-3 sentences per chunk
    const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;

        if (current && (current + ' ' + trimmed).length > 200) {
            chunks.push(current.trim());
            current = trimmed;
        } else {
            current = current ? current + ' ' + trimmed : trimmed;
        }
    }
    if (current.trim()) chunks.push(current.trim());

    return chunks;
}

// Pick the best English voice available
function getBestVoice(): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;

    // Priority: Google UK > Google US > any English > default
    const priorities = [
        (v: SpeechSynthesisVoice) => v.name.includes('Google UK English'),
        (v: SpeechSynthesisVoice) => v.name.includes('Google US English'),
        (v: SpeechSynthesisVoice) => v.name.includes('Microsoft') && v.lang.startsWith('en'),
        (v: SpeechSynthesisVoice) => v.lang.startsWith('en') && v.localService === false,
        (v: SpeechSynthesisVoice) => v.lang.startsWith('en'),
    ];

    for (const test of priorities) {
        const found = voices.find(test);
        if (found) return found;
    }
    return voices[0];
}

export default function SmartListenButton({
    text,
    iconOnly = false,
    className = '',
    onPlay,
}: SmartListenButtonProps) {
    const instanceId = useId();
    const [state, setState] = useState<BtnState>('idle');
    const [chunkInfo, setChunkInfo] = useState('');
    const chunksRef = useRef<string[]>([]);
    const currentIdx = useRef(0);
    const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

    // Load voices (they may load async)
    useEffect(() => {
        const loadVoices = () => {
            voiceRef.current = getBestVoice();
        };
        loadVoices();
        speechSynthesis.addEventListener('voiceschanged', loadVoices);
        return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    }, []);

    // Cleanup on unmount
    useEffect(() => () => {
        speechSynthesis.cancel();
        audioManager.release(instanceId);
    }, [instanceId]);

    // ── Hard stop ────────────────────────────────────────────────────
    const hardStop = useCallback(() => {
        speechSynthesis.cancel();
        audioManager.release(instanceId);
        setState('idle');
        setChunkInfo('');
        currentIdx.current = 0;
    }, [instanceId]);

    // ── Play a specific chunk ────────────────────────────────────────
    const playChunk = useCallback(
        (idx: number) => {
            const chunks = chunksRef.current;
            if (idx >= chunks.length) {
                hardStop();
                return;
            }

            currentIdx.current = idx;
            setChunkInfo(chunks.length > 1 ? `${idx + 1}/${chunks.length}` : '');

            const utterance = new SpeechSynthesisUtterance(chunks[idx]);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            if (voiceRef.current) {
                utterance.voice = voiceRef.current;
                utterance.lang = voiceRef.current.lang;
            } else {
                utterance.lang = 'en-US';
            }

            utterance.onend = () => {
                playChunk(idx + 1);
            };

            utterance.onerror = (event) => {
                if (event.error !== 'canceled' && event.error !== 'interrupted') {
                    console.error('TTS error:', event.error);
                    setState('error');
                    setTimeout(() => setState('idle'), 3000);
                }
            };

            speechSynthesis.speak(utterance);
        },
        [hardStop]
    );

    // ── Start fresh ──────────────────────────────────────────────────
    const startFresh = useCallback(() => {
        speechSynthesis.cancel();
        setState('loading');
        currentIdx.current = 0;

        // Register with global manager
        audioManager.acquire(instanceId, hardStop);

        const chunks = splitIntoChunks(text);
        if (!chunks.length) {
            setState('idle');
            return;
        }

        chunksRef.current = chunks;
        setState('playing');
        onPlay?.();
        playChunk(0);
    }, [text, instanceId, hardStop, playChunk, onPlay]);

    // ── Pause ────────────────────────────────────────────────────────
    const pause = useCallback(() => {
        speechSynthesis.pause();
        setState('paused');
    }, []);

    // ── Resume ───────────────────────────────────────────────────────
    const resume = useCallback(() => {
        audioManager.acquire(instanceId, hardStop);
        speechSynthesis.resume();
        setState('playing');
    }, [instanceId, hardStop]);

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

    // ── Icon-only variant ────────────────────────────────────────────
    if (iconOnly) {
        return (
            <button
                onClick={toggle}
                aria-label={isPlaying ? 'Pause audio' : isPaused ? 'Resume audio' : 'Listen to this article'}
                aria-pressed={isPlaying}
                title={isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Listen'}
                className={`
                    relative group/listen w-8 h-8 rounded-full
                    flex items-center justify-center
                    transition-all duration-300 ease-out cursor-pointer
                    outline-none focus-visible:ring-2 focus-visible:ring-green-500
                    focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950
                    ${isPlaying
                        ? 'bg-green-600/25 border border-green-500/40 text-green-400 shadow-[0_0_12px_rgba(34,197,94,0.25)]'
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
                    <span className="absolute inset-0 rounded-full border border-green-400/40 animate-ping pointer-events-none" />
                )}
                {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 relative z-10 animate-spin" />
                ) : isPlaying ? (
                    <Pause className="w-3.5 h-3.5 relative z-10" />
                ) : (
                    <Volume2 className="w-3.5 h-3.5 relative z-10" />
                )}
            </button>
        );
    }

    // ── Pill variant ─────────────────────────────────────────────────
    return (
        <button
            onClick={toggle}
            aria-label={isPlaying ? 'Pause audio' : isPaused ? 'Resume audio' : 'Listen to this article'}
            aria-pressed={isPlaying}
            title={isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Listen'}
            className={`
                relative group/listen inline-flex items-center gap-1.5
                px-3 py-1.5 rounded-full text-xs font-medium
                transition-all duration-300 ease-out cursor-pointer
                outline-none focus-visible:ring-2 focus-visible:ring-green-500
                focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950
                ${isPlaying
                    ? 'bg-green-600/20 border border-green-500/30 text-green-400 shadow-[0_0_14px_rgba(34,197,94,0.2)]'
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
                <span className="absolute inset-0 rounded-full border border-green-400/30 animate-ping pointer-events-none" />
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
                        <span className="w-[2px] h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDuration: '0.6s' }} />
                        <span className="w-[2px] h-3 bg-green-400 rounded-full animate-bounce" style={{ animationDuration: '0.4s', animationDelay: '0.1s' }} />
                        <span className="w-[2px] h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDuration: '0.5s', animationDelay: '0.2s' }} />
                    </span>
                    {chunkInfo && (
                        <span className="relative z-10 text-[10px] text-green-400/60 ml-0.5">{chunkInfo}</span>
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
