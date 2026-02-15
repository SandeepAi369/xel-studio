'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, ExternalLink, Clock, Newspaper, Bot, Cpu, Sparkles } from 'lucide-react';
import SmartListenButton from '@/components/SmartListenButton';

interface NewsItem {
    id: string;
    title: string;
    summary: string;
    image_url: string | null;
    source_link: string;
    source_name: string;
    date: string;
    category?: 'ai' | 'tech';
}

type FilterTab = 'all' | 'ai' | 'tech';

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
    const [filter, setFilter] = useState<FilterTab>('all');

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

    // Sort: AI articles first, then tech; within each by date
    const sortedNews = useMemo(() => {
        let filtered = news;
        if (filter === 'ai') filtered = news.filter(n => n.category === 'ai');
        else if (filter === 'tech') filtered = news.filter(n => n.category !== 'ai');
        
        // AI always on top
        const aiItems = filtered.filter(n => n.category === 'ai');
        const techItems = filtered.filter(n => n.category !== 'ai');
        return [...aiItems, ...techItems];
    }, [news, filter]);

    const aiCount = news.filter(n => n.category === 'ai').length;
    const techCount = news.length - aiCount;

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
                        <Bot className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-medium text-zinc-300">AI & Tech News</span>
                    </div>
                    <div className="w-[52px]" />
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
                        Daily AI & Tech News
                    </h1>
                    <p className="text-sm text-zinc-500 mb-6">
                        AI-first coverage · OpenAI, Google, Microsoft, Meta, open-source models & more
                    </p>

                    {/* Filter Tabs */}
                    {!loading && news.length > 0 && (
                        <div className="flex items-center gap-2 mb-8">
                            <button
                                onClick={() => setFilter('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                    filter === 'all'
                                        ? 'bg-zinc-700 text-white'
                                        : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                                }`}
                            >
                                All ({news.length})
                            </button>
                            <button
                                onClick={() => setFilter('ai')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                                    filter === 'ai'
                                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                        : 'bg-zinc-900/60 text-zinc-400 hover:text-purple-300 hover:bg-purple-500/10'
                                }`}
                            >
                                <Sparkles className="w-3 h-3" /> AI ({aiCount})
                            </button>
                            <button
                                onClick={() => setFilter('tech')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                                    filter === 'tech'
                                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                        : 'bg-zinc-900/60 text-zinc-400 hover:text-cyan-300 hover:bg-cyan-500/10'
                                }`}
                            >
                                <Cpu className="w-3 h-3" /> Tech ({techCount})
                            </button>
                        </div>
                    )}
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

                {/* Empty */}
                {!loading && !error && sortedNews.length === 0 && (
                    <div className="text-center py-16">
                        <Newspaper className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                        <p className="text-zinc-500">
                            {filter !== 'all' ? `No ${filter.toUpperCase()} news available.` : 'No news available yet.'}
                        </p>
                    </div>
                )}

                {/* News List */}
                {!loading && !error && sortedNews.length > 0 && (
                    <div className="space-y-4">
                        {sortedNews.map((item, index) => {
                            const isAI = item.category === 'ai';
                            return (
                                <motion.a
                                    key={item.id}
                                    href={item.source_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    initial={{ opacity: 0, y: 15 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: index * 0.03 }}
                                    className={`block rounded-xl border transition-all duration-200 p-5 group ${
                                        isAI
                                            ? 'bg-purple-950/20 border-purple-800/30 hover:border-purple-600/50 hover:bg-purple-950/30'
                                            : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-600/50 hover:bg-zinc-900/60'
                                    }`}
                                >
                                    <div className="flex gap-4">
                                        {/* Image */}
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
                                            {/* Category Badge + Title + Listen */}
                                            <div className="flex items-start gap-3 mb-1.5">
                                                <div className="flex-1 min-w-0">
                                                    {/* Category Badge */}
                                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded mb-1.5 ${
                                                        isAI
                                                            ? 'bg-purple-500/20 text-purple-300'
                                                            : 'bg-cyan-500/15 text-cyan-400/70'
                                                    }`}>
                                                        {isAI ? <><Sparkles className="w-2.5 h-2.5" /> AI</> : <><Cpu className="w-2.5 h-2.5" /> Tech</>}
                                                    </span>
                                                    <h3 className={`text-base font-semibold transition-colors line-clamp-2 ${
                                                        isAI ? 'text-zinc-100 group-hover:text-purple-200' : 'text-zinc-200 group-hover:text-white'
                                                    }`}>
                                                        {item.title}
                                                    </h3>
                                                </div>
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
                                                <span className={`font-medium ${isAI ? 'text-purple-400/70' : 'text-cyan-400/70'}`}>{item.source_name}</span>
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
                            );
                        })}
                    </div>
                )}

                {/* Footer */}
                {!loading && news.length > 0 && (
                    <p className="text-center text-xs text-zinc-600 mt-8">
                        Showing {sortedNews.length} of {news.length} articles · AI-first · Updated via GitHub Actions
                    </p>
                )}
            </div>
        </div>
    );
}
