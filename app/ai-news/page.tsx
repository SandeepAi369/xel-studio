"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Newspaper,
  Bot,
  Sparkles,
  Globe,
  Zap,
  ChevronRight,
} from "lucide-react";

import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";

/* ─── Types ────────────────────────────────────────────────── */
interface NewsItem {
  id: string;
  title: string;
  summary: string;
  image_url: string | null;
  source_link: string;
  source_name: string;
  date: string;
  category: "ai" | "tech" | "world";
}

type FilterTab = "all" | "ai" | "tech" | "world";

/* ─── Category Config ─────────────────────────────────────── */
const CATEGORY_CONFIG = {
  ai: {
    icon: Sparkles,
    label: "AI",
    color: "text-violet-300",
    bg: "bg-violet-500/20",
    cardBg: "bg-violet-950/15",
    cardBorder: "border-violet-800/30",
    cardHoverBorder: "hover:border-violet-600/50",
    cardHoverBg: "hover:bg-violet-950/25",
    titleHover: "group-hover:text-violet-200",
    sourceColor: "text-violet-400/70",
    activeBg: "bg-violet-500/20",
    activeText: "text-violet-300",
    activeBorder: "border-violet-500/30",
    hoverText: "hover:text-violet-300",
    hoverBg: "hover:bg-violet-500/10",
  },
  tech: {
    icon: Zap,
    label: "Tech",
    color: "text-sky-300",
    bg: "bg-sky-500/15",
    cardBg: "bg-sky-950/10",
    cardBorder: "border-sky-800/30",
    cardHoverBorder: "hover:border-sky-600/50",
    cardHoverBg: "hover:bg-sky-950/20",
    titleHover: "group-hover:text-sky-200",
    sourceColor: "text-sky-400/70",
    activeBg: "bg-sky-500/20",
    activeText: "text-sky-300",
    activeBorder: "border-sky-500/30",
    hoverText: "hover:text-sky-300",
    hoverBg: "hover:bg-sky-500/10",
  },
  world: {
    icon: Globe,
    label: "World",
    color: "text-emerald-300",
    bg: "bg-emerald-500/15",
    cardBg: "bg-zinc-900/40",
    cardBorder: "border-zinc-800/50",
    cardHoverBorder: "hover:border-emerald-600/40",
    cardHoverBg: "hover:bg-zinc-900/60",
    titleHover: "group-hover:text-emerald-200",
    sourceColor: "text-emerald-400/70",
    activeBg: "bg-emerald-500/20",
    activeText: "text-emerald-300",
    activeBorder: "border-emerald-500/30",
    hoverText: "hover:text-emerald-300",
    hoverBg: "hover:bg-emerald-500/10",
  },
};

const PREVIEW_WORD_LIMIT = 30;

/* ─── Helpers ──────────────────────────────────────────────── */
function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ─── NewsCard — with hero thumbnail image ─────────────── */
function NewsCard({ item }: { item: NewsItem }) {
  const config = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.world;
  const Icon = config.icon;
  const [imgError, setImgError] = useState(false);
  const hasImage = !!item.image_url && !imgError;

  const words = item.summary.split(/\s+/);
  const previewText =
    words.length > PREVIEW_WORD_LIMIT
      ? words.slice(0, PREVIEW_WORD_LIMIT).join(" ") + "..."
      : item.summary;

  return (
    <Link
      href={`/ai-news/${item.id}`}
      onClick={() => sessionStorage.setItem('ai-news-scroll', String(window.scrollY))}
      className="block rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:border-green-500/40 hover:bg-zinc-900/80 transition-all duration-200 group cursor-pointer overflow-hidden"
    >
      {/* Hero Image */}
      {hasImage && (
        <div className="relative w-full aspect-[16/9] bg-zinc-800 overflow-hidden">
          <img
            src={item.image_url!}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
          {/* Gradient overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          {/* Category badge on image */}
          <div className="absolute top-3 left-3">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full backdrop-blur-sm ${config.bg} ${config.color} border border-white/10`}
            >
              <Icon className="w-2.5 h-2.5" />
              {config.label}
            </span>
          </div>
        </div>
      )}

      <div className="p-5">
        {/* Category Badge (only when no image) */}
        {!hasImage && (
          <div className="flex items-start gap-3 mb-2">
            <div className="flex-1 min-w-0">
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-2 ${config.bg} ${config.color}`}
              >
                <Icon className="w-2.5 h-2.5" />
                {config.label}
              </span>
            </div>
          </div>
        )}

        {/* Title */}
        <h3 className="text-lg font-semibold transition-colors line-clamp-2 text-white group-hover:text-green-100 mb-2">
          {item.title}
        </h3>

        {/* Preview text */}
        <p className="text-base text-gray-400 leading-relaxed mb-4">
          {previewText}
        </p>

        {/* Meta + Read more */}
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className={`font-medium ${config.sourceColor}`}>
            {item.source_name}
          </span>
          <time dateTime={item.date} className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeAgo(item.date)}
          </time>
          <span className="ml-auto flex items-center gap-1 text-green-400 text-sm font-medium group-hover:text-green-300 transition-colors">
            Read more
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ─── Main Page — NO framer-motion animations ────────────── */
export default function AINewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");

  // Real-time Firestore listener — news auto-updates without page refresh
  useEffect(() => {
    const q = query(
      collection(db, "news"),
      orderBy("date", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: NewsItem[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as NewsItem[];
        setNews(items);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError("Could not load news. Please try again later.");
        console.error("News listener error:", err);
        setLoading(false);
      }
    );

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, []);

  // Scroll position restoration
  useEffect(() => {
    const savedPos = sessionStorage.getItem('ai-news-scroll');
    if (savedPos && !loading) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedPos, 10));
        sessionStorage.removeItem('ai-news-scroll');
      });
    }
  }, [loading]);

  // Sort: latest news first (by date, newest at top)
  const sortedAndFilteredNews = useMemo(() => {
    let filtered = news;
    if (filter !== "all") {
      filtered = news.filter((n) => n.category === filter);
    }
    return [...filtered].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [news, filter]);

  // Counts per category
  const counts = useMemo(() => {
    const c = { ai: 0, tech: 0, world: 0 };
    news.forEach((n) => {
      if (n.category in c) c[n.category as keyof typeof c]++;
    });
    return c;
  }, [news]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium text-zinc-300">
              Live News Feed
            </span>
          </div>
          <div className="w-[52px]" />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-1">
            Daily News Feed
          </h1>
          <p className="text-sm text-zinc-500 mb-6">
            AI-first coverage with text-to-speech · AI, Technology, World News &
            Geopolitics
          </p>

          {/* Category Filter Tabs */}
          {!loading && news.length > 0 && (
            <nav className="flex items-center gap-2 mb-8 flex-wrap">
              {/* All Tab */}
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filter === "all"
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
              >
                All ({news.length})
              </button>

              {/* Category Tabs */}
              {(["ai", "tech", "world"] as const).map((cat) => {
                const config = CATEGORY_CONFIG[cat];
                const Icon = config.icon;
                const count = counts[cat];
                return (
                  <button
                    key={cat}
                    onClick={() => setFilter(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${filter === cat
                      ? `${config.activeBg} ${config.activeText} border ${config.activeBorder}`
                      : `bg-zinc-900/60 text-zinc-400 ${config.hoverText} ${config.hoverBg}`
                      }`}
                  >
                    <Icon className="w-3 h-3" />
                    {config.label} ({count})
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="rounded-xl bg-zinc-900/40 border border-zinc-800/50 p-5 animate-pulse"
              >
                <div className="h-4 bg-zinc-800 rounded w-3/4 mb-3" />
                <div className="h-3 bg-zinc-800/60 rounded w-full mb-2" />
                <div className="h-3 bg-zinc-800/60 rounded w-5/6" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-16">
            <p className="text-zinc-400">{error}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && sortedAndFilteredNews.length === 0 && (
          <div className="text-center py-16">
            <Newspaper className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">
              {filter !== "all"
                ? `No ${CATEGORY_CONFIG[filter]?.label || filter} news available.`
                : "No news available yet. Feed will populate automatically."}
            </p>
          </div>
        )}

        {/* News List */}
        {!loading && !error && sortedAndFilteredNews.length > 0 && (
          <section id="news-list" className="space-y-4">
            {sortedAndFilteredNews.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </section>
        )}

        {/* Footer */}
        {!loading && news.length > 0 && (
          <p className="text-center text-xs text-zinc-600 mt-8">
            Showing {sortedAndFilteredNews.length} of {news.length} articles ·
            AI-first · Live from Firebase
          </p>
        )}
      </main>
    </div>
  );
}
