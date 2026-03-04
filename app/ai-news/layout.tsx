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
            {/* SSR-visible content for crawlers and AI bots */}
            <div className="sr-only">
                <h1>AI Tech News — XeL Studio</h1>
                <p>
                    Automated artificial intelligence and technology news feed. Articles are generated using
                    Cerebras GPT-OSS 120B from real-time web search results via Tavily AI Search API.
                    Each article includes an AI-generated image created using the FLUX model.
                    The feed is updated multiple times daily via automated GitHub Actions pipelines.
                </p>
                <p>
                    News categories include: AI and Technology, Open Source Software, Disability and Accessibility,
                    Climate and Environment, World Affairs, Health, and General news.
                </p>
                <p>
                    Features include: full-screen snap-scroll reading on mobile, YouTube-style card layout on desktop,
                    text-to-speech article listening, category filtering, and scroll position memory.
                </p>
                <nav aria-label="News navigation">
                    <a href="/ai-news">All News</a>
                    <a href="/articles">Articles</a>
                    <a href="/chat">AI Chat</a>
                    <a href="/">Home</a>
                </nav>
            </div>
            {children}
        </>
    );
}
