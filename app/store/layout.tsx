import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Store | XeL Studio',
    description:
        'Digital store featuring premium APKs, bots, and developer tools. Direct downloads with progress tracking and ghost download technology.',
    openGraph: {
        title: 'Store | XeL Studio',
        description: 'Premium APKs, bots, and tools — direct downloads available.',
        type: 'website',
        url: 'https://xel-studio.vercel.app/store',
        siteName: 'XeL Studio',
    },
    alternates: {
        canonical: 'https://xel-studio.vercel.app/store',
    },
};

export default function StoreLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <div className="sr-only">
                <h1>Digital Store — XeL Studio</h1>
                <p>
                    Premium APKs, bots, and developer tools available for direct download.
                    Features seamless ghost download technology with animated progress tracking.
                    All downloads are managed through the XeL Studio admin panel and stored in Supabase.
                </p>
            </div>
            {children}
        </>
    );
}
