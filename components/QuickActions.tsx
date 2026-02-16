'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Zap, MessageSquare } from 'lucide-react';

export default function QuickActions() {
    return (
        <div className="max-w-6xl mx-auto px-4 mb-8">
            <motion.div
                className="flex items-center justify-center gap-3"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.4 }}
            >
                <Link
                    href="/ai-news"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                               border-2 border-blue-500/50 text-white
                               hover:border-blue-400/70 hover:text-white
                               transition-all duration-200"
                >
                    <Zap className="w-5 h-5 text-blue-400" />
                    AI Techniques
                </Link>

                <Link
                    href="/chat"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                               border-2 border-blue-500/50 text-white
                               hover:border-blue-400/70 hover:text-white
                               transition-all duration-200"
                >
                    <MessageSquare className="w-5 h-5 text-blue-400" />
                    Chat with AI
                </Link>
            </motion.div>
        </div>
    );
}
