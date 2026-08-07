'use client';

import { useState } from 'react';
import { Copy, Share2, Heart } from 'lucide-react';

interface NewsActionButtonsProps {
    title: string;
    summary: string;
}

export default function NewsActionButtons({ title, summary }: NewsActionButtonsProps) {
    const [copied, setCopied] = useState(false);
    const [liked, setLiked] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(
                `${title}\n\n${summary}\n\n— XeL AI News`
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* fallback */
        }
    };

    const handleShare = async () => {
        try {
            if (navigator.share) {
                await navigator.share({
                    title: title,
                    text: title,
                    url: window.location.href,
                });
            } else {
                await navigator.clipboard.writeText(window.location.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }
        } catch {
            /* user cancelled */
        }
    };

    return (
        <div className="flex items-center gap-3 mt-8 pt-6 border-t border-zinc-800/60">
            <button
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy article'}
                className={`p-2.5 rounded-xl border transition-all duration-200 ${
                    copied
                        ? 'bg-green-500/20 border-green-500/40 text-green-400'
                        : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-white hover:bg-zinc-700/50'
                }`}
            >
                <Copy className="w-[18px] h-[18px]" />
            </button>
            <button
                onClick={handleShare}
                title="Share article"
                className="p-2.5 rounded-xl border bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-white hover:bg-zinc-700/50 transition-all duration-200"
            >
                <Share2 className="w-[18px] h-[18px]" />
            </button>
            <button
                onClick={() => setLiked(!liked)}
                title={liked ? 'Unlike' : 'Like'}
                className={`p-2.5 rounded-xl border transition-all duration-200 ${
                    liked
                        ? 'bg-red-500/20 border-red-500/40 text-red-400'
                        : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-white hover:bg-zinc-700/50'
                }`}
            >
                <Heart className={`w-[18px] h-[18px] ${liked ? 'fill-red-400' : ''}`} />
            </button>
        </div>
    );
}
