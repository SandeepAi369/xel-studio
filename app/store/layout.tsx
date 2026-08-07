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

            {children}
        </>
    );
}
