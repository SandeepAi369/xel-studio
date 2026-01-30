'use client';

import { motion } from 'framer-motion';

export default function Hero() {
    return (
        <header className="text-center py-16 md:py-24 px-4">
            <motion.h1
                id="site-title"
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
            >
                <span className="hero-gradient-text">
                    XeL Studio
                </span>
            </motion.h1>

            <motion.p
                className="mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto subtitle-glow"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            >
                Architecting Intelligence
            </motion.p>

            <motion.p
                className="mt-2 text-sm md:text-base text-zinc-500"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
            >
                AI Research × Cyber Security
            </motion.p>
        </header>
    );
}
