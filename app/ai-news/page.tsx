"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Newspaper,
  Sparkles,
  Globe,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Calendar,
  FileText,
  Accessibility,
  LayoutGrid,
  Heart,
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
    "ai": "ai-tech",
    "tech": "ai-tech",
    "ai-tech": "ai-tech",
    "science": "ai-tech",
    "disability": "disability",
    "accessibility": "disability",
    "health": "health",
    "world": "world",
    "climate": "world",
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showHint, setShowHint] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

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

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [filter]);

  // Scroll position restoration (save/restore slide index)
  useEffect(() => {
    const savedIdx = sessionStorage.getItem("ai-news-slide-index");
    if (savedIdx && !loading && filteredNews.length > 0) {
      const idx = Math.min(parseInt(savedIdx, 10), filteredNews.length - 1);
      setCurrentIndex(idx);
      requestAnimationFrame(() => {
        slideRefs.current[idx]?.scrollIntoView({ behavior: "auto" });
        sessionStorage.removeItem("ai-news-slide-index");
      });
    }
  }, [loading, filteredNews.length]);

  // Track current slide via IntersectionObserver
  useEffect(() => {
    if (loading || filteredNews.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute("data-index"));
            if (!isNaN(idx)) {
              setCurrentIndex(idx);
              setShowHint(false);
            }
          }
        }
      },
      { threshold: 0.6 }
    );

    slideRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [loading, filteredNews]);

  // Navigate to specific slide
  const goToSlide = useCallback((idx: number) => {
    slideRefs.current[idx]?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Loading state
  if (loading) {
    return (
      <main className="h-screen w-full bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full border-4 border-zinc-800 border-t-green-500 animate-spin" />
          <p className="text-zinc-400 text-lg">Loading news feed...</p>
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    return (
      <main className="h-screen w-full bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <Newspaper className="w-16 h-16 mx-auto mb-6 text-zinc-600" />
          <p className="text-zinc-400">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="h-screen w-full bg-[#0a0a0a] overflow-hidden relative">
      {/* ── LIVE indicator ───────────────────────────────────── */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm border border-green-500/30 rounded-full px-3 py-1.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
        </span>
        <span className="text-green-400 text-xs font-semibold tracking-wider">LIVE</span>
      </div>

      {/* ── Back button ──────────────────────────────────────── */}
      <button
        onClick={() => router.back()}
        className="fixed top-4 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-black/60 backdrop-blur-sm border border-zinc-700/50 rounded-full text-zinc-300 hover:text-white hover:bg-black/80 transition-all text-xs"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      {/* ── Category filter tabs — fixed top center ──────────── */}
      {news.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[70vw] md:max-w-lg">
          <div
            className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 bg-black/60 backdrop-blur-xl border border-zinc-700/40 rounded-full"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {/* All Tab */}
            <button
              onClick={() => setFilter("all")}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${filter === "all"
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-white"
                }`}
            >
              All
            </button>
            {/* Category Tabs */}
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = filter === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setFilter(cat.key)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all flex items-center gap-1 ${isActive
                    ? `${cat.badgeBg} ${cat.badgeText} border ${cat.badgeBorder}`
                    : "text-zinc-400 hover:text-white"
                    }`}
                >
                  <Icon className="w-3 h-3" />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Progress dots — right side ───────────────────────── */}
      {filteredNews.length > 1 && (
        <div className="fixed right-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1.5">
          {filteredNews.map((_, i) => (
            <button
              key={i}
              onClick={() => goToSlide(i)}
              className={`rounded-full transition-all duration-300 ${i === currentIndex
                ? "w-2 h-5 bg-green-400"
                : "w-1.5 h-1.5 bg-zinc-600 hover:bg-zinc-400"
                }`}
              aria-label={`Go to article ${i + 1}`}
            />
          ))}
          {/* Counter */}
          <span className="text-[10px] text-zinc-500 mt-2 font-mono">
            {currentIndex + 1}/{filteredNews.length}
          </span>
        </div>
      )}

      {/* ── Nav arrows — bottom right ────────────────────────── */}
      {filteredNews.length > 1 && (
        <div className="fixed bottom-6 right-4 z-40 flex flex-col gap-2">
          <button
            onClick={() => currentIndex > 0 && goToSlide(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-zinc-700/40 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-black/70 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
          <button
            onClick={() => currentIndex < filteredNews.length - 1 && goToSlide(currentIndex + 1)}
            disabled={currentIndex === filteredNews.length - 1}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-zinc-700/40 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-black/70 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────── */}
      {filteredNews.length === 0 && (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <Newspaper className="w-16 h-16 mx-auto mb-6 text-zinc-600" />
            <p className="text-zinc-500 text-lg mb-2">
              {filter !== "all"
                ? `No ${CATEGORY_MAP[filter]?.label || filter} news available.`
                : "No news available yet."}
            </p>
          </div>
        </div>
      )}

      {/* ── Snap-scroll container ────────────────────────────── */}
      {filteredNews.length > 0 && (
        <div
          ref={containerRef}
          className="h-full w-full overflow-y-auto"
          style={{
            scrollSnapType: "y mandatory",
            scrollBehavior: "smooth",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
        >
          {filteredNews.map((item, index) => {
            const config =
              CATEGORY_MAP[item.category as FilterTab] ||
              CATEGORY_MAP.general;

            return (
              <Link
                key={item.id}
                href={`/ai-news/${item.id}`}
                onClick={() =>
                  sessionStorage.setItem(
                    "ai-news-slide-index",
                    String(currentIndex)
                  )
                }
                ref={(el: HTMLAnchorElement | null) => { slideRefs.current[index] = el as unknown as HTMLDivElement; }}
                data-index={index}
                className="h-screen w-full flex-shrink-0 cursor-pointer flex flex-col"
                style={{ scrollSnapAlign: "start" }}
                role="article"
                aria-label={`${item.title} - ${config?.label || "News"}`}
              >
                {/* ── Image (top 55%) — no padding, no gap ──── */}
                <div className="relative w-full overflow-hidden bg-zinc-900" style={{ height: "55%" }}>
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.title}
                      className="w-full h-full object-cover object-center"
                      loading={index < 3 ? "eager" : "lazy"}
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-900/20 via-zinc-900 to-zinc-950 flex items-center justify-center">
                      <FileText className="w-16 h-16 text-purple-500/20" />
                    </div>
                  )}

                  {/* Category badge */}
                  {config && (
                    <span
                      className={`absolute bottom-3 left-4 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full border backdrop-blur-sm ${config.badgeBg} ${config.badgeText} ${config.badgeBorder}`}
                    >
                      {config.label}
                    </span>
                  )}
                </div>

                {/* ── Text (bottom 45%) — flush against image ── */}
                <div className="w-full bg-[#0a0a0a] px-5 py-4 md:px-8 md:py-5 pr-14 flex flex-col justify-center" style={{ height: "45%" }}>
                  {/* Date */}
                  <div className="flex items-center gap-1.5 text-zinc-400 text-sm mb-2" aria-label="Publication date">
                    <Calendar className="w-3.5 h-3.5" />
                    <time dateTime={item.date}>
                      {new Date(item.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </div>

                  {/* Title */}
                  <h2 className="text-xl md:text-2xl font-bold text-white leading-snug mb-2 line-clamp-3">
                    {item.title}
                  </h2>

                  {/* Summary */}
                  <p className="text-zinc-300 text-sm md:text-base leading-relaxed mb-4 line-clamp-3 max-w-2xl">
                    {item.summary.replace(/\*\*/g, "").replace(/^[-•*]\s+/gm, "").substring(0, 180)}...
                  </p>

                  {/* Read more */}
                  <span className="inline-flex items-center gap-1 text-green-400 text-sm font-semibold" aria-label="Read full article">
                    Read more
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Swipe hint (first load only) ─────────────────────── */}
      {showHint && filteredNews.length > 1 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center animate-bounce">
          <ChevronUp className="w-6 h-6 text-zinc-400" />
          <span className="text-zinc-500 text-xs mt-1">Scroll to explore</span>
        </div>
      )}
    </div>
  );
}
