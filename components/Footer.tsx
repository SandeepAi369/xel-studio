'use client';

import { Mail } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Footer() {
    return (
        <motion.footer
            className="mt-auto py-6 px-4 border-t border-emerald-500/10"
            style={{
                background: 'linear-gradient(to bottom, #0a0a0a, #18181b)',
            }}
            aria-label="Site footer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.5, ease: 'easeOut' }}
        >
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-sm text-zinc-400">
                    © 2026 XeL Studio. Built by{' '}
                    <span className="text-emerald-400 font-medium">Sandeep</span>.
                </p>

                <div className="flex items-center gap-4" role="list">
                    <motion.a
                        href="mailto:sandeep@xelstudio.dev"
                        aria-label="Send email"
                        className="text-zinc-400 hover:text-emerald-400 transition-colors duration-300"
                        whileHover={{ scale: 1.1, y: -2 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <Mail className="w-5 h-5" aria-hidden="true" />
                    </motion.a>
                </div>
            </div>
        </motion.footer>
    );
}
