'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, ArrowLeft, Download, Search, Package } from 'lucide-react';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { proxyDownload } from '@/lib/ghost-download';

interface APK {
    id: string;
    name: string;
    version: string;
    downloadUrl: string;
    size: string;
    icon?: string;
    description?: string;
    category?: string;
}

export default function StorePage() {
    const [apks, setApks] = useState<APK[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [downloading, setDownloading] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/content?type=apks')
            .then(res => res.json())
            .then(data => {
                setApks(data.items || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const filteredApks = apks.filter(apk =>
        apk.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        apk.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Ghost Download - seamless no-redirect download
    const handleDownload = async (apk: APK) => {
        const filename = `${apk.name.replace(/[^a-zA-Z0-9.-]/g, '_')}_v${apk.version}.apk`;

        await proxyDownload({
            url: `/api/download/${apk.id}`,
            filename,
            onStart: () => setDownloading(apk.id),
            onComplete: () => setDownloading(null),
            onError: (error) => {
                console.error('Download failed:', error);
                alert('Download failed. Please try again.');
                setDownloading(null);
            }
        });
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
                    <ShoppingBag className="w-16 h-16 mx-auto mb-6 text-emerald-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white glitch-text">
                        Store
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Premium APKs, Bots & Tools - <span className="text-emerald-400">Ghost Downloads</span>
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
                            placeholder="Search APKs..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                        />
                    </div>
                </motion.div>

                {/* Skeleton Loading State */}
                {loading && (
                    <SkeletonGrid count={6} variant="apk" columns={3} />
                )}

                {/* Empty State */}
                {!loading && apks.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-16"
                    >
                        <div className="relative w-24 h-24 mx-auto mb-6">
                            <Package className="w-16 h-16 absolute inset-0 m-auto text-zinc-600" />
                            <div className="absolute inset-0 matrix-rain rounded-full opacity-30" />
                        </div>
                        <p className="text-zinc-500 text-lg mb-2">No APKs available yet</p>
                        <p className="text-zinc-600 text-sm">Check back soon for new releases!</p>
                    </motion.div>
                )}

                {/* APK Grid */}
                {!loading && filteredApks.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
                    >
                        <AnimatePresence>
                            {filteredApks.map((apk, index) => (
                                <motion.div
                                    key={apk.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ delay: index * 0.1 }}
                                    className="group p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-emerald-500/30 transition-all duration-300 glitch"
                                >
                                    <div className="flex items-start gap-4 mb-4">
                                        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:shadow-[0_0_20px_rgba(0,255,170,0.3)] transition-shadow">
                                            <Package className="w-7 h-7 text-emerald-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-semibold text-white text-lg truncate">
                                                {apk.name}
                                            </h3>
                                            <p className="text-sm text-zinc-500">
                                                v{apk.version} • {apk.size}
                                            </p>
                                        </div>
                                    </div>

                                    {apk.description && (
                                        <p className="text-sm text-zinc-400 mb-4 line-clamp-2">
                                            {apk.description}
                                        </p>
                                    )}

                                    <button
                                        onClick={() => handleDownload(apk)}
                                        disabled={downloading === apk.id}
                                        className="w-full py-3 neon-btn rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-medium"
                                    >
                                        {downloading === apk.id ? (
                                            <>
                                                <div className="download-spinner" />
                                                Downloading...
                                            </>
                                        ) : (
                                            <>
                                                <Download className="w-4 h-4" />
                                                Ghost Download
                                            </>
                                        )}
                                    </button>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </motion.div>
                )}

                {/* No Search Results */}
                {!loading && apks.length > 0 && filteredApks.length === 0 && (
                    <div className="text-center py-16">
                        <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500">No APKs match your search</p>
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
