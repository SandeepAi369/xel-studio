"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Newspaper,
  Bot,
  Sparkles,
  Globe,
  ChevronRight,
  Calendar,
  FileText,
  Accessibility,
  LayoutGrid,
  Heart,
} from "lucide-react";
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
  category: string;
}

type FilterTab = "all" | "ai-tech" | "disability" | "health" | "world" | "general";

/* ─── Category Config ─────────────────────────────────────── */
const CATEGORIES: {
  key: FilterTab;
  icon: typeof Sparkles;
  label: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}[] = [
    {
      key: "ai-tech",
      icon: Sparkles,
      label: "AI & Tech",
      badgeBg: "bg-violet-500/20",
      badgeText: "text-violet-400",
      badgeBorder: "border-violet-500/30",
    },
    {
      key: "disability",
      icon: Accessibility,
      label: "Disability",
      badgeBg: "bg-amber-500/20",
      badgeText: "text-amber-400",
      badgeBorder: "border-amber-500/30",
    },
    {
      key: "health",
      icon: Heart,
      label: "Health",
      badgeBg: "bg-blue-500/20",
      badgeText: "text-blue-400",
      badgeBorder: "border-blue-500/30",
    },
    {
      key: "world",
      icon: Globe,
      label: "World",
      badgeBg: "bg-emerald-500/20",
      badgeText: "text-emerald-400",
      badgeBorder: "border-emerald-500/30",
    },
    {
      key: "general",
      icon: LayoutGrid,
      label: "General",
      badgeBg: "bg-zinc-500/20",
      badgeText: "text-zinc-400",
      badgeBorder: "border-zinc-500/30",
    },
  ];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// Map backend categories → frontend filter tabs
function resolveCategory(cat: string): string {
  const map: Record<string, string> = {
    // AI & Tech bucket
    "ai": "ai-tech",
    "tech": "ai-tech",
    "ai-tech": "ai-tech",
    "science": "ai-tech",
    // Disability bucket
    "disability": "disability",
    "accessibility": "disability",
    // Health bucket
    "health": "health",
    // World bucket
    "world": "world",
    "climate": "world",
    // General bucket
    "general": "general",
    "business": "general",
    "entertainment": "general",
  };
  return map[cat] || "general";
}

/* ─── Main Page ────────────────────────────────────────────── */
export default function AINewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const tabsRef = useRef<HTMLDivElement>(null);

  // Real-time Firestore listener
  useEffect(() => {
    const q = query(collection(db, "news"), orderBy("date", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: NewsItem[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            category: resolveCategory(data.category || "general"),
          } as NewsItem;
        });
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

  // Filter + sort
  const filteredNews = useMemo(() => {
    let result = news;
    if (filter !== "all") {
      result = result.filter((n) => n.category === filter);
    }
    return [...result].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [news, filter]);

  // Category counts
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    CATEGORIES.forEach((cat) => {
      c[cat.key] = 0;
    });
    news.forEach((n) => {
      const resolved = n.category;
      if (resolved in c) c[resolved]++;
    });
    return c;
  }, [news]);

  return (
    <main className="min-h-screen bg-[#0a0a0a] pb-16">
      {/* Header */}
      <header className="pt-16 pb-8 px-4 text-center">
        <div>
          <Bot className="w-16 h-16 mx-auto mb-6 text-purple-400" />
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
            Daily News Feed
          </h1>
          <p className="text-zinc-400 text-lg max-w-md mx-auto">
            AI-powered coverage · AI, Tech, Climate, Accessibility &amp; World News
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4">
        {/* Category Filter Tabs — horizontal scrollable */}
        {!loading && news.length > 0 && (
          <div className="mb-6 -mx-4 px-4">
            <div
              ref={tabsRef}
              className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1.5"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {/* All Tab */}
              <button
                onClick={() => setFilter("all")}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filter === "all"
                  ? "bg-zinc-200 text-zinc-900"
                  : "bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 border border-zinc-800"
                  }`}
              >
                All ({news.length})
              </button>

              {/* Category Tabs */}
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const count = counts[cat.key] || 0;
                const isActive = filter === cat.key;
                return (
                  <button
                    key={cat.key}
                    onClick={() => setFilter(cat.key)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${isActive
                      ? `${cat.badgeBg} ${cat.badgeText} border ${cat.badgeBorder}`
                      : "bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 border border-zinc-800"
                      }`}
                  >
                    <Icon className="w-3 h-3" />
                    {cat.label} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && <SkeletonGrid count={4} variant="article" columns={2} />}

        {/* Error */}
        {error && (
          <div className="text-center py-16">
            <p className="text-zinc-400">{error}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filteredNews.length === 0 && (
          <div className="text-center py-16">
            <Newspaper className="w-16 h-16 mx-auto mb-6 text-zinc-600" />
            <p className="text-zinc-500 text-lg mb-2">
              {filter !== "all"
                ? `No ${CATEGORY_MAP[filter]?.label || filter} news available.`
                : "No news available yet. Feed will populate automatically."}
            </p>
          </div>
        )}

        {/* News Grid — 2 columns */}
        {!loading && !error && filteredNews.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredNews.map((item) => {
              const config =
                CATEGORY_MAP[item.category as FilterTab] ||
                CATEGORY_MAP.general;

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
                  {/* Image */}
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
                    {config && (
                      <span
                        className={`absolute top-2.5 left-2.5 px-2 py-0.5 text-[10px] font-medium rounded-md border ${config.badgeBg} ${config.badgeText} ${config.badgeBorder}`}
                        style={{ pointerEvents: "none" }}
                      >
                        {config.label}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <div className="flex items-center gap-1.5 text-zinc-500 text-xs mb-2">
                      <Calendar className="w-3 h-3" />
                      <span>
                        {new Date(item.date).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>

                    <h2 className="text-base font-semibold text-white line-clamp-2 mb-2">
                      {item.title}
                    </h2>

                    <p className="text-gray-400 text-[13px] leading-relaxed line-clamp-3">
                      {item.summary.substring(0, 150)}...
                    </p>

                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-1 text-green-400 text-xs font-medium">
                        <span>Read more</span>
                        <ChevronRight className="w-3.5 h-3.5" />
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

        {/* Back Link */}
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
