import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, Tag, Clock } from 'lucide-react';
import { getArticlesAsync, initializeDB, Article } from '@/lib/db';
import SmartListenButton from '@/components/SmartListenButton';
import { prepareTTSText } from '@/lib/tts-text';

// Force dynamic rendering - always fetch fresh data
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const revalidate = 0;

async function getArticle(id: string): Promise<Article | null> {
    try {
        // Initialize and read from GitHub API on Vercel
        await initializeDB();
        const articles = await getArticlesAsync();
        const article = articles.find((a) => a.id === id);
        return article || null;
    } catch (error) {
        console.error('Error reading article:', error);
        return null;
    }
}

function getReadingTime(content: string): number {
    const wordsPerMinute = 200;
    const words = content.split(/\s+/).length;
    return Math.ceil(words / wordsPerMinute);
}

function formatContent(content: string): string[] {
    return content
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

export default async function ArticlePage({
    params
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params;
    const article = await getArticle(id);

    if (!article) {
        notFound();
    }

    const readingTime = getReadingTime(article.content);
    const paragraphs = formatContent(article.content);

    return (
        <main className="min-h-screen bg-[#0a0a0a]" role="main" aria-label={article.title}>
            {/* Hero Section with Image - No complex overlays */}
            <div className="relative h-[40vh] min-h-[300px] w-full overflow-hidden bg-zinc-900">
                {article.image ? (
                    <img
                        src={article.image}
                        alt={article.title}
                        className="w-full h-full object-cover opacity-80"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-green-900/30 to-zinc-900" />
                )}

                {/* Simple gradient overlay - pointer-events: none */}
                <div
                    className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent"
                    style={{ pointerEvents: 'none' }}
                />

                {/* Back Button - Always clickable */}
                <Link
                    href="/articles"
                    className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors z-10"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                </Link>

            </div>

            {/* Article Content */}
            <div className="max-w-4xl mx-auto px-4 -mt-20 relative z-10 pb-16">
                <article className="bg-zinc-900/95 rounded-2xl border border-zinc-800 overflow-hidden">
                    {/* Article Header */}
                    <div className="p-8 md:p-10 border-b border-zinc-800">
                        {/* Meta Info */}
                        <div className="flex flex-wrap items-center gap-4 mb-6">
                            {article.category && (
                                <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                                    <Tag className="w-3.5 h-3.5" />
                                    {article.category}
                                </span>
                            )}
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Calendar className="w-4 h-4" />
                                {new Date(article.date).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Clock className="w-4 h-4" />
                                {readingTime} min read
                            </span>
                        </div>

                        {/* Title + Listen */}
                        <div className="flex items-start gap-4">
                            <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight flex-1">
                                {article.title}
                            </h1>
                            <div className="flex-shrink-0 mt-1">
                                <SmartListenButton text={prepareTTSText(article.title, article.content)} iconOnly className="w-11 h-11" />
                            </div>
                        </div>


                    </div>

                    {/* Article Body - Clean text formatting */}
                    <div className="p-8 md:p-10">
                        <div className="space-y-6">
                            {paragraphs.map((paragraph, index) => {
                                const isNumberedItem = /^\d+\./.test(paragraph);
                                const hasLink = paragraph.includes('http');

                                // Numbered list items
                                if (isNumberedItem) {
                                    return (
                                        <div
                                            key={index}
                                            className="pl-6 border-l-2 border-green-500/30 py-2"
                                        >
                                            <p className="text-gray-300 text-lg leading-8">
                                                {paragraph}
                                            </p>
                                        </div>
                                    );
                                }

                                // Paragraphs with links
                                if (hasLink) {
                                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                                    const parts = paragraph.split(urlRegex);

                                    return (
                                        <p key={index} className="text-gray-300 text-lg leading-8">
                                            {parts.map((part, i) => {
                                                if (part.match(urlRegex)) {
                                                    return (
                                                        <a
                                                            key={i}
                                                            href={part}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-green-400 underline underline-offset-4 hover:text-green-300 break-all"
                                                        >
                                                            {part}
                                                        </a>
                                                    );
                                                }
                                                return part;
                                            })}
                                        </p>
                                    );
                                }

                                // Regular paragraphs
                                return (
                                    <p
                                        key={index}
                                        className="text-gray-300 text-lg leading-8"
                                    >
                                        {paragraph}
                                    </p>
                                );
                            })}
                        </div>
                    </div>

                    {/* Article Footer */}
                    <div className="p-8 md:p-10 border-t border-zinc-800 bg-zinc-900/50">
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                            <p className="text-zinc-500 text-sm">
                                Thank you for reading this article.
                            </p>
                            <Link
                                href="/articles"
                                className="inline-flex items-center gap-2 px-6 py-3 bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl font-medium hover:bg-green-500/30 transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                More Articles
                            </Link>
                        </div>
                    </div>
                </article>
            </div>
        </main>
    );
}

export async function generateMetadata({
    params
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params;
    const article = await getArticle(id);

    if (!article) {
        return { title: 'Article Not Found' };
    }

    return {
        title: article.title,
        description: article.content.substring(0, 160),
    };
}
