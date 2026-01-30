'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ArrowLeft, Search, Calendar, ChevronRight, FileText, X, Eye, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
    const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
    const [glassOpacity, setGlassOpacity] = useState(0.85);
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

    // Keyboard shortcut: O to toggle opacity
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (selectedArticle && e.key.toLowerCase() === 'o') {
                setGlassOpacity(prev => prev === 0.85 ? 0.95 : 0.85);
            }
            if (e.key === 'Escape') {
                setSelectedArticle(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedArticle]);

    const filteredArticles = articles.filter(article =>
        article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.category?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleImageError = useCallback((id: string) => {
        setImageError(prev => ({ ...prev, [id]: true }));
    }, []);

    return (
        <main className="min-h-screen bg-[#0a0a0a] pb-16">
            {/* Header */}
            <header className="pt-16 pb-8 px-4 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <BookOpen className="w-16 h-16 mx-auto mb-6 text-cyan-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white glitch-text">
                        Articles
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Deep dives into AI Research, LLM Architecture, and Technical Analysis
                    </p>
                </motion.div>
            </header>

            <div className="max-w-4xl mx-auto px-4">
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
                            placeholder="Search articles..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                        />
                    </div>
                </motion.div>

                {/* Skeleton Loading State */}
                {loading && (
                    <SkeletonGrid count={4} variant="article" columns={1} />
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

                {/* Article List */}
                {!loading && filteredArticles.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="space-y-4"
                    >
                        <AnimatePresence>
                            {filteredArticles.map((article, index) => (
                                <motion.article
                                    key={article.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ delay: index * 0.1 }}
                                    onClick={() => setSelectedArticle(article)}
                                    className="group p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-cyan-500/30 transition-all duration-300 cursor-pointer glitch"
                                >
                                    <div className="flex items-start gap-4">
                                        {article.image && (
                                            <div className="w-24 h-24 rounded-lg flex-shrink-0 overflow-hidden relative">
                                                {imageError[article.id] ? (
                                                    <MatrixRainCSS />
                                                ) : (
                                                    <img
                                                        src={article.image}
                                                        alt={article.title}
                                                        loading="lazy"
                                                        decoding="async"
                                                        className="w-full h-full object-cover"
                                                        onError={() => handleImageError(article.id)}
                                                    />
                                                )}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-2">
                                                {article.category && (
                                                    <span className="px-2 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded">
                                                        {article.category}
                                                    </span>
                                                )}
                                                <span className="text-sm text-zinc-500 flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {new Date(article.date).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <h2 className="text-xl font-semibold text-white mb-2 group-hover:text-cyan-400 transition-colors">
                                                {article.title}
                                            </h2>
                                            <p className="text-zinc-400 text-sm line-clamp-2">
                                                {article.content.substring(0, 150)}...
                                            </p>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all flex-shrink-0" />
                                    </div>
                                </motion.article>
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

            {/* Enhanced Glassmorphism Article Modal */}
            <AnimatePresence>
                {selectedArticle && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto"
                        onClick={() => setSelectedArticle(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 50, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 50, scale: 0.95 }}
                            onClick={(e) => e.stopPropagation()}
                            className="min-h-screen max-w-3xl mx-auto p-4 md:p-8"
                        >
                            {/* Glassmorphism Modal */}
                            <div
                                className="glass-modal overflow-hidden scanlines"
                                style={{
                                    background: `rgba(18, 18, 18, ${glassOpacity})`
                                }}
                            >
                                {/* Header with controls */}
                                <div className="flex items-center justify-between p-4 border-b border-white/10">
                                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                                        <button
                                            onClick={() => setGlassOpacity(prev => prev === 0.85 ? 0.95 : 0.85)}
                                            className="flex items-center gap-1 hover:text-white transition-colors"
                                            title="Toggle opacity (O)"
                                        >
                                            {glassOpacity > 0.9 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            <span className="hidden sm:inline">Opacity</span>
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => setSelectedArticle(null)}
                                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                                    >
                                        <X className="w-5 h-5 text-zinc-400" />
                                    </button>
                                </div>

                                {/* Article Image */}
                                {selectedArticle.image && (
                                    <div className="relative h-64 overflow-hidden">
                                        {imageError[selectedArticle.id] ? (
                                            <MatrixRainCSS />
                                        ) : (
                                            <img
                                                src={selectedArticle.image}
                                                alt={selectedArticle.title}
                                                className="w-full h-full object-cover"
                                                onError={() => handleImageError(selectedArticle.id)}
                                            />
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />
                                    </div>
                                )}

                                {/* Article Content */}
                                <div className="p-6 md:p-8">
                                    <div className="flex items-center gap-2 mb-4">
                                        {selectedArticle.category && (
                                            <span className="px-3 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded-full border border-cyan-500/30">
                                                {selectedArticle.category}
                                            </span>
                                        )}
                                        <span className="text-sm text-zinc-500 flex items-center gap-1">
                                            <Calendar className="w-3 h-3" />
                                            {new Date(selectedArticle.date).toLocaleDateString()}
                                        </span>
                                    </div>

                                    <h1 className="text-2xl md:text-3xl font-bold text-white mb-6 cyber-gradient inline-block">
                                        {selectedArticle.title}
                                    </h1>

                                    {/* Markdown Content with Cyber Prose */}
                                    <div className="prose prose-invert prose-zinc max-w-none prose-cyber">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                a: ({ href, children }) => (
                                                    <a
                                                        href={href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-[var(--neon-green)] hover:text-[var(--neon-blue)] underline underline-offset-4 transition-colors"
                                                    >
                                                        {children}
                                                    </a>
                                                ),
                                            }}
                                        >
                                            {selectedArticle.content}
                                        </ReactMarkdown>
                                    </div>

                                    <button
                                        onClick={() => setSelectedArticle(null)}
                                        className="mt-8 px-6 py-3 neon-btn rounded-xl font-medium"
                                    >
                                        Close Article
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    );
}
