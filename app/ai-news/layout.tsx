import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'AI Tech News | XeL Studio',
    description:
        'Latest AI and technology news, auto-generated using Cerebras GPT and Tavily AI search. Categories: AI & Tech, Open Source, Disability & Accessibility, Climate, World Affairs, Health.',
    openGraph: {
        title: 'AI Tech News | XeL Studio',
        description:
            'Automated AI-powered news feed updated multiple times daily. Covering AI breakthroughs, open source, accessibility tech, climate, and world affairs.',
        type: 'website',
        url: 'https://xel-studio.vercel.app/ai-news',
        siteName: 'XeL Studio',
    },
    alternates: {
        canonical: 'https://xel-studio.vercel.app/ai-news',
        types: {
            'application/rss+xml': 'https://xel-studio.vercel.app/api/rss',
        },
    },
};

export default function AINewsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            {children}
        </>
    );
}
