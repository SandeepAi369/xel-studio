import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'AI Labs | XeL Studio',
    description:
        'Research and experimental AI models, custom automation systems, and AI projects by Sandeep. Projects categorized as Active, Experimental, or Archived.',
    openGraph: {
        title: 'AI Labs | XeL Studio',
        description:
            'AI research experiments, custom models, and automation systems.',
        type: 'website',
        url: 'https://xel-studio.vercel.app/ai',
        siteName: 'XeL Studio',
    },
    alternates: {
        canonical: 'https://xel-studio.vercel.app/ai',
    },
};

export default function AILabsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <div className="sr-only">
                <h1>AI Labs — XeL Studio</h1>
                <p>
                    Research and experimental AI models, custom automation systems, and AI projects by Sandeep.
                    Each project is categorized as Active, Experimental, or Archived.
                    Features search and filter capabilities with animated transitions.
                </p>
            </div>
            {children}
        </>
    );
}
