import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Articles | XeL Studio',
    description:
        'Research articles on AI, machine learning, LLM architecture, and technical analysis. Each article features text-to-speech listening powered by Microsoft Edge TTS.',
    openGraph: {
        title: 'Articles | XeL Studio',
        description:
            'Deep dives into AI research, LLM architecture, and technical analysis by Sandeep.',
        type: 'website',
        url: 'https://xel-studio.vercel.app/articles',
        siteName: 'XeL Studio',
    },
    alternates: {
        canonical: 'https://xel-studio.vercel.app/articles',
    },
};

export default function ArticlesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <div className="sr-only">
                <h1>Articles — XeL Studio</h1>
                <p>
                    Research articles covering artificial intelligence, machine learning, large language model architecture,
                    and technical analysis. Written by Sandeep and published on XeL Studio.
                    Every article supports text-to-speech listening powered by Microsoft Edge TTS with the en-US-AvaNeural voice.
                    Articles are stored in Supabase and managed through the admin panel.
                </p>
                <nav aria-label="Articles navigation">
                    <a href="/articles">All Articles</a>
                    <a href="/ai-news">AI News</a>
                    <a href="/chat">AI Chat</a>
                    <a href="/">Home</a>
                </nav>
            </div>
            {children}
        </>
    );
}
