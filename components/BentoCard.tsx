'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { BookOpen, Brain, ShoppingBag, ShieldCheck } from 'lucide-react';

const cardData = [
    {
        id: 'articles',
        title: 'Articles',
        description: 'Deep dives into AI Research, LLM Architecture, and Technical Analysis',
        href: '/articles',
        iconName: 'BookOpen',
        accentColor: '#06b6d4',
        glowColor: 'rgba(6, 182, 212, 0.5)',
        isWide: true,
    },
    {
        id: 'ai',
        title: 'AI Labs',
        description: 'Research & Experimental Models, Custom AI & Automation Systems',
        href: '/ai',
        iconName: 'Brain',
        accentColor: '#a855f7',
        glowColor: 'rgba(168, 85, 247, 0.5)',
    },
    {
        id: 'store',
        title: 'Store',
        description: 'Premium APKs, Bots & Tools - Direct Downloads Available',
        href: '/store',
        iconName: 'ShoppingBag',
        accentColor: '#10b981',
        glowColor: 'rgba(16, 185, 129, 0.5)',
    },
    {
        id: 'security',
        title: 'Security',
        description: 'Cyber Defense Tools, Kali Scripts & Security Protocols',
        href: '/shield',
        iconName: 'ShieldCheck',
        accentColor: '#f87171',
        glowColor: 'rgba(248, 113, 113, 0.6)',
    },
];

const iconMap = {
    BookOpen,
    Brain,
    ShoppingBag,
    ShieldCheck,
};

interface CardProps {
    id: string;
    title: string;
    description: string;
    href: string;
    iconName: keyof typeof iconMap;
    accentColor: string;
    glowColor: string;
    isWide?: boolean;
    ariaLabel?: string; // Added ariaLabel
    index: number; // Added index
}

// Define cardDelays for motion.div
const cardDelays = [0, 0.1, 0.2, 0.3, 0.4, 0.5]; // Example delays, adjust as needed

function BentoCard({ title, description, href, iconName, accentColor, glowColor, ariaLabel, isWide, index }: CardProps) {
    const [isHovered, setIsHovered] = useState(false);

    const Icon = iconMap[iconName];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
                duration: 0.5,
                delay: cardDelays[index],
                ease: [0.34, 1.56, 0.64, 1],
            }}
            whileHover={{
                y: -8,
                scale: 1.02,
                transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] }
            }}
            className={isWide ? 'md:col-span-2' : ''}
        >
            <Link
                href={href}
                aria-label={ariaLabel}
                className="bento-card group relative block h-full min-h-[200px] md:min-h-[240px] p-6 md:p-8 rounded-2xl overflow-hidden transition-all duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-500"
                style={{
                    backgroundColor: 'rgba(24, 24, 27, 0.4)',
                    backdropFilter: isHovered ? 'blur(32px)' : 'blur(24px)',
                    border: `1px solid rgba(255, 255, 255, 0.05)`,
                    boxShadow: isHovered ? `0 20px 40px ${glowColor.replace('0.5', '0.3')}` : 'none',
                }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                {/* Static Glow Effect on Hover (no cursor tracking) */}
                <div
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                        background: `radial-gradient(600px circle at 50% 50%, ${accentColor}15, transparent 50%)`,
                    }}
                />

                {/* Glow Border on Hover */}
                <div
                    className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                        boxShadow: `inset 0 0 0 1px ${accentColor}60, 0 0 60px ${glowColor}`,
                    }}
                />

                {/* Content */}
                <div className="relative z-10 flex flex-col h-full">
                    <div
                        className="mb-4 transition-transform duration-300 group-hover:scale-110"
                    >
                        <Icon
                            className="w-10 h-10 md:w-12 md:h-12 transition-all duration-300"
                            style={{
                                color: accentColor,
                                filter: isHovered ? `drop-shadow(0 0 8px ${accentColor})` : 'none'
                            }}
                            aria-hidden="true"
                        />
                    </div>

                    <h2
                        className="text-xl md:text-2xl font-bold text-zinc-50 mb-2 tracking-wide transition-all duration-300"
                        style={{
                            textShadow: isHovered ? `0 0 20px ${accentColor}60` : 'none',
                        }}
                    >
                        {title}
                    </h2>

                    <p className="text-sm md:text-base text-zinc-400 leading-relaxed flex-grow">
                        {description}
                    </p>

                    {/* Arrow indicator */}
                    <div className="mt-4 flex items-center gap-2 text-zinc-500 group-hover:text-zinc-300 transition-colors duration-300">
                        <span className="text-sm">Explore</span>
                        <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">
                            →
                        </span>
                    </div>
                </div>
            </Link>
        </motion.div>
    );
}

export default function BentoGrid() {
    return (
        <ul role="list" className="bento-grid">
            {cardData.map((card, index) => (
                <li key={card.id}>
                    <BentoCard {...card} iconName={card.iconName as keyof typeof iconMap} index={index} />
                </li>
            ))}
        </ul>
    );
}
