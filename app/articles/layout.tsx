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
            {children}
        </>
    );
}
