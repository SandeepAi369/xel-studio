'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function Hero() {
    const [displayText, setDisplayText] = useState('');
    const [showCursor, setShowCursor] = useState(true);
    const fullText = 'Welcome';

    useEffect(() => {
        let charIndex = 0;
        const typingInterval = setInterval(() => {
            if (charIndex < fullText.length) {
                setDisplayText(fullText.slice(0, charIndex + 1));
                charIndex++;
            } else {
                clearInterval(typingInterval);
                setTimeout(() => setShowCursor(false), 2000);
            }
        }, 120);
        return () => clearInterval(typingInterval);
    }, []);

    return (
        <header className="text-center py-16 md:py-24 px-4">
            <motion.h1
                id="site-title"
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
            >
                <span className="hero-gradient-text">XeL Studio</span>
            </motion.h1>

            <motion.p
                className="mt-3 text-base md:text-lg font-medium tracking-wide"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.5 }}
                style={{ color: '#bf5af2', textShadow: '0 0 12px rgba(191,90,242,0.4)' }}
            >
                {displayText}
                {showCursor && (
                    <motion.span
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
                    >|</motion.span>
                )}
            </motion.p>

            <motion.p
                className="mt-2 text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto subtitle-glow"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
            >
                Architecting Intelligence
            </motion.p>
        </header>
    );
}
