'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

/**
 * Wraps page content with smooth fade+slide entry animation.
 * Used on pages that don't already have framer-motion animations.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
        >
            {children}
        </motion.div>
    );
}
