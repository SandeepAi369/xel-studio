'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
                    <BookOpen className="w-16 h-16 mx-auto mb-6 text-green-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white glitch-text">
                        Articles
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Deep dives into AI Research, LLM Architecture, and Technical Analysis
                    </p>
                </motion.div>
            </header>

            <div className="max-w-6xl mx-auto px-4">
                {/* Search Bar */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="mb-10"
                >
                    <div className="relative max-w-md mx-auto">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                        <input
                            type="text"
                            placeholder="Search articles..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/50 transition-colors"
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

                {/* Article Grid - Perfect Uniform Cards */}
                {!loading && filteredArticles.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
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
                                    className="group bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden hover:border-green-500/40 hover:shadow-lg hover:shadow-green-500/10 transition-all duration-300 cursor-pointer flex flex-col"
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
                                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 via-transparent to-transparent" />
                                        
                                        {/* Category Badge */}
                                        {article.category && (
                                            <span className="absolute top-3 left-3 px-3 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded-full border border-green-500/30 backdrop-blur-sm">
                                                {article.category}
                                            </span>
                                        )}
                                    </div>

                                    {/* Card Content */}
                                    <div className="p-5 flex-1 flex flex-col">
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
                                className="glass-modal overflow-hidden scanlines rounded-2xl"
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
                                    <div className="relative h-72 overflow-hidden">
                                        {imageError[selectedArticle.id] ? (
                                            <MatrixRainCSS />
                                        ) : (
                                            <Image
                                                src={selectedArticle.image}
                                                alt={selectedArticle.title}
                                                fill
                                                className="object-cover"
                                                onError={() => handleImageError(selectedArticle.id)}
                                            />
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />
                                    </div>
                                )}

                                {/* Article Content */}
                                <div className="p-6 md:p-8">
                                    <div className="flex items-center gap-3 mb-5">
                                        {selectedArticle.category && (
                                            <span className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                                                {selectedArticle.category}
                                            </span>
                                        )}
                                        <span className="text-sm text-zinc-500 flex items-center gap-1.5">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {new Date(selectedArticle.date).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric'
                                            })}
                                        </span>
                                    </div>

                                    <h1 className="text-2xl md:text-3xl font-bold text-white mb-8 leading-tight">
                                        {selectedArticle.title}
                                    </h1>

                                    {/* Markdown Content with Premium Blog Styling */}
                                    <div className="prose prose-invert prose-zinc max-w-none
                                        prose-headings:text-white prose-headings:font-bold
                                        prose-h1:text-2xl prose-h1:mt-8 prose-h1:mb-4
                                        prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-3 prose-h2:text-green-400
                                        prose-h3:text-lg prose-h3:mt-4 prose-h3:mb-2
                                        prose-p:text-green-400/80 prose-p:leading-relaxed prose-p:mb-4
                                        prose-li:text-green-400/80 prose-li:marker:text-green-500
                                        prose-strong:text-white prose-strong:font-semibold
                                        prose-code:text-green-300 prose-code:bg-zinc-800/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
                                        prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800
                                        prose-blockquote:border-l-green-500 prose-blockquote:bg-zinc-900/50 prose-blockquote:py-1 prose-blockquote:text-zinc-300
                                    ">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                a: ({ href, children }) => (
                                                    <a
                                                        href={href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-green-400 hover:text-green-300 underline underline-offset-4 decoration-green-500/50 hover:decoration-green-400 transition-colors"
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
                                        className="mt-10 px-8 py-3 bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl font-medium hover:bg-green-500/30 transition-colors"
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
