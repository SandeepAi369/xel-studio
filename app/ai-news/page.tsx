'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, ExternalLink, Clock, Newspaper } from 'lucide-react';
import SmartListenButton from '@/components/SmartListenButton';

interface NewsItem {
    id: string;
    title: string;
    summary: string;
    image_url: string | null;
    source_link: string;
    source_name: string;
    date: string;
}

function timeAgo(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AINewsPage() {
    const router = useRouter();
    const [news, setNews] = useState<NewsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchNews() {
            try {
                const res = await fetch('/data/tech_news.json');
                if (!res.ok) throw new Error('Failed to load news');
                const data = await res.json();
                setNews(data.news || []);
            } catch (err) {
                setError('Could not load AI news. Please try again later.');
                console.error('News fetch error:', err);
            } finally {
                setLoading(false);
            }
        }
        fetchNews();
    }, []);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* Header */}
            <div className="border-b border-white/5">
                <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-sm">Back</span>
                    </button>
                    <div className="flex items-center gap-2">
                        <Newspaper className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-medium text-zinc-300">AI News</span>
                    </div>
                    <div className="w-[52px]" /> {/* spacer for centering */}
                </div>
            </div>

            {/* Content */}
            <div className="max-w-5xl mx-auto px-4 py-8">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-1">
                        Daily AI News
                    </h1>
                    <p className="text-sm text-zinc-500 mb-8">
                        Auto-updated twice daily · Powered by Gemini AI summaries
                    </p>
                </motion.div>

                {/* Loading */}
                {loading && (
                    <div className="space-y-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="rounded-xl bg-zinc-900/40 border border-zinc-800/50 p-5 animate-pulse">
                                <div className="h-4 bg-zinc-800 rounded w-3/4 mb-3" />
                                <div className="h-3 bg-zinc-800/60 rounded w-full mb-2" />
                                <div className="h-3 bg-zinc-800/60 rounded w-5/6" />
                            </div>
                        ))}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="text-center py-16">
                        <p className="text-zinc-400">{error}</p>
                    </div>
                )}

                {/* News List */}
                {!loading && !error && news.length === 0 && (
                    <div className="text-center py-16">
                        <Newspaper className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                        <p className="text-zinc-500">No news available yet.</p>
                    </div>
                )}

                {!loading && !error && news.length > 0 && (
                    <div className="space-y-4">
                        {news.map((item, index) => (
                            <motion.a
                                key={item.id}
                                href={item.source_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: index * 0.03 }}
                                className="block rounded-xl bg-zinc-900/40 border border-zinc-800/50 
                                           hover:border-zinc-600/50 hover:bg-zinc-900/60 
                                           transition-all duration-200 p-5 group"
                            >
                                <div className="flex gap-4">
                                    {/* Image (if available) */}
                                    {item.image_url && (
                                        <div className="hidden sm:block shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-zinc-800">
                                            <img
                                                src={item.image_url}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />
                                        </div>
                                    )}

                                    <div className="flex-1 min-w-0">
                                        {/* Title + Listen */}
                                        <div className="flex items-start gap-3 mb-1.5">
                                            <h3 className="text-base font-semibold text-zinc-200 group-hover:text-white 
                                                           transition-colors line-clamp-2 flex-1">
                                                {item.title}
                                            </h3>
                                            <div className="flex-shrink-0 mt-0.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                                                <SmartListenButton text={item.title + '. ' + item.summary} iconOnly className="w-9 h-9" />
                                            </div>
                                        </div>

                                        {/* Summary */}
                                        <p className="text-sm text-zinc-400 mb-3 leading-relaxed">
                                            {item.summary}
                                        </p>

                                        {/* Meta */}
                                        <div className="flex items-center gap-3 text-xs text-zinc-500">
                                            <span className="font-medium text-cyan-400/70">{item.source_name}</span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {timeAgo(item.date)}
                                            </span>
                                            <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-zinc-400">
                                                Read <ExternalLink className="w-3 h-3" />
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </motion.a>
                        ))}
                    </div>
                )}

                {/* Footer */}
                {!loading && news.length > 0 && (
                    <p className="text-center text-xs text-zinc-600 mt-8">
                        Showing {news.length} articles · Updated via GitHub Actions
                    </p>
                )}
            </div>
        </div>
    );
}
