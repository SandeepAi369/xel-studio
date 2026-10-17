import type { Metadata } from 'next';

export const metadata: Metadata = {
    // Root layout template appends " | XeL Studio"
    title: 'Articles',
    description:
        'Research articles on AI, machine learning, LLM architecture, and technical analysis. Each article features text-to-speech listening.',
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
        types: {
            'application/rss+xml': [{ url: 'https://xel-studio.vercel.app/articles/feed.xml', title: 'XeL Studio Articles (RSS)' }],
            'application/atom+xml': [{ url: 'https://xel-studio.vercel.app/articles/atom.xml', title: 'XeL Studio Articles (Atom)' }],
        },
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
