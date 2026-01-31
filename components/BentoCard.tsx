'use client';

import Link from 'next/link';
import { BookOpen, Brain, ShoppingBag, ShieldCheck } from 'lucide-react';

const cardData = [
    {
        id: 'articles',
        title: 'Articles',
        description: 'Deep dives into AI Research, LLM Architecture, and Technical Analysis',
        href: '/articles',
        iconName: 'BookOpen',
        accentColor: '#06b6d4',
        isWide: true,
    },
    {
        id: 'ai',
        title: 'AI Labs',
        description: 'Research & Experimental Models, Custom AI & Automation Systems',
        href: '/ai',
        iconName: 'Brain',
        accentColor: '#a855f7',
    },
    {
        id: 'store',
        title: 'Store',
        description: 'Premium APKs, Bots & Tools - Direct Downloads Available',
        href: '/store',
        iconName: 'ShoppingBag',
        accentColor: '#10b981',
    },
    {
        id: 'security',
        title: 'Security',
        description: 'Cyber Defense Tools, Kali Scripts & Security Protocols',
        href: '/shield',
        iconName: 'ShieldCheck',
        accentColor: '#f87171',
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
    isWide?: boolean;
}

function BentoCard({ title, description, href, iconName, accentColor, isWide }: CardProps) {
    const Icon = iconMap[iconName];

    return (
        <div className={isWide ? 'md:col-span-2' : ''}>
            <Link
                href={href}
                className="bento-card group block h-full min-h-[200px] md:min-h-[240px] p-6 md:p-8 rounded-2xl overflow-hidden bg-zinc-900/40 border border-zinc-800/50 hover:border-zinc-600/50 cursor-pointer"
            >
                <div className="flex flex-col h-full">
                    {/* Icon */}
                    <div className="mb-4">
                        <Icon
                            className="w-10 h-10 md:w-12 md:h-12"
                            style={{ color: accentColor }}
                        />
                    </div>

                    {/* Title */}
                    <h2 className="text-xl md:text-2xl font-bold text-zinc-50 mb-2 group-hover:text-white">
                        {title}
                    </h2>

                    {/* Description */}
                    <p className="text-sm md:text-base text-zinc-400 leading-relaxed flex-grow">
                        {description}
                    </p>

                    {/* Explore Link */}
                    <div className="mt-4 flex items-center gap-2 text-zinc-500 group-hover:text-zinc-300">
                        <span className="text-sm">Explore</span>
                        <span className="group-hover:translate-x-1 transition-transform">→</span>
                    </div>
                </div>
            </Link>
        </div>
    );
}

export default function BentoGrid() {
    return (
        <ul role="list" className="bento-grid">
            {cardData.map((card) => (
                <li key={card.id}>
                    <BentoCard {...card} iconName={card.iconName as keyof typeof iconMap} />
                </li>
            ))}
        </ul>
    );
}
