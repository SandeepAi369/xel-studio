import { BookOpen, Brain, ShoppingBag, ShieldCheck, LucideIcon } from 'lucide-react';

export interface CardData {
    id: string;
    title: string;
    description: string;
    href: string;
    icon: LucideIcon;
    accentColor: string;
    glowColor: string;
    ariaLabel: string;
    isWide?: boolean;
}

export const cards: CardData[] = [
    {
        id: 'articles',
        title: 'ARTICLES',
        description: 'Deep dives into AI Research, LLM Architecture, and Technical Analysis',
        href: '/articles',
        icon: BookOpen,
        accentColor: '#06b6d4',
        glowColor: 'rgba(6, 182, 212, 0.5)',
        ariaLabel: 'Navigate to Articles section - AI Research and Technical Analysis',
        isWide: true,
    },
    {
        id: 'ai',
        title: 'AI',
        description: 'Traffic Police Agents, Custom Models & Automation Systems',
        href: '/ai',
        icon: Brain,
        accentColor: '#a855f7',
        glowColor: 'rgba(168, 85, 247, 0.5)',
        ariaLabel: 'Navigate to AI Lab - Custom Models and Intelligent Agents',
    },
    {
        id: 'store',
        title: 'STORE',
        description: 'Premium APKs, Bots & Tools - Direct Downloads Available',
        href: '/store',
        icon: ShoppingBag,
        accentColor: '#10b981',
        glowColor: 'rgba(16, 185, 129, 0.5)',
        ariaLabel: 'Navigate to Store - Download Premium Tools and Applications',
    },
    {
        id: 'shield',
        title: 'SHIELD',
        description: 'Cyber Defense Tools, Kali Scripts & Security Protocols',
        href: '/shield',
        icon: ShieldCheck,
        accentColor: '#ef4444',
        glowColor: 'rgba(239, 68, 68, 0.5)',
        ariaLabel: 'Navigate to Shield - Cyber Security Tools and Defense Protocols',
    },
];
