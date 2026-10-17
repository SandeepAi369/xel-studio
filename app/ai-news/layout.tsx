import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'AI Tech News — XeL Studio',
    description:
        'Latest AI and technology news. Categories: AI & Tech, Open Source, Disability & Accessibility, Climate, World Affairs, Health.',
    openGraph: {
        title: 'AI Tech News | XeL Studio',
        description:
            'Latest AI and technology news. Updated daily.',
        type: 'website',
        url: 'https://xel-studio.vercel.app/ai-news',
        siteName: 'XeL Studio',
    },
    alternates: {
        canonical: 'https://xel-studio.vercel.app/ai-news',
    },
    // News is aggregated content: keep it out of search engines and AI
    // indexes. (Also enforced by the X-Robots-Tag header, robots.txt and
    // the bot block in proxy.ts.)
    robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: { index: false, follow: false, noimageindex: true, 'max-snippet': 0, 'max-image-preview': 'none' },
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
