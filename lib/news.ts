/**
 * Shared AI News helpers — safe to import from server AND client code.
 * (Functions exported from a "use client" module can't be called on the
 * server, so they live here.)
 */

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  image_url: string | null;
  source_link: string;
  source_name: string;
  date: string;
  category: string;
}

// Map backend categories → frontend filter tabs
export function resolveCategory(cat: string): string {
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
