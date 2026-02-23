'use client';

import { useState, useEffect } from 'react';
import { BookOpen, ArrowLeft, Calendar, ChevronRight, FileText, Search } from 'lucide-react';
import SmartListenButton from '@/components/SmartListenButton';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { fetchWithCache } from '@/lib/DataCache';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { prepareTTSText, stripMarkdown } from '@/lib/tts-text';

interface Article {
    id: string;
    title: string;
    image: string;
    content: string;
    date: string;
    category?: string;
}

export default function ArticlesPage() {
    const router = useRouter();
    const [articles, setArticles] = useState<Article[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchWithCache<Article[]>(
            '/api/content?type=articles',
            (data: Record<string, unknown>) => (data.items as Article[]) || []
        )
            .then(items => {
                setArticles(items);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const filteredArticles = articles.filter(article =>
        article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.category?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <main className="min-h-screen bg-[#0a0a0a] pb-16">
            {/* Header */}
            <header className="pt-16 pb-8 px-4 text-center">
                <div>
                    <BookOpen className="w-16 h-16 mx-auto mb-6 text-green-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
                        Articles
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Deep dives into AI Research, LLM Architecture, and Technical Analysis
                    </p>
                </div>
            </header>

            <div className="max-w-6xl mx-auto px-4">
                {/* Search Bar */}
                <div className="mb-8">
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
                </div>

                {/* Loading State */}
                {loading && (
                    <SkeletonGrid count={6} variant="article" columns={2} />
                )}

                {/* Empty State */}
                {!loading && articles.length === 0 && (
                    <div className="text-center py-16">
                        <FileText className="w-16 h-16 mx-auto mb-6 text-zinc-600" />
                        <p className="text-zinc-500 text-lg mb-2">No articles published yet</p>
                        <p className="text-zinc-600 text-sm">Check back soon for new content!</p>
                    </div>
                )}

                {/* Article Grid — NO framer motion animations at all to prevent scroll fights */}
                {!loading && filteredArticles.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredArticles.map((article) => (
                            <Link
                                key={article.id}
                                href={`/articles/${article.id}`}
                                className="article-card block bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden hover:border-green-500/50 hover:bg-zinc-900/80 transition-all duration-200 cursor-pointer h-full"
                            >
                                {/* Image Container */}
                                <div className="h-52 w-full overflow-hidden bg-zinc-800 relative">
                                    {article.image ? (
                                        <img
                                            src={article.image}
                                            alt={article.title}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-900/20 to-zinc-900">
                                            <FileText className="w-12 h-12 text-green-500/30" />
                                        </div>
                                    )}

                                    {/* Category badge */}
                                    {article.category && (
                                        <span
                                            className="absolute top-3 left-3 px-3 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded-full border border-green-500/30"
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            {article.category}
                                        </span>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="p-5">
                                    <div className="flex items-center gap-1.5 text-zinc-500 text-sm mb-3">
                                        <Calendar className="w-3.5 h-3.5" />
                                        <span>{new Date(article.date).toLocaleDateString('en-US', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric'
                                        })}</span>
                                    </div>

                                    <h2 className="text-lg font-semibold text-white line-clamp-2 mb-3">
                                        {article.title}
                                    </h2>

                                    <p className="text-gray-400 text-sm leading-relaxed line-clamp-3">
                                        {stripMarkdown(article.content).substring(0, 150)}...
                                    </p>

                                    <div className="flex items-center justify-between mt-4">
                                        <div className="flex items-center gap-1 text-green-400 text-sm font-medium">
                                            <span>Read more</span>
                                            <ChevronRight className="w-4 h-4" />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                {/* No Search Results */}
                {!loading && articles.length > 0 && filteredArticles.length === 0 && (
                    <div className="text-center py-16">
                        <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500">No articles match your search</p>
                    </div>
                )}

                {/* Back Link */}
                <div className="mt-12 text-center">
                    <button
                        onClick={() => router.back()}
                        className="inline-flex items-center gap-2 px-6 py-3 text-zinc-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Home
                    </button>
                </div>
            </div>
        </main>
    );
}
