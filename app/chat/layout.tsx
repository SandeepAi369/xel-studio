import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'AI Chat | XeL Studio',
    description:
        'Chat with an AI assistant powered by Google Gemini 2.5 Flash and 3 Flash. Real-time streaming responses with markdown rendering, code highlighting, and persistent chat history.',
    openGraph: {
        title: 'AI Chat | XeL Studio',
        description:
            'Interactive AI chat assistant powered by Google Gemini with streaming responses and model selection.',
        type: 'website',
        url: 'https://xel-studio.vercel.app/chat',
        siteName: 'XeL Studio',
    },
    alternates: {
        canonical: 'https://xel-studio.vercel.app/chat',
    },
};

export default function ChatLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <div className="sr-only">
                <h1>AI Chat — XeL Studio</h1>
                <p>
                    Interactive AI chat assistant powered by Google Gemini. Choose between Gemini 2.5 Flash
                    and Gemini 3 Flash models. Features include real-time streaming responses, markdown rendering,
                    code syntax highlighting with GFM table support, and persistent chat history saved locally.
                </p>
            </div>
            {children}
        </>
    );
}
