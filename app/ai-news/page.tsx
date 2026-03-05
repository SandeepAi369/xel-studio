"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Newspaper,
  Sparkles,
  Globe,
  ChevronRight,
  Calendar,
  FileText,
  Accessibility,
  LayoutGrid,
  Heart,
  Trophy,
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

type FilterTab = "all" | "ai-tech" | "disability" | "health" | "world" | "general" | "sports";

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
    {
      key: "sports",
      icon: Trophy,
      label: "Sports",
      badgeBg: "bg-orange-500/20",
      badgeText: "text-orange-400",
      badgeBorder: "border-orange-500/30",
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
    "sports": "sports",
    "sport": "sports",
    "athletics": "sports",
    "achievement": "sports",
  };
  return map[cat] || "general";
}

/* ─── Main Page ────────────────────────────────────────────── */
export default function AINewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>(() => {
    if (typeof window === "undefined") return "all";
    try {
      const raw = sessionStorage.getItem("ai-news-filter");
      if (raw) {
        const { tab, ts } = JSON.parse(raw);
        if (Date.now() - ts < 300000) return tab as FilterTab; // 5 min TTL
      }
    } catch { }
    return "all";
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  // Hide container during scroll restoration to prevent flash
  const [restoring, setRestoring] = useState(() => {
    if (typeof window === "undefined") return false;
    const raw = sessionStorage.getItem("ai-news-slide-index");
    if (!raw) return false;
    try {
      const { ts } = JSON.parse(raw);
      return Date.now() - ts < 300000; // only if within 5 min
    } catch { return false; }
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  // System auto detector for mobile/tablet viewport
  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(media.matches);

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [filter]);

  // Scroll position restoration — 5-minute memory window
  // Within 5 min: restore to exact article position (e.g. clicked article and came back)
  // After 5 min or fresh browser open: always show latest news at index 0
  useEffect(() => {
    if (loading || filteredNews.length === 0) return;

    const raw = sessionStorage.getItem("ai-news-slide-index");
    if (raw) {
      let idx = 0;
      let isValid = false;
      try {
        const parsed = JSON.parse(raw);
        idx = Math.min(parsed.idx ?? 0, filteredNews.length - 1);
        isValid = Date.now() - (parsed.ts ?? 0) < 300000; // 5 min
      } catch { /* invalid */ }
      sessionStorage.removeItem("ai-news-slide-index");

      if (isValid && idx > 0) {
        setCurrentIndex(idx);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = slideRefs.current[idx];
            if (el && containerRef.current) {
              containerRef.current.scrollTo({ top: el.offsetTop, behavior: "instant" as ScrollBehavior });
            }
            setRestoring(false);
          });
        });
        return;
      }
    }

    // No valid saved position — show latest news
    setRestoring(false);
    setCurrentIndex(0);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
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



  // Loading state
  if (loading) {
    return (
      <main className="h-screen w-full bg-[#0a0a0a] flex flex-col" role="status" aria-label="Loading news feed" aria-live="polite">
        {/* Skeleton category bar */}
        <div className="w-full px-4 py-3 flex items-center justify-between gap-2" aria-hidden="true">
          <div className="h-8 w-16 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-20 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-24 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-16 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-20 rounded-full bg-zinc-800 animate-pulse" />
        </div>
        {/* Skeleton image */}
        <div className="w-full bg-zinc-800 animate-pulse" style={{ height: "55%" }} aria-hidden="true" />
        {/* Skeleton text */}
        <div className="flex-1 bg-[#0a0a0a] px-5 py-5 space-y-3" aria-hidden="true">
          <div className="h-3 w-24 rounded bg-zinc-800 animate-pulse" />
          <div className="h-6 w-full rounded bg-zinc-800 animate-pulse" />
          <div className="h-6 w-3/4 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 w-full rounded bg-zinc-800/60 animate-pulse mt-2" />
          <div className="h-4 w-5/6 rounded bg-zinc-800/60 animate-pulse" />
          <div className="h-4 w-20 rounded bg-green-900/40 animate-pulse mt-3" />
        </div>
        {/* Screen reader text */}
        <span className="sr-only">Loading news articles, please wait...</span>
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



      {/* ── Category filter tabs — full width top bar ──────── */}
      {news.length > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-xl border-b border-zinc-800/50">
          <nav className="px-3 py-3 flex items-center justify-center" aria-label="News categories">
            {/* Category tabs - centered */}
            <div
              className="flex items-center gap-1.5 overflow-x-auto max-w-full"
              role="tablist"
              aria-label="Filter news by category"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                onClick={() => {
                  setFilter("all");
                  sessionStorage.setItem("ai-news-filter", JSON.stringify({ tab: "all", ts: Date.now() }));
                }}
                role="tab"
                aria-selected={filter === "all"}
                aria-label="Show all news"
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${filter === "all"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white"
                  }`}
              >
                All
              </button>
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isActive = filter === cat.key;
                return (
                  <button
                    key={cat.key}
                    onClick={() => {
                      setFilter(cat.key);
                      sessionStorage.setItem("ai-news-filter", JSON.stringify({ tab: cat.key, ts: Date.now() }));
                    }}
                    role="tab"
                    aria-selected={isActive}
                    aria-label={`Filter by ${cat.label}`}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${isActive
                      ? `${cat.badgeBg} ${cat.badgeText} border ${cat.badgeBorder}`
                      : "text-zinc-400 hover:text-white"
                      }`}
                  >
                    <Icon className="w-3 h-3" aria-hidden="true" />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </nav>
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

      {/* ── Desktop: YouTube-style scrollable grid ─────────── */}
      {filteredNews.length > 0 && !isMobile && (
        <div
          ref={containerRef}
          className="h-full w-full overflow-y-auto transition-opacity duration-200"
          role="feed"
          aria-label={`News articles, showing ${filteredNews.length} articles`}
          aria-busy={loading}
          style={{ paddingTop: "60px", opacity: restoring ? 0 : 1 }}
        >
          <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col gap-5">
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
                      JSON.stringify({ idx: index, ts: Date.now() })
                    )
                  }
                  ref={(el: HTMLAnchorElement | null) => { slideRefs.current[index] = el as unknown as HTMLDivElement; }}
                  data-index={index}
                  className="group flex gap-5 bg-zinc-900/50 hover:bg-zinc-800/60 rounded-xl overflow-hidden border border-zinc-800/50 hover:border-zinc-700/60 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                  role="article"
                  aria-label={`${item.title} - ${config?.label || "News"}`}
                >
                  {/* Thumbnail */}
                  <div className="relative w-[380px] min-w-[380px] h-[214px] overflow-hidden flex-shrink-0">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading={index < 4 ? "eager" : "lazy"}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-purple-900/20 via-zinc-900 to-zinc-950 flex items-center justify-center">
                        <FileText className="w-12 h-12 text-purple-500/20" />
                      </div>
                    )}
                    {/* Duration-style category badge */}
                    {config && (
                      <span
                        className={`absolute bottom-2 right-2 px-2 py-0.5 text-xs font-semibold rounded ${config.badgeBg} ${config.badgeText} backdrop-blur-md`}
                      >
                        {config.label}
                      </span>
                    )}
                  </div>

                  {/* Text content */}
                  <div className="flex-1 py-3 pr-5 flex flex-col justify-between min-w-0">
                    <div>
                      <h2 className="text-lg font-semibold text-white leading-snug line-clamp-2 mb-2 group-hover:text-green-400 transition-colors">
                        {item.title}
                      </h2>
                      <p className="text-sm text-zinc-400 leading-relaxed line-clamp-3 mb-3">
                        {item.summary.replace(/\*\*/g, "").replace(/^[-•*]\s+/gm, "").substring(0, 200)}...
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <time dateTime={item.date}>
                          {new Date(item.date).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </span>
                      <span className="text-zinc-700">•</span>
                      <span className="text-green-500 font-medium flex items-center gap-0.5">
                        Read more <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Mobile: Full-screen snap-scroll (unchanged) ───── */}
      {filteredNews.length > 0 && isMobile && (
        <div
          ref={containerRef}
          className="h-full w-full overflow-y-auto transition-opacity duration-200"
          role="feed"
          aria-label={`News articles, showing ${filteredNews.length} articles`}
          aria-busy={loading}
          style={{
            paddingTop: "50px",
            scrollSnapType: "y mandatory",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            opacity: restoring ? 0 : 1,
          }}
        >
          {/* Screen reader: current position */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            Article {currentIndex + 1} of {filteredNews.length}
          </div>
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
                    JSON.stringify({ idx: currentIndex, ts: Date.now() })
                  )
                }
                ref={(el: HTMLAnchorElement | null) => { slideRefs.current[index] = el as unknown as HTMLDivElement; }}
                data-index={index}
                tabIndex={0}
                className="w-full flex-shrink-0 cursor-pointer flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-400"
                style={{
                  height: "calc(100vh - 50px)",
                  scrollSnapAlign: "start",
                  scrollSnapStop: "always"
                }}
                role="article"
                aria-label={`Article ${index + 1} of ${filteredNews.length}: ${item.title}`}
                aria-setsize={filteredNews.length}
                aria-posinset={index + 1}
              >
                {/* Image */}
                <div className="relative w-full overflow-hidden bg-zinc-900" style={{ height: "48%" }}>
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
                  {config && (
                    <span
                      className={`absolute bottom-3 left-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border backdrop-blur-md ${config.badgeBg} ${config.badgeText} ${config.badgeBorder}`}
                      aria-label={`Category: ${config.label}`}
                    >
                      {config.label}
                    </span>
                  )}
                </div>

                {/* Text */}
                <div className="w-full bg-[#0a0a0a] px-4 pt-3 pb-4 flex flex-col justify-center" style={{ height: "52%" }}>
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
                  <h2 className="text-lg font-bold text-white leading-snug mb-2 line-clamp-3">
                    {item.title}
                  </h2>
                  <p className="text-sm line-clamp-4 text-zinc-300 leading-relaxed mb-4 max-w-2xl">
                    {item.summary.replace(/\*\*/g, "").replace(/^[-•*]\s+/gm, "").substring(0, 180)}...
                  </p>
                  <span className="inline-flex items-center gap-1 text-green-400 text-sm font-semibold" aria-label="Read full article">
                    Read more
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

    </div>
  );
}
