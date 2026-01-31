'use client';

import { motion } from 'framer-motion';
import { Newspaper, ExternalLink, Clock, Sparkles } from 'lucide-react';

const newsItems = [
    {
        id: 1,
        title: 'GPT-5 Rumors: What We Know So Far',
        summary: 'OpenAI is reportedly working on their next major release with enhanced reasoning capabilities.',
        source: 'AI Weekly',
        date: '2 hours ago',
        category: 'LLM',
        link: '#',
    },
    {
        id: 2,
        title: 'Google DeepMind Unveils New Multimodal AI',
        summary: 'A breakthrough in combining vision, language, and reasoning in a single unified model.',
        source: 'Tech Insider',
        date: '5 hours ago',
        category: 'Research',
        link: '#',
    },
    {
        id: 3,
        title: 'AI in Cybersecurity: 2026 Trends',
        summary: 'How artificial intelligence is reshaping threat detection and response strategies.',
        source: 'Cyber Defense',
        date: '1 day ago',
        category: 'Security',
        link: '#',
    },
    {
        id: 4,
        title: 'Open Source AI Models Breaking Records',
        summary: 'Community-driven models are now competing with proprietary solutions in key benchmarks.',
        source: 'Open AI News',
        date: '2 days ago',
        category: 'Open Source',
        link: '#',
    },
];

const categoryColors: Record<string, string> = {
    'LLM': '#06b6d4',
    'Research': '#a855f7',
    'Security': '#ef4444',
    'Open Source': '#10b981',
};

export default function AINews() {
    return (
        <section className="max-w-6xl mx-auto px-4 py-16">
            {/* Section Header */}
            <motion.div
                className="flex items-center gap-3 mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <Sparkles className="w-8 h-8 text-yellow-400" />
                <h2 className="text-3xl md:text-4xl font-bold text-zinc-50">
                    AI News
                </h2>
                <span className="ml-2 px-3 py-1 text-xs font-medium bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 rounded-full text-cyan-400">
                    Live Feed
                </span>
            </motion.div>

            {/* News Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {newsItems.map((news, index) => (
                    <motion.article
                        key={news.id}
                        className="group relative p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/50 hover:border-zinc-600/50 transition-all duration-300 cursor-pointer"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.1 * index }}
                        whileHover={{ y: -4 }}
                    >
                        {/* Category Badge */}
                        <div className="flex items-center justify-between mb-4">
                            <span
                                className="px-3 py-1 text-xs font-semibold rounded-full"
                                style={{
                                    backgroundColor: `${categoryColors[news.category]}20`,
                                    color: categoryColors[news.category],
                                    border: `1px solid ${categoryColors[news.category]}40`,
                                }}
                            >
                                {news.category}
                            </span>
                            <div className="flex items-center gap-1 text-zinc-500 text-xs">
                                <Clock className="w-3 h-3" />
                                <span>{news.date}</span>
                            </div>
                        </div>

                        {/* Title */}
                        <h3 className="text-lg md:text-xl font-bold text-zinc-100 mb-2 group-hover:text-white transition-colors">
                            {news.title}
                        </h3>

                        {/* Summary */}
                        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                            {news.summary}
                        </p>

                        {/* Footer */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-zinc-500">
                                <Newspaper className="w-4 h-4" />
                                <span className="text-xs">{news.source}</span>
                            </div>
                            <div className="flex items-center gap-1 text-cyan-400 text-sm group-hover:text-cyan-300 transition-colors">
                                <span>Read more</span>
                                <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>

                        {/* Hover Glow Effect */}
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-500/0 via-purple-500/0 to-pink-500/0 group-hover:from-cyan-500/5 group-hover:via-purple-500/5 group-hover:to-pink-500/5 transition-all duration-500 pointer-events-none" />
                    </motion.article>
                ))}
            </div>

            {/* View All Button */}
            <motion.div
                className="mt-8 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
            >
                <button className="neon-btn px-8 py-3 rounded-xl font-semibold text-sm">
                    View All AI News
                </button>
            </motion.div>
        </section>
    );
}
