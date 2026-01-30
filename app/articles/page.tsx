'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ArrowLeft, Search, Calendar, ChevronRight, FileText } from 'lucide-react';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { MatrixRainCSS } from '@/components/MatrixRain';

interface Article {
    id: string;
    title: string;
    image: string;
    content: string;
    date: string;
    category?: string;
}

export default function ArticlesPage() {
    const [articles, setArticles] = useState<Article[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [imageError, setImageError] = useState<Record<string, boolean>>({});

    useEffect(() => {
        fetch('/api/content?type=articles')
            .then(res => res.json())
            .then(data => {
                setArticles(data.items || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const filteredArticles = articles.filter(article =>
        article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.category?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleImageError = useCallback((id: string) => {
        setImageError(prev => ({ ...prev, [id]: true }));
    }, []);

    return (
        <main className="min-h-screen bg-[#0a0a0a] pb-16 relative">
            {/* Header */}
            <header className="pt-16 pb-8 px-4 text-center relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <BookOpen className="w-16 h-16 mx-auto mb-6 text-green-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white glitch-text">
                        Articles
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Deep dives into AI Research, LLM Architecture, and Technical Analysis
                    </p>
                </motion.div>
            </header>

            <div className="max-w-6xl mx-auto px-4 relative z-10">
                {/* Search Bar */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="mb-10"
                >
                    <div className="relative max-w-md mx-auto">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 z-10" />
                        <input
                            type="text"
                            placeholder="Search articles..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/50 transition-colors relative z-10"
                        />
                    </div>
                </motion.div>

                {/* Skeleton Loading State */}
                {loading && (
                    <SkeletonGrid count={6} variant="article" columns={3} />
                )}

                {/* Empty State */}
                {!loading && articles.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-16"
                    >
                        <div className="relative w-24 h-24 mx-auto mb-6">
                            <FileText className="w-16 h-16 absolute inset-0 m-auto text-zinc-600" />
                            <MatrixRainCSS className="rounded-full opacity-30" />
                        </div>
                        <p className="text-zinc-500 text-lg mb-2">No articles published yet</p>
                        <p className="text-zinc-600 text-sm">Check back soon for new content!</p>
                    </motion.div>
                )}

                {/* Article Grid - Perfect Uniform Cards with Z-Index Fix */}
                {!loading && filteredArticles.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-20"
                    >
                        <AnimatePresence>
                            {filteredArticles.map((article, index) => (
                                <motion.div
                                    key={article.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ delay: index * 0.1 }}
                                    className="relative z-20"
                                >
                                    <Link
                                        href={`/articles/${article.id}`}
                                        className="group block relative z-30 cursor-pointer bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden hover:border-green-500/40 hover:shadow-lg hover:shadow-green-500/10 transition-all duration-300"
                                    >
                                        {/* Fixed Height Image Container */}
                                        <div className="relative h-52 w-full overflow-hidden bg-zinc-800">
                                            {article.image && !imageError[article.id] ? (
                                                <Image
                                                    src={article.image}
                                                    alt={article.title}
                                                    fill
                                                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                                                    onError={() => handleImageError(article.id)}
                                                />
                                            ) : (
                                                <div className="w-full h-full">
                                                    <MatrixRainCSS />
                                                </div>
                                            )}
                                            {/* Gradient Overlay */}
                                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 via-transparent to-transparent pointer-events-none" />
                                            
                                            {/* Category Badge */}
                                            {article.category && (
                                                <span className="absolute top-3 left-3 px-3 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded-full border border-green-500/30 backdrop-blur-sm pointer-events-none">
                                                    {article.category}
                                                </span>
                                            )}
                                        </div>

                                        {/* Card Content */}
                                        <div className="p-5 flex flex-col">
                                            {/* Date */}
                                            <div className="flex items-center gap-1.5 text-zinc-500 text-sm mb-3">
                                                <Calendar className="w-3.5 h-3.5" />
                                                <span>{new Date(article.date).toLocaleDateString('en-US', { 
                                                    year: 'numeric', 
                                                    month: 'short', 
                                                    day: 'numeric' 
                                                })}</span>
                                            </div>

                                            {/* Title */}
                                            <h2 className="text-lg font-semibold text-white mb-3 group-hover:text-green-400 transition-colors line-clamp-2">
                                                {article.title}
                                            </h2>

                                            {/* Preview Text - line-clamp-3 for perfect alignment */}
                                            <p className="text-green-400/80 text-sm leading-relaxed line-clamp-3 flex-1">
                                                {article.content.replace(/[#*`\[\]]/g, '').substring(0, 200)}
                                            </p>

                                            {/* Read More */}
                                            <div className="flex items-center gap-1 mt-4 text-green-400 text-sm font-medium group-hover:gap-2 transition-all">
                                                <span>Read more</span>
                                                <ChevronRight className="w-4 h-4" />
                                            </div>
                                        </div>
                                    </Link>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </motion.div>
                )}

                {/* No Search Results */}
                {!loading && articles.length > 0 && filteredArticles.length === 0 && (
                    <div className="text-center py-16">
                        <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500">No articles match your search</p>
                    </div>
                )}

                {/* Back Link */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="mt-12 text-center relative z-20"
                >
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-6 py-3 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Home
                    </Link>
                </motion.div>
            </div>
        </main>
    );
}
