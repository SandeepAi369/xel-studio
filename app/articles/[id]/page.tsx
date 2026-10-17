import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, Tag, Clock } from 'lucide-react';
import { getArticleById, Article, getArticles } from '@/lib/supabase-db';
import { getSupabaseAdmin } from '@/lib/supabase';
import SmartListenButton from '@/components/SmartListenButton';
import { prepareTTSText } from '@/lib/tts-text';
import { markdownToSafeHtml } from '@/lib/markdown-server';
import { markdownToPlainText, excerpt, articleDate } from '@/lib/article-feed';
import { cache } from 'react';
import type { Metadata } from 'next';

// Static ISR. generateStaticParams makes every article a cached static
// HTML page (without it the route rendered on every request). There is no
// loading.tsx on purpose: a Suspense skeleton streamed the article inside a
// hidden <div> swapped in by JS, so non-JS readers and AI scrapers saw only
// the title, and missing articles returned HTTP 200 instead of 404.
export const dynamicParams = true;
export const revalidate = 60;

export async function generateStaticParams(): Promise<{ id: string }[]> {
    try {
        const { data, error } = await getSupabaseAdmin().from('articles').select('id');
        if (error) throw error;
        return (data || []).map((a) => ({ id: a.id as string }));
    } catch (e) {
        // Never fail the build: pages still render on demand.
        console.warn('generateStaticParams(articles) failed:', e);
        return [];
    }
}

// cache() dedupes the fetch between generateMetadata and the page render
const getArticle = cache(async (id: string): Promise<Article | null> => {
    try {
        return await getArticleById(id);
    } catch (error) {
        console.error('Error reading article:', error);
        return null;
    }
});

function getReadingTime(content: string): number {
    const wordsPerMinute = 200;
    const words = content.split(/\s+/).length;
    return Math.ceil(words / wordsPerMinute);
}

function getWordCount(content: string): number {
    return content.trim().split(/\s+/).filter(Boolean).length;
}

// Robust date formatter for long format
function formatArticleDateLong(dateStr: string | undefined | null, createdAt?: string | undefined | null): string {
    const raw = dateStr || createdAt;
    if (!raw) return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
        return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function ArticlePage({
    params
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params;
    const article = await getArticle(id);

    if (!article) {
        // Self-Healing URL Logic
        const allArticles = await getArticles();
        
        // Normalize the hallucinated ID into a searchable slug
        const searchSlug = decodeURIComponent(id).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        
        // Exact title match only. Partial matching sent short or junk ids
        // to unrelated articles; anything else is a real 404.
        const match = searchSlug ? allArticles.find(a => {
            if (!a.title) return false;
            const titleSlug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            return titleSlug === searchSlug;
        }) : undefined;

        if (match) {
            // 308 Permanent Redirect to the canonical ID-based URL
            permanentRedirect(`/articles/${match.id}`);
        }

        notFound();
    }

    const readingTime = getReadingTime(article.content);
    const wordCount = getWordCount(article.content);
    const articleHtml = markdownToSafeHtml(article.content);

    const canonicalUrl = `https://xel-studio.vercel.app/articles/${article.id}`;
    const dateIso = articleDate(article).toISOString();
    const plainText = markdownToPlainText(article.content);
    const author = { "@type": "Person", "name": "Sandeep", "url": "https://github.com/SandeepAi369" };
    const jsonLd = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "name": "XeL Studio",
                "url": "https://xel-studio.vercel.app",
                "inLanguage": "en",
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://xel-studio.vercel.app" },
                    { "@type": "ListItem", "position": 2, "name": "Articles", "item": "https://xel-studio.vercel.app/articles" },
                    { "@type": "ListItem", "position": 3, "name": article.title, "item": canonicalUrl },
                ],
            },
            {
                "@type": "BlogPosting",
                "headline": article.title,
                "description": excerpt(plainText, 160),
                "author": author,
                "publisher": {
                    "@type": "Organization",
                    "name": "XeL Studio",
                    "logo": { "@type": "ImageObject", "url": "https://xel-studio.vercel.app/favicon.ico" },
                },
                "datePublished": dateIso,
                "dateModified": dateIso,
                "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl },
                "url": canonicalUrl,
                "image": article.image ? [article.image] : [],
                "keywords": article.category || undefined,
                "wordCount": wordCount,
                "timeRequired": `PT${readingTime}M`,
                "inLanguage": "en",
                "isAccessibleForFree": true,
                "articleBody": plainText,
            },
        ],
    };

    return (
        <main
            id="main-content"
            tabIndex={-1}
            className="min-h-screen bg-[#0a0a0a]"
            aria-labelledby="article-title"
        >
            <script
                type="application/ld+json"
                // Escape "<" so article text can never close the script tag
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
            />
            {/* Breadcrumb nav (a11y + microdata) */}
            <nav aria-label="Breadcrumb" className="sr-only">
                <ol>
                    <li><a href="/">Home</a></li>
                    <li><a href="/articles">Articles</a></li>
                    <li aria-current="page">{article.title}</li>
                </ol>
            </nav>
            {/* Hero Section with Image */}
            <div className="relative h-[40vh] min-h-[300px] w-full overflow-hidden bg-zinc-900">
                {article.image ? (
                    <figure className="w-full h-full m-0">
                        <img
                            src={article.image}
                            alt={article.title}
                            itemProp="image"
                            className="w-full h-full object-cover opacity-80"
                        />
                    </figure>
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-green-900/30 to-zinc-900" aria-hidden="true" />
                )}
                <div
                    className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent"
                    style={{ pointerEvents: 'none' }}
                    aria-hidden="true"
                />
                <Link
                    href="/articles"
                    className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors z-10"
                    aria-label="Back to Articles"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                </Link>
            </div>

            {/* Article Content */}
            <div className="max-w-5xl mx-auto px-3 sm:px-6 -mt-20 relative z-10 pb-16">
                <article
                    className="bg-zinc-900/95 rounded-2xl border border-zinc-800/60 overflow-hidden shadow-xl shadow-black/20"
                    itemScope
                    itemType="https://schema.org/BlogPosting"
                >
                    <link itemProp="mainEntityOfPage" href={canonicalUrl} />
                    <header className="p-5 sm:p-8 md:p-10 border-b border-zinc-800">
                        <div className="flex flex-wrap items-center gap-4 mb-6">
                            {article.category && (
                                <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                                    <Tag className="w-3.5 h-3.5" aria-hidden="true" />
                                    {article.category}
                                </span>
                            )}
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Calendar className="w-4 h-4" aria-hidden="true" />
                                <time dateTime={dateIso} itemProp="datePublished">
                                    {formatArticleDateLong(article.date, article.created_at)}
                                </time>
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-500 text-sm">
                                <Clock className="w-4 h-4" aria-hidden="true" />
                                <span>{readingTime} min read</span>
                            </span>
                            <span className="text-zinc-500 text-sm" itemProp="author" itemScope itemType="https://schema.org/Person">
                                By{' '}
                                <a href="https://github.com/SandeepAi369" rel="author" itemProp="url" className="text-zinc-400 hover:text-green-400">
                                    <span itemProp="name">Sandeep</span>
                                </a>
                            </span>
                        </div>

                        <div className="flex items-start gap-4">
                            <h1
                                id="article-title"
                                itemProp="headline"
                                className="text-2xl md:text-3xl font-bold text-white leading-snug flex-1"
                            >
                                {article.title}
                            </h1>
                            <div className="flex-shrink-0 mt-1">
                                <SmartListenButton
                                    text={prepareTTSText(article.title, article.content)}
                                    iconOnly
                                    className="w-11 h-11"
                                />
                            </div>
                        </div>
                    </header>

                    <div className="p-5 sm:p-8 md:p-10">
                        {/* Markdown-rendered HTML preserves headings, lists,
                            quotes, and code blocks so screen readers get a
                            real document outline (Phase 3 a11y win). */}
                        <div
                            itemProp="articleBody"
                            className="prose prose-invert max-w-none text-gray-300 text-[15px] leading-[1.8] [&_a]:text-green-400 [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-green-300 [&_h2]:text-white [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-white [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_blockquote]:border-l-2 [&_blockquote]:border-green-500/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-zinc-800 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_.numbered-item]:pl-6 [&_.numbered-item]:border-l-2 [&_.numbered-item]:border-green-500/30 [&_.numbered-item]:py-2"
                            dangerouslySetInnerHTML={{ __html: articleHtml }}
                        />
                    </div>

                    <footer className="p-8 md:p-10 border-t border-zinc-800 bg-zinc-900/50">
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
                    </footer>
                </article>
            </div>
        </main>
    );
}

export async function generateMetadata({
    params
}: {
    params: Promise<{ id: string }>
}): Promise<Metadata> {
    const { id } = await params;
    const article = await getArticle(id);

    if (!article) {
        return { title: 'Article Not Found' };
    }

    const url = `https://xel-studio.vercel.app/articles/${article.id}`;
    const description = excerpt(markdownToPlainText(article.content), 160);
    const images = article.image ? [{ url: article.image, alt: article.title }] : undefined;

    // Per-article share card. Without this, every article inherited the
    // /articles listing card ("Articles | XeL Studio", url /articles).
    return {
        title: article.title,
        description,
        alternates: {
            canonical: url,
            types: {
                // Clean machine-readable copies of this article for AI agents
                'text/markdown': [{ url: `${url}.md`, title: `${article.title} (Markdown)` }],
                'application/feed+json': [{ url: `${url}/feed.json`, title: `${article.title} (JSON Feed)` }],
                'application/rss+xml': [{ url: 'https://xel-studio.vercel.app/articles/feed.xml', title: 'XeL Studio Articles (RSS)' }],
                'application/atom+xml': [{ url: 'https://xel-studio.vercel.app/articles/atom.xml', title: 'XeL Studio Articles (Atom)' }],
            },
        },
        openGraph: {
            type: 'article',
            url,
            siteName: 'XeL Studio',
            title: article.title,
            description,
            publishedTime: articleDate(article).toISOString(),
            authors: ['Sandeep'],
            section: article.category || undefined,
            images,
        },
        twitter: {
            card: article.image ? 'summary_large_image' : 'summary',
            title: article.title,
            description,
            images: article.image ? [article.image] : undefined,
        },
    };
}
