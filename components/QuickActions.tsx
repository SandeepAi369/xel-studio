'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Zap, MessageSquare } from 'lucide-react';

export default function QuickActions() {
    return (
        <div className="max-w-6xl mx-auto px-4 mb-8">
            <motion.div
                className="flex items-center justify-center gap-2"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.4 }}
            >
                <Link
                    href="/ai-news"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
                               border border-blue-500/50 text-white
                               hover:border-blue-400/70 hover:text-white
                               transition-all duration-200 whitespace-nowrap"
                >
                    <Zap className="w-4 h-4 text-blue-400" />
                    AI Techniques
                </Link>

                <Link
                    href="/chat"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
                               border border-blue-500/50 text-white
                               hover:border-blue-400/70 hover:text-white
                               transition-all duration-200 whitespace-nowrap"
                >
                    <MessageSquare className="w-4 h-4 text-blue-400" />
                    Chat with AI
                </Link>
            </motion.div>
        </div>
    );
}
