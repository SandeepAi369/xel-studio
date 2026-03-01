"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showHint, setShowHint] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
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

  // Scroll position restoration — INSTANT jump, no animation
  useEffect(() => {
    const savedIdx = sessionStorage.getItem("ai-news-slide-index");
    if (savedIdx && !loading && filteredNews.length > 0) {
      const idx = Math.min(parseInt(savedIdx, 10), filteredNews.length - 1);
      setCurrentIndex(idx);
      // Use double rAF to ensure DOM is painted, then instant scroll
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = slideRefs.current[idx];
          if (el && containerRef.current) {
            containerRef.current.scrollTo({ top: el.offsetTop, behavior: "instant" as ScrollBehavior });
          }
          sessionStorage.removeItem("ai-news-slide-index");
        });
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



  // Loading state
  if (loading) {
    return (
      <main className="h-screen w-full bg-[#0a0a0a] flex flex-col">
        {/* Skeleton category bar */}
        <div className="w-full px-4 py-3 flex items-center justify-between gap-2">
          <div className="h-8 w-16 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-20 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-24 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-16 rounded-full bg-zinc-800 animate-pulse" />
          <div className="h-8 w-20 rounded-full bg-zinc-800 animate-pulse" />
        </div>
        {/* Skeleton image */}
        <div className="w-full bg-zinc-800 animate-pulse" style={{ height: "55%" }} />
        {/* Skeleton text */}
        <div className="flex-1 bg-[#0a0a0a] px-5 py-5 space-y-3">
          <div className="h-3 w-24 rounded bg-zinc-800 animate-pulse" />
          <div className="h-6 w-full rounded bg-zinc-800 animate-pulse" />
          <div className="h-6 w-3/4 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 w-full rounded bg-zinc-800/60 animate-pulse mt-2" />
          <div className="h-4 w-5/6 rounded bg-zinc-800/60 animate-pulse" />
          <div className="h-4 w-20 rounded bg-green-900/40 animate-pulse mt-3" />
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



      {/* ── Category filter tabs — full width top bar ──────── */}
      {news.length > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-xl border-b border-zinc-800/50">
          <div className="px-3 py-3 flex items-center justify-center">
            {/* Category tabs - centered */}
            <div
              className="flex items-center gap-1.5 overflow-x-auto max-w-full"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                onClick={() => setFilter("all")}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${filter === "all"
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
                    onClick={() => setFilter(cat.key)}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${isActive
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
            paddingTop: "50px",
            scrollSnapType: "y mandatory",
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
                className="w-full flex-shrink-0 cursor-pointer flex flex-col"
                style={{
                  height: "calc(100vh - 50px)",
                  scrollSnapAlign: "start",
                  scrollSnapStop: "always"
                }}
                role="article"
                aria-label={`${item.title} - ${config?.label || "News"}`}
              >
                {/* ── Image section — properly sized ──── */}
                <div className="relative w-full overflow-hidden bg-zinc-900" style={{ height: isMobile ? "48%" : "55%" }}>
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
                      className={`absolute bottom-3 left-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border backdrop-blur-md ${config.badgeBg} ${config.badgeText} ${config.badgeBorder}`}
                    >
                      {config.label}
                    </span>
                  )}
                </div>

                {/* ── Text section — properly sized ── */}
                <div
                  className={`w-full bg-[#0a0a0a] ${isMobile ? "px-4 pt-3 pb-4" : "px-6 pt-4 pb-5 md:px-8"} flex flex-col justify-center`}
                  style={{ height: isMobile ? "52%" : "45%" }}
                >
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
                  <h2 className={`${isMobile ? "text-lg" : "text-xl md:text-2xl"} font-bold text-white leading-snug mb-2 line-clamp-3`}>
                    {item.title}
                  </h2>

                  {/* Summary */}
                  <p className={`${isMobile ? "text-sm line-clamp-4" : "text-sm md:text-base line-clamp-3"} text-zinc-300 leading-relaxed mb-4 max-w-2xl`}>
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

    </div>
  );
}
