import { notFound } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    Clock,
    Calendar,
    Tag,
    Bot,
    ExternalLink,
    Globe,
    FileText,
} from "lucide-react";
import SmartListenButton from "@/components/SmartListenButton";
import NewsActionButtons from "@/components/NewsActionButtons";
import { prepareTTSText } from "@/lib/tts-text";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = 'force-dynamic';

/* ─── Types ────────────────────────────────────────────────── */
interface SourceItem {
    url: string;
    title: string;
}

interface NewsItem {
    id: string;
    title: string;
    summary: string;
    image_url: string | null;
    source_urls: string[];
    sources: SourceItem[];
    source_name: string;
    date: string;
    category: string;
}

/* ─── Category Display Config ─────────────────────────────── */
const CATEGORY_DISPLAY: Record<string, { label: string; color: string; bg: string; border: string }> = {
    "ai-tech": { label: "AI & Technology", color: "text-violet-400", bg: "bg-violet-500/20", border: "border-violet-500/30" },
    "accessibility": { label: "Disability & Accessibility", color: "text-amber-400", bg: "bg-amber-500/20", border: "border-amber-500/30" },
    "disability": { label: "Disability & Accessibility", color: "text-amber-400", bg: "bg-amber-500/20", border: "border-amber-500/30" },
    "health": { label: "Health & Society", color: "text-amber-400", bg: "bg-amber-500/20", border: "border-amber-500/30" },
    "climate": { label: "Climate & Environment", color: "text-emerald-400", bg: "bg-emerald-500/20", border: "border-emerald-500/30" },
    "world": { label: "World News", color: "text-emerald-400", bg: "bg-emerald-500/20", border: "border-emerald-500/30" },
    "science": { label: "Science & Space", color: "text-blue-400", bg: "bg-blue-500/20", border: "border-blue-500/30" },
    "business": { label: "Business & Economy", color: "text-cyan-400", bg: "bg-cyan-500/20", border: "border-cyan-500/30" },
    "entertainment": { label: "Culture & Entertainment", color: "text-pink-400", bg: "bg-pink-500/20", border: "border-pink-500/30" },
    "general": { label: "General", color: "text-zinc-400", bg: "bg-zinc-500/20", border: "border-zinc-500/30" },
};

/* ─── Helpers ──────────────────────────────────────────────── */
function getReadingTime(content: string): number {
    const wordsPerMinute = 200;
    const words = content.split(/\s+/).length;
    return Math.ceil(words / wordsPerMinute);
}

function getDomain(url: string): string {
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

type ContentBlock =
    | { type: 'bullet'; text: string }
    | { type: 'paragraph'; text: string };

function formatContent(content: string): ContentBlock[] {
    const cleaned = content
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/ {3,}/g, '  ')
        .replace(/([.!?])\1{2,}/g, '$1')
        .replace(/#{1,6}\s*/g, '')
        .replace(/^[-=]{3,}$/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim();

    const lines = cleaned.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
    const blocks: ContentBlock[] = [];

    for (const line of lines) {
        if (/^[-•*]\s+/.test(line) && !/^\*\*/.test(line)) {
            blocks.push({ type: 'bullet', text: line.replace(/^[-•*]\s+/, '') });
        } else {
            blocks.push({ type: 'paragraph', text: line });
        }
    }

    return blocks;
}

function renderBoldText(text: string): React.ReactNode[] {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
    });
}

/* ─── Server Component ──────────────────────────────────────── */
export default async function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    const docSnap = await adminDb.collection("news").doc(id).get();
    
    if (!docSnap.exists) {
        return (
            <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <div className="text-center">
                    <FileText className="w-16 h-16 mx-auto mb-6 text-zinc-600" />
                    <h1 className="text-2xl font-bold text-white mb-2">Article Not Found</h1>
                    <p className="text-zinc-400 mb-6">This news article could not be found.</p>
                    <Link
                        href="/ai-news"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl font-medium hover:bg-green-500/30 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to News
                    </Link>
                </div>
            </main>
        );
    }

    const data = docSnap.data();
    const article: NewsItem = {
        id: docSnap.id,
        ...(data as Omit<NewsItem, 'id'>),
        source_urls: data?.source_urls || [],
        sources: data?.sources || [],
    };

    const readingTime = getReadingTime(article.summary);
    const paragraphs = formatContent(article.summary);
    const catConfig = CATEGORY_DISPLAY[article.category] || CATEGORY_DISPLAY.general;
    
    const richSources: SourceItem[] = article.sources?.length > 0
        ? article.sources
        : (article.source_urls || []).map(url => ({ url, title: '' }));
    const sourceCount = richSources.length;

    return (
        <main className="min-h-screen bg-[#0a0a0a]">
            {/* Hero Section */}
            <div className="relative h-[40vh] min-h-[300px] w-full overflow-hidden bg-zinc-900" aria-hidden="true">
                {article.image_url ? (
                    <img src={article.image_url} alt="" className="w-full h-full object-cover opacity-80" />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-900/30 to-zinc-900" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent" style={{ pointerEvents: 'none' }} />
                <Link href="/ai-news" className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors z-10" aria-label="Back to News">
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                </Link>
            </div>

            {/* Article Content */}
            <div className="max-w-5xl mx-auto px-3 sm:px-6 -mt-20 relative z-10 pb-16">
                <article className="bg-zinc-900/95 rounded-2xl border border-zinc-800/60 overflow-hidden shadow-xl shadow-black/20">
                    {/* Header */}
                    <header className="p-5 sm:p-8 md:p-10 border-b border-zinc-800">
                        <div className="flex flex-wrap items-center gap-4 mb-6">
                            {article.category && (
                                <span className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${catConfig.bg} ${catConfig.color} rounded-full border ${catConfig.border}`}>
                                    <Tag className="w-3.5 h-3.5" aria-hidden="true" />
                                    {catConfig.label}
                                </span>
                            )}
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Calendar className="w-4 h-4" aria-hidden="true" />
                                <time dateTime={article.date}>
                                    {new Date(article.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                                </time>
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Clock className="w-4 h-4" aria-hidden="true" />
                                <span>{readingTime} min read</span>
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Bot className="w-4 h-4" aria-hidden="true" />
                                <span>AI Generated</span>
                            </span>
                        </div>
                        <div className="flex items-start gap-4">
                            <h1 className="text-lg md:text-xl font-bold text-white leading-snug flex-1">
                                {article.title}
                            </h1>
                            <div className="flex-shrink-0 mt-1">
                                <SmartListenButton text={prepareTTSText(article.title, article.summary)} iconOnly className="w-11 h-11" />
                            </div>
                        </div>
                    </header>

                    {/* Body */}
                    <div className="px-5 sm:px-8 md:px-10 pb-5 sm:pb-8 md:pb-10 pt-4">
                        <div className="space-y-4 max-w-none">
                            {paragraphs.map((block, index) => {
                                const text = block.text;
                                const hasLink = text.includes('http');
                                let innerContent;
                                
                                if (hasLink) {
                                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                                    const parts = text.split(urlRegex);
                                    innerContent = parts.map((part, i) => {
                                        if (part.match(urlRegex)) {
                                            return (
                                                <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-green-400 underline underline-offset-4 hover:text-green-300 break-all">
                                                    {part}
                                                </a>
                                            );
                                        }
                                        return <span key={i}>{renderBoldText(part)}</span>;
                                    });
                                } else {
                                    innerContent = renderBoldText(text);
                                }
                                
                                if (block.type === 'bullet') {
                                    return (
                                        <div key={index} className="flex gap-3">
                                            <span className="text-green-400 mt-[2px] text-lg leading-[1.8] flex-shrink-0" aria-hidden="true">•</span>
                                            <p className="text-gray-300 text-[15px] leading-[1.8]">{innerContent}</p>
                                        </div>
                                    );
                                }
                                
                                return (
                                    <p key={index} className="text-gray-300 text-[15px] leading-[1.8]">
                                        {innerContent}
                                    </p>
                                );
                            })}
                        </div>

                        {/* Interactive Client Components */}
                        <NewsActionButtons title={article.title} summary={article.summary} />
                    </div>

                    {/* Footer — Sources */}
                    <footer className="px-5 sm:px-8 md:px-10 py-4 border-t border-zinc-800 bg-zinc-900/50">
                        {sourceCount > 0 ? (
                            <details className="group marker:content-['']">
                                <summary className="flex items-center justify-between cursor-pointer list-none">
                                    <div className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-white hover:bg-zinc-700/50 transition-all duration-200 group-open:bg-emerald-500/15 group-open:border-emerald-500/30 group-open:text-emerald-400">
                                        <Globe className="w-4 h-4" />
                                        <span>Sources</span>
                                        <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full bg-zinc-700 text-zinc-300 group-open:bg-emerald-500/25 group-open:text-emerald-300">
                                            {sourceCount}
                                        </span>
                                    </div>
                                    <Link href="/ai-news" className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg font-medium hover:bg-green-500/25 transition-colors">
                                        <ArrowLeft className="w-3.5 h-3.5" />
                                        More News
                                    </Link>
                                </summary>
                                <div className="mt-4 pt-4 border-t border-zinc-800/50">
                                    <ul className="space-y-2">
                                        {richSources.map((src, idx) => (
                                            <li key={idx}>
                                                <a
                                                    href={src.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="group/link flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-zinc-800/30 border border-zinc-800/50 hover:bg-zinc-800/60 hover:border-zinc-700/60 transition-all duration-200"
                                                >
                                                    <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-700/50 text-zinc-400 text-xs font-mono flex-shrink-0">
                                                        {idx + 1}
                                                    </span>
                                                    <span className="flex flex-col min-w-0 flex-1">
                                                        {src.title ? (
                                                            <>
                                                                <span className="text-sm text-zinc-200 group-hover/link:text-white transition-colors truncate leading-snug">
                                                                    {src.title}
                                                                </span>
                                                                <span className="text-xs text-zinc-500 truncate mt-0.5">
                                                                    {getDomain(src.url)}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <span className="text-sm text-zinc-300 group-hover/link:text-white transition-colors truncate">
                                                                {getDomain(src.url)}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover/link:text-zinc-400 flex-shrink-0 transition-colors" />
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </details>
                        ) : (
                            <div className="flex items-center justify-between">
                                <p className="text-zinc-500 text-xs">XeL AI News</p>
                                <Link href="/ai-news" className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg font-medium hover:bg-green-500/25 transition-colors">
                                    <ArrowLeft className="w-3.5 h-3.5" />
                                    More News
                                </Link>
                            </div>
                        )}
                    </footer>
                </article>
            </div>
        </main>
    );
}
