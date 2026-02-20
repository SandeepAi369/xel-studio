'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ArrowLeft, Search, Lock, ExternalLink, Shield, Terminal, Key, Fingerprint } from 'lucide-react';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { fetchWithCache } from '@/lib/DataCache';

interface SecurityTool {
    id: string;
    name: string;
    description: string;
    category: string;
    link?: string;
}

const categoryIcons: Record<string, React.ElementType> = {
    'Encryption': Lock,
    'Forensics': Fingerprint,
    'Penetration': Terminal,
    'Authentication': Key,
    'default': Shield
};

export default function SecurityPage() {
    const router = useRouter();
    const [tools, setTools] = useState<SecurityTool[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    useEffect(() => {
        fetchWithCache<SecurityTool[]>(
            '/api/content?type=securityTools',
            (data: Record<string, unknown>) => (data.items as SecurityTool[]) || []
        )
            .then(items => {
                setTools(items);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const categories = [...new Set(tools.map(t => t.category))];

    const filteredTools = tools.filter(tool => {
        const matchesSearch = tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            tool.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = !selectedCategory || tool.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    return (
        <main className="min-h-screen bg-[#0a0a0a] pb-16">
            {/* Header */}
            <header className="pt-16 pb-8 px-4 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <ShieldCheck className="w-16 h-16 mx-auto mb-6 text-red-400" />
                    <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
                        Security
                    </h1>
                    <p className="text-zinc-400 text-lg max-w-md mx-auto">
                        Cyber Defense Tools, Kali Scripts & Security Protocols
                    </p>
                </motion.div>
            </header>

            <div className="max-w-6xl mx-auto px-4">
                {/* Search Bar */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="mb-6"
                >
                    <div className="relative max-w-md mx-auto">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                        <input
                            type="text"
                            placeholder="Search security tools..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-red-500/50 transition-colors"
                        />
                    </div>
                </motion.div>

                {/* Category Filter */}
                {categories.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.15 }}
                        className="mb-8 flex flex-wrap justify-center gap-2"
                    >
                        <button
                            onClick={() => setSelectedCategory(null)}
                            className={`px-4 py-2 rounded-lg text-sm transition-colors ${!selectedCategory
                                ? 'bg-red-600/30 text-red-400 border border-red-500/30'
                                : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                                }`}
                        >
                            All
                        </button>
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`px-4 py-2 rounded-lg text-sm transition-colors ${selectedCategory === cat
                                    ? 'bg-red-600/30 text-red-400 border border-red-500/30'
                                    : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </motion.div>
                )}

                {/* Loading State */}
                {loading && (
                    <SkeletonGrid count={6} variant="security" columns={3} />
                )}

                {/* Empty State */}
                {!loading && tools.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-16"
                    >
                        <Shield className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500 text-lg mb-2">No security tools yet</p>
                        <p className="text-zinc-600 text-sm">Cyber defense arsenal coming soon!</p>
                    </motion.div>
                )}

                {/* Tools Grid */}
                {!loading && filteredTools.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
                    >
                        <AnimatePresence>
                            {filteredTools.map((tool, index) => {
                                const CategoryIcon = categoryIcons[tool.category] || categoryIcons.default;

                                return (
                                    <motion.div
                                        key={tool.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -20 }}
                                        transition={{ delay: index * 0.05 }}
                                        className="group p-5 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-red-500/30 transition-all duration-300"
                                    >
                                        <div className="flex items-start gap-3 mb-3">
                                            <div className="w-10 h-10 bg-gradient-to-br from-red-500/20 to-red-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <CategoryIcon className="w-5 h-5 text-red-400" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-semibold text-white group-hover:text-red-400 transition-colors truncate">
                                                    {tool.name}
                                                </h3>
                                                <span className="text-xs text-zinc-500">{tool.category}</span>
                                            </div>
                                        </div>

                                        <p className="text-sm text-zinc-400 line-clamp-2 mb-4">
                                            {tool.description}
                                        </p>

                                        {tool.link && (
                                            <a
                                                href={tool.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-sm text-red-400 hover:text-red-300 transition-colors"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                                Learn More
                                            </a>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </motion.div>
                )}

                {/* No Search Results */}
                {!loading && tools.length > 0 && filteredTools.length === 0 && (
                    <div className="text-center py-16">
                        <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                        <p className="text-zinc-500">No tools match your search</p>
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
        </main>
    );
}
