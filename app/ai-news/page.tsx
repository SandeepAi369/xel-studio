"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Clock,
  Newspaper,
  Bot,
  Cpu,
  Sparkles,
  Globe,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import SmartListenButton from "@/components/SmartListenButton";
import { prepareTTSText } from "@/lib/tts-text";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, getDocs } from "firebase/firestore";

/* ─── Types ────────────────────────────────────────────────── */
interface NewsItem {
  id: string;
  title: string;
  summary: string;
  image_url: string | null;
  source_link: string;
  source_name: string;
  date: string;
  category: "ai" | "technology" | "general";
}

type FilterTab = "all" | "ai" | "technology" | "general";

/* ─── Category Config ─────────────────────────────────────── */
const CATEGORY_CONFIG = {
  ai: {
    icon: Sparkles,
    label: "AI",
    color: "text-purple-300",
    bg: "bg-purple-500/20",
    cardBg: "bg-purple-950/20",
    cardBorder: "border-purple-800/30",
    cardHoverBorder: "hover:border-purple-600/50",
    cardHoverBg: "hover:bg-purple-950/30",
    titleHover: "group-hover:text-purple-200",
    sourceColor: "text-purple-400/70",
    activeBg: "bg-purple-500/20",
    activeText: "text-purple-300",
    activeBorder: "border-purple-500/30",
    hoverText: "hover:text-purple-300",
    hoverBg: "hover:bg-purple-500/10",
  },
  technology: {
    icon: Cpu,
    label: "Technology",
    color: "text-cyan-300",
    bg: "bg-cyan-500/15",
    cardBg: "bg-cyan-950/10",
    cardBorder: "border-cyan-800/30",
    cardHoverBorder: "hover:border-cyan-600/50",
    cardHoverBg: "hover:bg-cyan-950/20",
    titleHover: "group-hover:text-cyan-200",
    sourceColor: "text-cyan-400/70",
    activeBg: "bg-cyan-500/20",
    activeText: "text-cyan-300",
    activeBorder: "border-cyan-500/30",
    hoverText: "hover:text-cyan-300",
    hoverBg: "hover:bg-cyan-500/10",
  },
  general: {
    icon: Globe,
    label: "General",
    color: "text-amber-300",
    bg: "bg-amber-500/15",
    cardBg: "bg-zinc-900/40",
    cardBorder: "border-zinc-800/50",
    cardHoverBorder: "hover:border-amber-600/40",
    cardHoverBg: "hover:bg-zinc-900/60",
    titleHover: "group-hover:text-amber-200",
    sourceColor: "text-amber-400/70",
    activeBg: "bg-amber-500/20",
    activeText: "text-amber-300",
    activeBorder: "border-amber-500/30",
    hoverText: "hover:text-amber-300",
    hoverBg: "hover:bg-amber-500/10",
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

/* ─── NewsCard — NO framer-motion, pure CSS ──────────────── */
function NewsCard({ item }: { item: NewsItem }) {
  const [expanded, setExpanded] = useState(false);
  const config = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.general;
  const Icon = config.icon;

  const words = item.summary.split(/\s+/);
  const needsTruncation = words.length > PREVIEW_WORD_LIMIT;
  const previewText = needsTruncation
    ? words.slice(0, PREVIEW_WORD_LIMIT).join(" ") + "..."
    : item.summary;

  const handlePlay = useCallback(() => {
    if (!expanded && needsTruncation) setExpanded(true);
  }, [expanded, needsTruncation]);

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded((prev) => !prev);
  }, []);

  return (
    <article
      className={`rounded-xl border transition-all duration-200 p-5 group ${config.cardBg} ${config.cardBorder} ${config.cardHoverBorder} ${config.cardHoverBg}`}
    >
      <div className="flex gap-4">
        {/* Image */}
        {item.image_url && (
          <div className="hidden sm:block shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-zinc-800">
            <img
              src={item.image_url}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Category Badge + Title + Listen */}
          <div className="flex items-start gap-3 mb-1.5">
            <div className="flex-1 min-w-0">
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded mb-1.5 ${config.bg} ${config.color}`}
              >
                <Icon className="w-2.5 h-2.5" />
                {config.label}
              </span>
              <h3
                className={`text-base font-semibold transition-colors line-clamp-2 text-zinc-100 ${config.titleHover}`}
              >
                {item.title}
              </h3>
            </div>
            <div
              className="flex-shrink-0 mt-0.5"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <SmartListenButton
                text={prepareTTSText(item.title, item.summary)}
                iconOnly
                className="w-9 h-9"
                onPlay={handlePlay}
              />
            </div>
          </div>

          {/* Summary — 40 words preview, expandable */}
          <div className="mb-3">
            <p className="text-sm text-zinc-400 leading-relaxed">
              {expanded ? item.summary : previewText}
            </p>
            {needsTruncation && (
              <button
                onClick={toggleExpand}
                className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full transition-all duration-200 text-white"
                style={{
                  background: expanded
                    ? "linear-gradient(135deg, #166534, #22c55e)"
                    : "linear-gradient(135deg, #16a34a, #4ade80)",
                  boxShadow: expanded
                    ? "0 2px 6px rgba(34, 197, 94, 0.2)"
                    : "0 3px 10px rgba(74, 222, 128, 0.3)",
                }}
              >
                {expanded ? (
                  <>
                    Show less <ChevronUp className="w-3 h-3" />
                  </>
                ) : (
                  <>
                    Read more <ChevronDown className="w-3 h-3" />
                  </>
                )}
              </button>
            )}
          </div>

          {/* Meta */}
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className={`font-medium ${config.sourceColor}`}>
              {item.source_name}
            </span>
            <time dateTime={item.date} className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(item.date)}
            </time>
            <a
              href={item.source_link}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-zinc-400 hover:text-zinc-200"
            >
              Read <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─── Main Page — NO framer-motion animations ────────────── */
export default function AINewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");

  // Fetch from Firebase Firestore (uses 50MB offline cache automatically)
  useEffect(() => {
    async function fetchNews() {
      try {
        const q = query(
          collection(db, "news"),
          orderBy("date", "desc")
        );
        const snapshot = await getDocs(q);
        const items: NewsItem[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as NewsItem[];
        setNews(items);
      } catch (err) {
        setError("Could not load news. Please try again later.");
        console.error("News fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchNews();
  }, []);

  // Sort: AI first, then Technology, then General — within each group by date
  const sortedAndFilteredNews = useMemo(() => {
    let filtered = news;
    if (filter !== "all") {
      filtered = news.filter((n) => n.category === filter);
    }
    const priorityMap: Record<string, number> = { ai: 0, technology: 1, general: 2 };
    return [...filtered].sort((a, b) => {
      const pA = priorityMap[a.category] ?? 2;
      const pB = priorityMap[b.category] ?? 2;
      if (pA !== pB) return pA - pB;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [news, filter]);

  // Counts per category
  const counts = useMemo(() => {
    const c = { ai: 0, technology: 0, general: 0 };
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
              {(["ai", "technology", "general"] as const).map((cat) => {
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
