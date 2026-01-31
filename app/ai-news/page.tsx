'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Newspaper, ArrowLeft, Search, Clock, ExternalLink, Sparkles } from 'lucide-react';

interface NewsItem {
    id: string;
    title: string;
    summary: string;
    source: string;
    date: string;
    category: string;
    link?: string;
}

const categoryColors: Record<string, string> = {
    'LLM': '#06b6d4',
    'Research': '#a855f7',
    'Security': '#ef4444',
    'Open Source': '#10b981',
    'Industry': '#f59e0b',
};

export default function AINewsPage() {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        // Fetch news from API (ready for future integration)
        fetch('/api/content?type=aiNews')
            .then(res => res.json())
            .then(data => {
                setNews(data.items || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const filteredNews = news.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.summary.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <main className="min-h-screen bg-[#0a0a0a] pb-16">
            {/* Header */}
            <header className="pt-16 pb-8 px-4 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <Newspaper className="w-16 h-16 mx-auto mb-6 text-amber-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
                        AI News
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Latest AI Updates, Research Breakthroughs & Industry Trends
                    </p>
                </motion.div>
            </header>

            <div className="max-w-6xl mx-auto px-4">
                {/* Search Bar */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="mb-8"
                >
                    <div className="relative max-w-md mx-auto">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                        <input
                            type="text"
                            placeholder="Search news..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 transition-colors"
                        />
                    </div>
                </motion.div>

                {/* Loading State */}
                {loading && (
                    <div className="flex justify-center py-16">
                        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}

                {/* Empty State */}
                {!loading && news.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-16"
                    >
                        <Newspaper className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500 text-lg mb-2">No news yet</p>
                        <p className="text-zinc-600 text-sm">AI news feed coming soon!</p>
                    </motion.div>
                )}

                {/* News Grid */}
                {!loading && filteredNews.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="grid gap-6 md:grid-cols-2"
                    >
                        <AnimatePresence>
                            {filteredNews.map((item, index) => (
                                <motion.article
                                    key={item.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ delay: index * 0.1 }}
                                    className="group p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-amber-500/30 transition-all duration-300 cursor-pointer"
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <span
                                            className="px-3 py-1 text-xs font-semibold rounded-full"
                                            style={{
                                                backgroundColor: `${categoryColors[item.category] || '#f59e0b'}20`,
                                                color: categoryColors[item.category] || '#f59e0b',
                                                border: `1px solid ${categoryColors[item.category] || '#f59e0b'}40`,
                                            }}
                                        >
                                            {item.category}
                                        </span>
                                        <div className="flex items-center gap-1 text-zinc-500 text-xs">
                                            <Clock className="w-3 h-3" />
                                            <span>{item.date}</span>
                                        </div>
                                    </div>

                                    <h3 className="text-lg font-bold text-white mb-2 group-hover:text-amber-400 transition-colors">
                                        {item.title}
                                    </h3>

                                    <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                                        {item.summary}
                                    </p>

                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-zinc-500">{item.source}</span>
                                        {item.link && (
                                            <a
                                                href={item.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-amber-400 text-sm hover:text-amber-300 transition-colors"
                                            >
                                                <span>Read more</span>
                                                <ExternalLink className="w-4 h-4" />
                                            </a>
                                        )}
                                    </div>
                                </motion.article>
                            ))}
                        </AnimatePresence>
                    </motion.div>
                )}

                {/* No Search Results */}
                {!loading && news.length > 0 && filteredNews.length === 0 && (
                    <div className="text-center py-16">
                        <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500">No news match your search</p>
                    </div>
                )}

                {/* Back Link */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="mt-12 text-center"
                >
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-6 py-3 text-zinc-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Home
                    </Link>
                </motion.div>
            </div>
        </main>
    );
}
