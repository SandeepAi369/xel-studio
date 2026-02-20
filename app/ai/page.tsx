'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ArrowLeft, Search, Beaker, ExternalLink, Sparkles, Archive, FlaskConical } from 'lucide-react';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { fetchWithCache } from '@/lib/DataCache';

interface AILab {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'experimental' | 'archived';
    demoUrl?: string;
    image?: string;
}

const statusConfig = {
    active: { icon: Sparkles, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Active' },
    experimental: { icon: FlaskConical, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Experimental' },
    archived: { icon: Archive, color: 'text-zinc-400', bg: 'bg-zinc-500/20', label: 'Archived' }
};

export default function AIPage() {
    const router = useRouter();
    const [labs, setLabs] = useState<AILab[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLab, setSelectedLab] = useState<AILab | null>(null);

    useEffect(() => {
        fetchWithCache<AILab[]>(
            '/api/content?type=aiLabs',
            (data: Record<string, unknown>) => (data.items as AILab[]) || []
        )
            .then(items => {
                setLabs(items);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const filteredLabs = labs.filter(lab =>
        lab.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lab.description.toLowerCase().includes(searchQuery.toLowerCase())
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
                    <Brain className="w-16 h-16 mx-auto mb-6 text-purple-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
                        AI Labs
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Research & Experimental Models, Custom AI & Automation Systems
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
                            placeholder="Search experiments..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 transition-colors"
                        />
                    </div>
                </motion.div>

                {/* Loading State */}
                {loading && (
                    <SkeletonGrid count={4} variant="ai" columns={2} />
                )}

                {/* Empty State */}
                {!loading && labs.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-16"
                    >
                        <Beaker className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500 text-lg mb-2">No experiments yet</p>
                        <p className="text-zinc-600 text-sm">AI research projects coming soon!</p>
                    </motion.div>
                )}

                {/* Labs Grid */}
                {!loading && filteredLabs.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="grid gap-6 md:grid-cols-2"
                    >
                        <AnimatePresence>
                            {filteredLabs.map((lab, index) => {
                                const status = statusConfig[lab.status];
                                const StatusIcon = status.icon;

                                return (
                                    <motion.div
                                        key={lab.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -20 }}
                                        transition={{ delay: index * 0.1 }}
                                        onClick={() => setSelectedLab(lab)}
                                        className="group p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-purple-500/30 transition-all duration-300 cursor-pointer"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-14 h-14 bg-gradient-to-br from-purple-500/20 to-purple-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
                                                <Brain className="w-7 h-7 text-purple-400" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className={`px-2 py-1 text-xs ${status.bg} ${status.color} rounded flex items-center gap-1`}>
                                                        <StatusIcon className="w-3 h-3" />
                                                        {status.label}
                                                    </span>
                                                </div>
                                                <h3 className="font-semibold text-white text-lg mb-2 group-hover:text-purple-400 transition-colors">
                                                    {lab.name}
                                                </h3>
                                                <p className="text-sm text-zinc-400 line-clamp-2">
                                                    {lab.description}
                                                </p>
                                            </div>
                                        </div>

                                        {lab.demoUrl && (
                                            <a
                                                href={lab.demoUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="mt-4 w-full py-3 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-400 rounded-xl transition-colors flex items-center justify-center gap-2"
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                                Try Demo
                                            </a>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </motion.div>
                )}

                {/* No Search Results */}
                {!loading && labs.length > 0 && filteredLabs.length === 0 && (
                    <div className="text-center py-16">
                        <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500">No experiments match your search</p>
                    </div>
                )}

                {/* Back Link */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="mt-12 text-center"
                >
                    <button
                        onClick={() => router.back()}
                        className="inline-flex items-center gap-2 px-6 py-3 text-zinc-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Home
                    </button>
                </motion.div>
            </div>

            {/* Lab Detail Modal */}
            <AnimatePresence>
                {selectedLab && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                        onClick={() => setSelectedLab(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6"
                        >
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-16 h-16 bg-gradient-to-br from-purple-500/20 to-purple-600/20 rounded-xl flex items-center justify-center">
                                    <Brain className="w-8 h-8 text-purple-400" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-white">{selectedLab.name}</h2>
                                    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs ${statusConfig[selectedLab.status].bg} ${statusConfig[selectedLab.status].color} rounded mt-1`}>
                                        {statusConfig[selectedLab.status].label}
                                    </span>
                                </div>
                            </div>

                            <p className="text-zinc-300 mb-6 leading-relaxed">
                                {selectedLab.description}
                            </p>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setSelectedLab(null)}
                                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-white transition-colors"
                                >
                                    Close
                                </button>
                                {selectedLab.demoUrl && (
                                    <a
                                        href={selectedLab.demoUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl text-white transition-colors flex items-center justify-center gap-2"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                        Open Demo
                                    </a>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    );
}
