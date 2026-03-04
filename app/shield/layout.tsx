import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Security Tools | XeL Studio',
    description:
        'Curated cyber security tools and resources. Categories: Encryption, Forensics, Penetration Testing, Authentication. Part of the Shield security section.',
    openGraph: {
        title: 'Security Tools | XeL Studio',
        description:
            'Cyber defense tools, Kali scripts, and security protocols — curated by Sandeep.',
        type: 'website',
        url: 'https://xel-studio.vercel.app/shield',
        siteName: 'XeL Studio',
    },
    alternates: {
        canonical: 'https://xel-studio.vercel.app/shield',
    },
};

export default function ShieldLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <div className="sr-only">
                <h1>Security Tools — XeL Studio Shield</h1>
                <p>
                    Curated collection of cyber security tools and resources. Categories include Encryption,
                    Forensics, Penetration Testing, and Authentication tools. Features search and filtering
                    with animated transitions. Tools are managed through the XeL Studio admin panel.
                </p>
            </div>
            {children}
        </>
    );
}
