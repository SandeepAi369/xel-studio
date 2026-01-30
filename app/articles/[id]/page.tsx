import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, Tag, Clock } from 'lucide-react';
import fs from 'fs';
import path from 'path';

interface Article {
    id: string;
    title: string;
    image: string;
    content: string;
    date: string;
    category?: string;
}

interface DataFile {
    articles: Article[];
}

async function getArticle(id: string): Promise<Article | null> {
    try {
        const dataPath = path.join(process.cwd(), 'data', 'data.json');
        const fileContents = fs.readFileSync(dataPath, 'utf8');
        const data: DataFile = JSON.parse(fileContents);
        
        const article = data.articles.find((a) => a.id === id);
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
    const paragraphs = content
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
    
    return paragraphs;
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
        <main className="min-h-screen bg-[#0a0a0a]">
            {/* Hero Section with Image */}
            <div className="relative h-[50vh] min-h-[400px] w-full overflow-hidden">
                {article.image ? (
                    <img
                        src={article.image}
                        alt={article.title}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-green-900/30 to-zinc-900" />
                )}
                
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/60 to-transparent" />
                
                {/* Back Button */}
                <Link
                    href="/articles"
                    className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 bg-black/50 backdrop-blur-md rounded-full text-white hover:bg-black/70 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Articles</span>
                </Link>
            </div>

            {/* Article Content - Glass Container */}
            <div className="max-w-4xl mx-auto px-4 -mt-32 relative z-10 pb-16">
                <article className="bg-black/80 backdrop-blur-md rounded-2xl border border-zinc-800/50 overflow-hidden shadow-2xl">
                    {/* Article Header */}
                    <div className="p-8 md:p-12 border-b border-zinc-800/50">
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

                        {/* Title */}
                        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight">
                            {article.title}
                        </h1>
                    </div>

                    {/* Article Body - AI-Style Formatting */}
                    <div className="p-8 md:p-12">
                        <div className="space-y-6">
                            {paragraphs.map((paragraph, index) => {
                                const isNumberedItem = /^\d+\./.test(paragraph);
                                const hasLink = paragraph.includes('http');
                                
                                if (isNumberedItem) {
                                    return (
                                        <div 
                                            key={index}
                                            className="pl-6 border-l-2 border-green-500/30 py-2"
                                        >
                                            <p className="text-gray-300 text-lg leading-7 whitespace-pre-line">
                                                {paragraph}
                                            </p>
                                        </div>
                                    );
                                }
                                
                                if (hasLink) {
                                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                                    const parts = paragraph.split(urlRegex);
                                    
                                    return (
                                        <p key={index} className="text-gray-300 text-lg leading-7 whitespace-pre-line">
                                            {parts.map((part, i) => {
                                                if (part.match(urlRegex)) {
                                                    return (
                                                        <a
                                                            key={i}
                                                            href={part}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-green-400 hover:text-green-300 underline underline-offset-4 break-all"
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
                                
                                return (
                                    <p 
                                        key={index}
                                        className="text-gray-300 text-lg leading-7 whitespace-pre-line"
                                    >
                                        {paragraph}
                                    </p>
                                );
                            })}
                        </div>
                    </div>

                    {/* Article Footer */}
                    <div className="p-8 md:p-12 border-t border-zinc-800/50 bg-zinc-900/30">
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
        return {
            title: 'Article Not Found',
        };
    }

    return {
        title: article.title,
        description: article.content.substring(0, 160),
    };
}
