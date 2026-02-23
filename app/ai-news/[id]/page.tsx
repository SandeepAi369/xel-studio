"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import {
    ArrowLeft,
    Clock,
    Bot,
    Sparkles,
    Globe,
    Zap,
    Share2,
    Heart,
    Copy,
    Check,
    Accessibility,
    LayoutGrid,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/* ─── Types ────────────────────────────────────────────────── */
interface NewsItem {
    id: string;
    title: string;
    summary: string;
    image_url: string | null;
    source_link: string;
    source_name: string;
    date: string;
    category: string;
}

/* ─── Category Config ─────────────────────────────────────── */
const CATEGORY_CONFIG: Record<string, { icon: typeof Sparkles; label: string; color: string; bg: string; accent: string }> = {
    ai: {
        icon: Sparkles,
        label: "Artificial Intelligence",
        color: "text-violet-300",
        bg: "bg-violet-500/20",
        accent: "from-violet-600/20 to-violet-900/10",
    },
    tech: {
        icon: Zap,
        label: "Technology",
        color: "text-sky-300",
        bg: "bg-sky-500/15",
        accent: "from-sky-600/20 to-sky-900/10",
    },
    disability: {
        icon: Accessibility,
        label: "Disability",
        color: "text-amber-300",
        bg: "bg-amber-500/15",
        accent: "from-amber-600/20 to-amber-900/10",
    },
    world: {
        icon: Globe,
        label: "World News",
        color: "text-emerald-300",
        bg: "bg-emerald-500/15",
        accent: "from-emerald-600/20 to-emerald-900/10",
    },
    general: {
        icon: LayoutGrid,
        label: "General",
        color: "text-zinc-300",
        bg: "bg-zinc-500/15",
        accent: "from-zinc-600/20 to-zinc-900/10",
    },
};

/* ─── Helpers ──────────────────────────────────────────────── */
function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function timeAgo(dateStr: string): string {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return formatDate(dateStr);
}

/* ─── Page Component ──────────────────────────────────────── */
export default function NewsDetailPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    const [article, setArticle] = useState<NewsItem | null>(null);
    const [loading, setLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [imgError, setImgError] = useState(false);
    const [liked, setLiked] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        async function fetchArticle() {
            try {
                const docRef = doc(db, "news", id);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    setArticle({ id: snap.id, ...snap.data() } as NewsItem);
                }
            } catch (err) {
                console.error("Failed to load article:", err);
            } finally {
                setLoading(false);
            }
        }
        if (id) fetchArticle();
    }, [id]);

    // Trigger entrance animation after mount
    useEffect(() => {
        const timer = setTimeout(() => setMounted(true), 50);
        return () => clearTimeout(timer);
    }, []);

    const config = article
        ? CATEGORY_CONFIG[article.category] || CATEGORY_CONFIG.general
        : CATEGORY_CONFIG.general;
    const Icon = config.icon;

    /* ─── Loading Skeleton ─── */
    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-white">
                <div className="max-w-3xl mx-auto px-4 py-8">
                    <div className="animate-pulse space-y-6">
                        <div className="h-4 bg-zinc-800 rounded w-20" />
                        <div className="w-full aspect-[16/9] bg-zinc-800 rounded-2xl" />
                        <div className="h-8 bg-zinc-800 rounded w-3/4" />
                        <div className="h-4 bg-zinc-800/60 rounded w-1/3" />
                        <div className="space-y-3 pt-4">
                            <div className="h-4 bg-zinc-800/40 rounded w-full" />
                            <div className="h-4 bg-zinc-800/40 rounded w-full" />
                            <div className="h-4 bg-zinc-800/40 rounded w-5/6" />
                            <div className="h-4 bg-zinc-800/40 rounded w-full" />
                            <div className="h-4 bg-zinc-800/40 rounded w-4/6" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    /* ─── Not Found ─── */
    if (!article) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
                <div className="text-center">
                    <Bot className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-zinc-300 mb-2">
                        Article not found
                    </h2>
                    <p className="text-zinc-500 mb-6">
                        This article may have been removed or expired.
                    </p>
                    <button
                        onClick={() => router.push("/ai-news")}
                        className="px-5 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm"
                    >
                        ← Back to News Feed
                    </button>
                </div>
            </div>
        );
    }

    /* ─── Article Detail ─── */
    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* Gradient accent header */}
            <div className={`bg-gradient-to-b ${config.accent} to-transparent`}>
                <div className="max-w-3xl mx-auto px-4 pt-6 pb-2">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-6 group"
                    >
                        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                        <span className="text-sm">Back to Feed</span>
                    </button>
                </div>
            </div>

            {/* Article content — with slide-up entrance */}
            <article
                className={`max-w-3xl mx-auto px-4 pb-16 transition-all duration-500 ease-out ${mounted
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-6"
                    }`}
            >
                {/* Hero Image */}
                {article.image_url && !imgError && (
                    <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden mb-6 bg-zinc-800">
                        <img
                            src={article.image_url}
                            alt={article.title}
                            className="w-full h-full object-cover"
                            onError={() => setImgError(true)}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    </div>
                )}

                {/* Category badge */}
                <div className="mb-4">
                    <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full ${config.bg} ${config.color}`}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {config.label}
                    </span>
                </div>

                {/* Title */}
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight mb-4">
                    {article.title}
                </h1>

                {/* Meta bar */}
                <div className="flex items-center flex-wrap gap-4 text-sm text-zinc-500 mb-8 pb-6 border-b border-zinc-800/60">
                    <span className="font-medium text-zinc-400">
                        {article.source_name}
                    </span>
                    <time dateTime={article.date} className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {timeAgo(article.date)}
                    </time>


                </div>

                {/* Article body — split into proper paragraphs */}
                <div className="prose prose-invert prose-lg max-w-none">
                    {(() => {
                        // Split by double newlines first
                        let paragraphs = article.summary.split(/\n\n+/).filter(p => p.trim());
                        // If only one big paragraph, try splitting by sentences (~3 per paragraph)
                        if (paragraphs.length === 1 && paragraphs[0].length > 200) {
                            const sentences = paragraphs[0].match(/[^.!?]+[.!?]+/g) || [paragraphs[0]];
                            paragraphs = [];
                            for (let i = 0; i < sentences.length; i += 3) {
                                paragraphs.push(sentences.slice(i, i + 3).join(' ').trim());
                            }
                        }
                        return paragraphs.map((paragraph, i) => (
                            <p
                                key={i}
                                className="text-lg md:text-xl text-gray-300 leading-relaxed mb-6"
                            >
                                {paragraph.trim()}
                            </p>
                        ));
                    })()}
                </div>

                {/* Action Buttons — Like, Share, Copy */}
                <div className="mt-8 pt-6 border-t border-zinc-800/60">
                    <div className="flex items-center gap-3">
                        {/* Like */}
                        <button
                            onClick={() => setLiked(!liked)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${liked
                                ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60 hover:text-white'
                                }`}
                        >
                            <Heart className={`w-4 h-4 ${liked ? 'fill-red-400' : ''}`} />
                            {liked ? 'Liked' : 'Like'}
                        </button>

                        {/* Share */}
                        <button
                            onClick={() => {
                                if (navigator.share) {
                                    navigator.share({
                                        title: article.title,
                                        text: article.summary.slice(0, 100) + '...',
                                        url: window.location.href,
                                    }).catch(() => { });
                                } else {
                                    navigator.clipboard?.writeText(window.location.href);
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60 hover:text-white text-sm font-medium transition-all duration-200"
                        >
                            <Share2 className="w-4 h-4" />
                            Share
                        </button>

                        {/* Copy */}
                        <button
                            onClick={() => {
                                navigator.clipboard?.writeText(article.summary);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${copied
                                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60 hover:text-white'
                                }`}
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-8 pt-6 border-t border-zinc-800/60 flex items-center justify-between">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors group"
                    >
                        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                        <span className="text-sm">Back to Feed</span>
                    </button>
                    <span className="text-xs text-zinc-600">
                        XeL AI News · {new Date(article.date).toLocaleDateString()}
                    </span>
                </div>
            </article>
        </div>
    );
}
