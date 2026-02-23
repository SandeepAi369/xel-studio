"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Newspaper,
  Bot,
  Sparkles,
  Globe,
  Zap,
  ChevronRight,
  Calendar,
  Search,
  FileText,
} from "lucide-react";
import SmartListenButton from "@/components/SmartListenButton";
import { prepareTTSText, stripMarkdown } from "@/lib/tts-text";
import { SkeletonGrid } from "@/components/SkeletonCard";

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
    badgeBg: "bg-violet-500/20",
    badgeText: "text-violet-400",
    badgeBorder: "border-violet-500/30",
    activeBg: "bg-violet-500/20",
    activeText: "text-violet-300",
    activeBorder: "border-violet-500/30",
    hoverText: "hover:text-violet-300",
    hoverBg: "hover:bg-violet-500/10",
  },
  tech: {
    icon: Zap,
    label: "Tech",
    badgeBg: "bg-sky-500/20",
    badgeText: "text-sky-400",
    badgeBorder: "border-sky-500/30",
    activeBg: "bg-sky-500/20",
    activeText: "text-sky-300",
    activeBorder: "border-sky-500/30",
    hoverText: "hover:text-sky-300",
    hoverBg: "hover:bg-sky-500/10",
  },
  world: {
    icon: Globe,
    label: "World",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-400",
    badgeBorder: "border-emerald-500/30",
    activeBg: "bg-emerald-500/20",
    activeText: "text-emerald-300",
    activeBorder: "border-emerald-500/30",
    hoverText: "hover:text-emerald-300",
    hoverBg: "hover:bg-emerald-500/10",
  },
};

/* ─── Main Page ────────────────────────────────────────────── */
export default function AINewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Real-time Firestore listener
  useEffect(() => {
    const q = query(collection(db, "news"), orderBy("date", "desc"));

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

    return () => unsubscribe();
  }, []);

  // Scroll position restoration
  useEffect(() => {
    const savedPos = sessionStorage.getItem("ai-news-scroll");
    if (savedPos && !loading) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedPos, 10));
        sessionStorage.removeItem("ai-news-scroll");
      });
    }
  }, [loading]);

  // Filter + search + sort
  const filteredNews = useMemo(() => {
    let result = news;
    if (filter !== "all") {
      result = result.filter((n) => n.category === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.summary.toLowerCase().includes(q)
      );
    }
    return [...result].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [news, filter, searchQuery]);

  // Category counts
  const counts = useMemo(() => {
    const c = { ai: 0, tech: 0, world: 0 };
    news.forEach((n) => {
      if (n.category in c) c[n.category as keyof typeof c]++;
    });
    return c;
  }, [news]);

  return (
    <main className="min-h-screen bg-[#0a0a0a] pb-16">
      {/* Header — matching articles page */}
      <header className="pt-16 pb-8 px-4 text-center">
        <div>
          <Bot className="w-16 h-16 mx-auto mb-6 text-purple-400" />
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
            Daily News Feed
          </h1>
          <p className="text-zinc-400 text-lg max-w-md mx-auto">
            AI-powered coverage · Technology, AI & World News
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4">
        {/* Search Bar — same as articles */}
        <div className="mb-8">
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search news..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Category Filter Tabs */}
        {!loading && news.length > 0 && (
          <nav className="flex items-center justify-center gap-2 mb-8 flex-wrap">
            <button
              onClick={() => setFilter("all")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === "all"
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                }`}
            >
              All ({news.length})
            </button>

            {(["ai", "tech", "world"] as const).map((cat) => {
              const config = CATEGORY_CONFIG[cat];
              const Icon = config.icon;
              const count = counts[cat];
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5 ${filter === cat
                      ? `${config.activeBg} ${config.activeText} border ${config.activeBorder}`
                      : `bg-zinc-900/60 text-zinc-400 ${config.hoverText} ${config.hoverBg}`
                    }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {config.label} ({count})
                </button>
              );
            })}
          </nav>
        )}

        {/* Loading — same skeleton as articles */}
        {loading && <SkeletonGrid count={6} variant="article" columns={3} />}

        {/* Error */}
        {error && (
          <div className="text-center py-16">
            <p className="text-zinc-400">{error}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filteredNews.length === 0 && (
          <div className="text-center py-16">
            {searchQuery ? (
              <>
                <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                <p className="text-zinc-500">No news matches your search</p>
              </>
            ) : (
              <>
                <Newspaper className="w-16 h-16 mx-auto mb-6 text-zinc-600" />
                <p className="text-zinc-500 text-lg mb-2">
                  {filter !== "all"
                    ? `No ${CATEGORY_CONFIG[filter]?.label || filter} news available.`
                    : "No news available yet. Feed will populate automatically."}
                </p>
              </>
            )}
          </div>
        )}

        {/* News Grid — matching articles grid layout */}
        {!loading && !error && filteredNews.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredNews.map((item) => {
              const config =
                CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.tech;

              return (
                <Link
                  key={item.id}
                  href={`/ai-news/${item.id}`}
                  onClick={() =>
                    sessionStorage.setItem(
                      "ai-news-scroll",
                      String(window.scrollY)
                    )
                  }
                  className="article-card block bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden hover:border-green-500/50 hover:bg-zinc-900/80 transition-all duration-200 cursor-pointer h-full"
                >
                  {/* Image — same fixed height as articles */}
                  <div className="h-52 w-full overflow-hidden bg-zinc-800 relative">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/20 to-zinc-900">
                        <FileText className="w-12 h-12 text-purple-500/30" />
                      </div>
                    )}

                    {/* Category badge on image */}
                    <span
                      className={`absolute top-3 left-3 px-3 py-1 text-xs font-medium rounded-full border ${config.badgeBg} ${config.badgeText} ${config.badgeBorder}`}
                      style={{ pointerEvents: "none" }}
                    >
                      {config.label}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="p-5">
                    <div className="flex items-center gap-1.5 text-zinc-500 text-sm mb-3">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>
                        {new Date(item.date).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>

                    <div className="flex items-start gap-3 mb-3">
                      <h2 className="text-lg font-semibold text-white line-clamp-2 flex-1">
                        {item.title}
                      </h2>
                      <div
                        className="flex-shrink-0 mt-0.5"
                        onClick={(e) => e.preventDefault()}
                      >
                        <SmartListenButton
                          text={prepareTTSText(item.title, item.summary)}
                          iconOnly
                          className="w-9 h-9"
                        />
                      </div>
                    </div>

                    <p className="text-gray-400 text-sm leading-relaxed line-clamp-3">
                      {stripMarkdown(item.summary).substring(0, 150)}...
                    </p>

                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-1 text-green-400 text-sm font-medium">
                        <span>Read more</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Footer count */}
        {!loading && news.length > 0 && (
          <p className="text-center text-xs text-zinc-600 mt-8">
            Showing {filteredNews.length} of {news.length} articles · AI-powered
            · Live from Firebase
          </p>
        )}

        {/* Back Link — same as articles */}
        <div className="mt-12 text-center">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 px-6 py-3 text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </button>
        </div>
      </div>
    </main>
  );
}
