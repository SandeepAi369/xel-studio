"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    Clock,
    Calendar,
    Tag,
    Bot,
    FileText,
} from "lucide-react";
import SmartListenButton from "@/components/SmartListenButton";
import { prepareTTSText } from "@/lib/tts-text";

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

/* ─── Category Display Config ─────────────────────────────── */
const CATEGORY_DISPLAY: Record<string, { label: string; color: string; bg: string; border: string }> = {
    "ai-tech": { label: "AI & Technology", color: "text-violet-400", bg: "bg-violet-500/20", border: "border-violet-500/30" },
    "accessibility": { label: "Disability & Accessibility", color: "text-amber-400", bg: "bg-amber-500/20", border: "border-amber-500/30" },
    "disability": { label: "Disability & Accessibility", color: "text-amber-400", bg: "bg-amber-500/20", border: "border-amber-500/30" },
    "health": { label: "Health & Society", color: "text-amber-400", bg: "bg-amber-500/20", border: "border-amber-500/30" },
    "climate": { label: "Climate & Environment", color: "text-emerald-400", bg: "bg-emerald-500/20", border: "border-emerald-500/30" },
    "world": { label: "World News", color: "text-emerald-400", bg: "bg-emerald-500/20", border: "border-emerald-500/30" },
    "science": { label: "Science & Space", color: "text-blue-400", bg: "bg-blue-500/20", border: "border-blue-500/30" },
    "business": { label: "Business & Economy", color: "text-cyan-400", bg: "bg-cyan-500/20", border: "border-cyan-500/30" },
    "entertainment": { label: "Culture & Entertainment", color: "text-pink-400", bg: "bg-pink-500/20", border: "border-pink-500/30" },
    "general": { label: "General", color: "text-zinc-400", bg: "bg-zinc-500/20", border: "border-zinc-500/30" },
};

/* ─── Helpers ──────────────────────────────────────────────── */
function getReadingTime(content: string): number {
    const wordsPerMinute = 200;
    const words = content.split(/\s+/).length;
    return Math.ceil(words / wordsPerMinute);
}

function formatContent(content: string): string[] {
    let cleaned = content
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/ {3,}/g, '  ')
        .replace(/([.!?])\1{2,}/g, '$1')
        .replace(/\*{3,}/g, '')
        .replace(/#{1,6}\s*/g, '')
        .replace(/^[-=]{3,}$/gm, '')
        .trim();

    return cleaned
        .split(/\n{2,}/)
        .flatMap(block => {
            if (block.length > 500 && block.includes('\n')) {
                return block.split(/\n/).map(p => p.trim()).filter(p => p.length > 0);
            }
            return [block.trim()];
        })
        .filter(p => p.length > 0);
}

/* ─── Page Component ──────────────────────────────────────── */
export default function NewsDetailPage() {
    const params = useParams();
    const id = params?.id as string;

    const [article, setArticle] = useState<NewsItem | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;

        async function fetchArticle() {
            try {
                const docRef = doc(db, "news", id);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setArticle({ id: docSnap.id, ...docSnap.data() } as NewsItem);
                }
            } catch (err) {
                console.error("Error fetching news article:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchArticle();
    }, [id]);

    // Loading state
    if (loading) {
        return (
            <main className="min-h-screen bg-[#0a0a0a]">
                <div className="relative h-[40vh] min-h-[300px] w-full overflow-hidden bg-zinc-900 animate-pulse" />
                <div className="max-w-5xl mx-auto px-3 sm:px-6 -mt-20 relative z-10 pb-16">
                    <div className="bg-zinc-900/95 rounded-2xl border border-zinc-800/60 p-8">
                        <div className="h-6 w-24 bg-zinc-800 rounded-full mb-6 animate-pulse" />
                        <div className="h-10 w-3/4 bg-zinc-800 rounded-lg mb-4 animate-pulse" />
                        <div className="space-y-3 mt-8">
                            <div className="h-4 bg-zinc-800 rounded animate-pulse" />
                            <div className="h-4 bg-zinc-800 rounded animate-pulse w-5/6" />
                            <div className="h-4 bg-zinc-800 rounded animate-pulse w-4/6" />
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    // Not found
    if (!article) {
        return (
            <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <div className="text-center">
                    <FileText className="w-16 h-16 mx-auto mb-6 text-zinc-600" />
                    <h1 className="text-2xl font-bold text-white mb-2">Article Not Found</h1>
                    <p className="text-zinc-400 mb-6">This news article could not be found.</p>
                    <Link
                        href="/ai-news"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl font-medium hover:bg-green-500/30 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to News
                    </Link>
                </div>
            </main>
        );
    }

    const readingTime = getReadingTime(article.summary);
    const paragraphs = formatContent(article.summary);
    const catConfig = CATEGORY_DISPLAY[article.category] || CATEGORY_DISPLAY.general;

    return (
        <main className="min-h-screen bg-[#0a0a0a]" role="main" aria-label={article.title}>
            {/* Hero Section with Image */}
            <div className="relative h-[40vh] min-h-[300px] w-full overflow-hidden bg-zinc-900">
                {article.image_url ? (
                    <img
                        src={article.image_url}
                        alt={article.title}
                        className="w-full h-full object-cover opacity-80"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-900/30 to-zinc-900" />
                )}

                {/* Gradient overlay */}
                <div
                    className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent"
                    style={{ pointerEvents: 'none' }}
                />

                {/* Back Button */}
                <Link
                    href="/ai-news"
                    className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors z-10"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                </Link>
            </div>

            {/* Article Content */}
            <div className="max-w-5xl mx-auto px-3 sm:px-6 -mt-20 relative z-10 pb-16">
                <article className="bg-zinc-900/95 rounded-2xl border border-zinc-800/60 overflow-hidden shadow-xl shadow-black/20">
                    {/* Article Header */}
                    <div className="p-5 sm:p-8 md:p-10 border-b border-zinc-800">
                        {/* Meta Info */}
                        <div className="flex flex-wrap items-center gap-4 mb-6">
                            {article.category && (
                                <span className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${catConfig.bg} ${catConfig.color} rounded-full border ${catConfig.border}`}>
                                    <Tag className="w-3.5 h-3.5" />
                                    {catConfig.label}
                                </span>
                            )}
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Calendar className="w-4 h-4" />
                                {new Date(article.date).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                })}
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Clock className="w-4 h-4" />
                                {readingTime} min read
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Bot className="w-4 h-4" />
                                AI Generated
                            </span>
                        </div>

                        {/* Title + Listen */}
                        <div className="flex items-start gap-4">
                            <h1 className="text-lg md:text-xl font-bold text-white leading-snug flex-1">
                                {article.title}
                            </h1>
                            <div className="flex-shrink-0 mt-1">
                                <SmartListenButton text={prepareTTSText(article.title, article.summary)} iconOnly className="w-11 h-11" />
                            </div>
                        </div>
                    </div>

                    {/* Article Body — Clean text formatting (same as articles section) */}
                    <div className="p-5 sm:p-8 md:p-10">
                        <div className="space-y-4 max-w-none">
                            {paragraphs.map((paragraph, index) => {
                                const isNumberedItem = /^\d+\./.test(paragraph);
                                const hasLink = paragraph.includes('http');

                                // Numbered list items
                                if (isNumberedItem) {
                                    return (
                                        <div
                                            key={index}
                                            className="pl-6 border-l-2 border-green-500/30 py-2"
                                        >
                                            <p className="text-gray-300 text-[15px] leading-[1.8]">
                                                {paragraph}
                                            </p>
                                        </div>
                                    );
                                }

                                // Paragraphs with links
                                if (hasLink) {
                                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                                    const parts = paragraph.split(urlRegex);

                                    return (
                                        <p key={index} className="text-gray-300 text-[15px] leading-[1.8]">
                                            {parts.map((part, i) => {
                                                if (part.match(urlRegex)) {
                                                    return (
                                                        <a
                                                            key={i}
                                                            href={part}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-green-400 underline underline-offset-4 hover:text-green-300 break-all"
                                                        >
                                                            {part}
                                                        </a>
                                                    );
                                                }
                                                return part;
                                            })}
                                        </p>
                                    );
                                }

                                // Regular paragraphs
                                return (
                                    <p
                                        key={index}
                                        className="text-gray-300 text-[15px] leading-[1.8]"
                                    >
                                        {paragraph}
                                    </p>
                                );
                            })}
                        </div>
                    </div>

                    {/* Article Footer */}
                    <div className="p-8 md:p-10 border-t border-zinc-800 bg-zinc-900/50">
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                            <p className="text-zinc-500 text-sm">
                                Thank you for reading this article.
                            </p>
                            <Link
                                href="/ai-news"
                                className="inline-flex items-center gap-2 px-6 py-3 bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl font-medium hover:bg-green-500/30 transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                More News
                            </Link>
                        </div>
                    </div>
                </article>
            </div>
        </main>
    );
}
