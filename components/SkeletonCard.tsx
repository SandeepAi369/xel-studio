'use client';

import { motion } from 'framer-motion';

interface SkeletonCardProps {
    variant?: 'article' | 'apk' | 'ai' | 'security';
    className?: string;
}

export default function SkeletonCard({ variant = 'article', className = '' }: SkeletonCardProps) {
    const baseClasses = 'skeleton bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden';

    if (variant === 'apk') {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`${baseClasses} p-6 ${className}`}
            >
                {/* Icon placeholder */}
                <div className="skeleton w-16 h-16 rounded-xl mb-4" />

                {/* Title */}
                <div className="skeleton skeleton-title mb-2" />

                {/* Version/Size */}
                <div className="skeleton skeleton-text w-1/3 mb-4" />

                {/* Description */}
                <div className="space-y-2 mb-4">
                    <div className="skeleton skeleton-text" />
                    <div className="skeleton skeleton-text w-3/4" />
                </div>

                {/* Button placeholder */}
                <div className="skeleton h-10 rounded-lg" />
            </motion.div>
        );
    }

    if (variant === 'ai') {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`${baseClasses} p-6 ${className}`}
            >
                {/* Status badge */}
                <div className="skeleton w-20 h-6 rounded-full mb-4" />

                {/* Title */}
                <div className="skeleton skeleton-title mb-3" />

                {/* Description */}
                <div className="space-y-2">
                    <div className="skeleton skeleton-text" />
                    <div className="skeleton skeleton-text w-2/3" />
                </div>
            </motion.div>
        );
    }

    if (variant === 'security') {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`${baseClasses} p-5 flex items-start gap-4 ${className}`}
            >
                {/* Icon */}
                <div className="skeleton w-12 h-12 rounded-xl flex-shrink-0" />

                <div className="flex-1">
                    {/* Title */}
                    <div className="skeleton skeleton-title mb-2" />

                    {/* Category badge */}
                    <div className="skeleton w-16 h-5 rounded-full mb-2" />

                    {/* Description */}
                    <div className="skeleton skeleton-text w-3/4" />
                </div>
            </motion.div>
        );
    }

    // Default: article variant
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`${baseClasses} ${className}`}
        >
            {/* Image placeholder */}
            <div className="skeleton skeleton-image" />

            <div className="p-5">
                {/* Category badge */}
                <div className="skeleton w-20 h-5 rounded-full mb-3" />

                {/* Title */}
                <div className="skeleton skeleton-title mb-2" />

                {/* Date */}
                <div className="skeleton skeleton-text w-24 mb-3" />

                {/* Excerpt */}
                <div className="space-y-2">
                    <div className="skeleton skeleton-text" />
                    <div className="skeleton skeleton-text w-4/5" />
                </div>
            </div>
        </motion.div>
    );
}

interface SkeletonGridProps {
    count?: number;
    variant?: 'article' | 'apk' | 'ai' | 'security';
    columns?: 1 | 2 | 3;
}

export function SkeletonGrid({ count = 6, variant = 'article', columns = 2 }: SkeletonGridProps) {
    const gridCols = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 md:grid-cols-2',
        3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    };

    return (
        <div className={`grid ${gridCols[columns]} gap-6`}>
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonCard key={i} variant={variant} />
            ))}
        </div>
    );
}
