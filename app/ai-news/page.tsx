'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Newspaper, ArrowLeft, Search, Clock, ExternalLink, Loader2 } from 'lucide-react';

interface NewsItem {
    id: string;
    title: string;
    summary: string;
    image_url: string | null;
    source_link: string;
    source_name: string;
    date: string;
}

// Constants for lazy loading
const INITIAL_LOAD_COUNT = 10;
const PREFETCH_THRESHOLD = 4;
const LOAD_INCREMENT = 5;

export default function DailyNewsPage() {
    const [allNews, setAllNews] = useState<NewsItem[]>([]);
    const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD_COUNT);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isPrefetching, setIsPrefetching] = useState(false);

    const observerRef = useRef<IntersectionObserver | null>(null);
    const prefetchTriggerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        fetch('/api/content?type=aiNews')
            .then(res => res.json())
            .then(data => {
                setAllNews(data.items || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const filteredNews = allNews.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.source_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const visibleNews = filteredNews.slice(0, visibleCount);
    const hasMoreNews = visibleCount < filteredNews.length;

    const handlePrefetch = useCallback(() => {
        if (isPrefetching || !hasMoreNews) return;

        setIsPrefetching(true);
        setTimeout(() => {
            setVisibleCount(prev => Math.min(prev + LOAD_INCREMENT, filteredNews.length));
            setIsPrefetching(false);
        }, 100);
    }, [isPrefetching, hasMoreNews, filteredNews.length]);

    useEffect(() => {
        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    handlePrefetch();
                }
            },
            { rootMargin: '200px', threshold: 0 }
        );

        if (prefetchTriggerRef.current) {
            observerRef.current.observe(prefetchTriggerRef.current);
        }

        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, [handlePrefetch]);

    useEffect(() => {
        setVisibleCount(INITIAL_LOAD_COUNT);
    }, [searchQuery]);

    const handleLoadMore = () => {
        setVisibleCount(prev => Math.min(prev + LOAD_INCREMENT, filteredNews.length));
    };

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
                        Daily News
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Latest Tech Updates, Research Breakthroughs & Industry Trends
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
                {!loading && allNews.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-16"
                    >
                        <Newspaper className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500 text-lg mb-2">No news yet</p>
                        <p className="text-zinc-600 text-sm">Run the news generator script to fetch latest updates!</p>
                    </motion.div>
                )}

                {/* News List */}
                {!loading && visibleNews.length > 0 && (
                    <>
                        <div className="text-center mb-6">
                            <span className="text-zinc-500 text-sm">
                                Showing {visibleNews.length} of {filteredNews.length} articles
                            </span>
                        </div>

                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="space-y-4"
                        >
                            <AnimatePresence mode="popLayout">
                                {visibleNews.map((item, index) => (
                                    <NewsCard
                                        key={item.id}
                                        item={item}
                                        index={index}
                                        isPrefetchTrigger={index === visibleNews.length - PREFETCH_THRESHOLD}
                                        prefetchRef={index === visibleNews.length - PREFETCH_THRESHOLD ? prefetchTriggerRef : null}
                                    />
                                ))}
                            </AnimatePresence>
                        </motion.div>

                        {/* Load More */}
                        {hasMoreNews && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="mt-8 text-center"
                            >
                                {isPrefetching ? (
                                    <div className="flex items-center justify-center gap-2 text-amber-400">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span className="text-sm">Loading more...</span>
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleLoadMore}
                                        className="px-6 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 hover:bg-amber-500/20 transition-colors font-medium"
                                    >
                                        Load More ({filteredNews.length - visibleCount} remaining)
                                    </button>
                                )}
                            </motion.div>
                        )}

                        {!hasMoreNews && filteredNews.length > INITIAL_LOAD_COUNT && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="mt-8 text-center"
                            >
                                <span className="text-zinc-500 text-sm">
                                    ✓ All {filteredNews.length} articles loaded
                                </span>
                            </motion.div>
                        )}
                    </>
                )}

                {/* No Search Results */}
                {!loading && allNews.length > 0 && filteredNews.length === 0 && (
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

// Clean News Card - Conditional image rendering, full content display
function NewsCard({
    item,
    index,
    isPrefetchTrigger,
    prefetchRef
}: {
    item: NewsItem;
    index: number;
    isPrefetchTrigger: boolean;
    prefetchRef: React.RefObject<HTMLDivElement | null> | null;
}) {
    const [imageError, setImageError] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);

    // Determine if we should show the image
    const hasValidImage = item.image_url && !imageError;

    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (diffHours < 1) return 'Just now';
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;

            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch {
            return dateString;
        }
    };

    // Entire card is clickable - opens source in new tab
    const handleCardClick = () => {
        if (item.source_link) {
            window.open(item.source_link, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <motion.article
            ref={isPrefetchTrigger ? prefetchRef : null}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: Math.min(index * 0.03, 0.2) }}
            layout
            onClick={handleCardClick}
            className="group bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden hover:border-amber-500/30 hover:bg-zinc-900/70 transition-all duration-300 cursor-pointer"
        >
            <div className={`flex ${hasValidImage ? 'flex-col md:flex-row' : 'flex-col'}`}>
                {/* Image Section - Only renders if image exists and loads successfully */}
                {hasValidImage && (
                    <div className="relative w-full md:w-64 h-48 md:h-auto md:min-h-[180px] bg-zinc-800 overflow-hidden flex-shrink-0">
                        {/* Skeleton loader */}
                        {!imageLoaded && (
                            <div className="absolute inset-0 bg-zinc-800 animate-pulse" />
                        )}
                        <img
                            src={item.image_url!}
                            alt={item.title}
                            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'
                                }`}
                            referrerPolicy="no-referrer"
                            onError={() => setImageError(true)}
                            onLoad={() => setImageLoaded(true)}
                            loading="lazy"
                        />
                    </div>
                )}

                {/* Content Section - Expands to full width when no image */}
                <div className="flex-1 p-5">
                    {/* Meta info */}
                    <div className="flex items-center justify-between mb-3">
                        <span className="px-3 py-1 text-xs font-medium bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">
                            {item.source_name || 'Tech News'}
                        </span>
                        <div className="flex items-center gap-1 text-zinc-500 text-xs">
                            <Clock className="w-3 h-3" />
                            <span>{formatDate(item.date)}</span>
                        </div>
                    </div>

                    {/* Title */}
                    <h3 className="text-lg font-bold text-white mb-3 group-hover:text-amber-400 transition-colors leading-snug">
                        {item.title}
                    </h3>

                    {/* Full Summary - No truncation */}
                    <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                        {item.summary}
                    </p>

                    {/* Read More indicator */}
                    <div className="flex items-center gap-2 text-amber-400 text-sm font-medium group-hover:text-amber-300 transition-colors">
                        <span>Read Full Article</span>
                        <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                </div>
            </div>
        </motion.article>
    );
}
