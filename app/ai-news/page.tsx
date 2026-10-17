import { adminDb } from "@/lib/firebase-admin";
import NewsFeed, { type NewsItem, resolveCategory } from "@/components/NewsFeed";

// Edge-cached (ISR): the first paint comes from the CDN with the current
// news already in the HTML; NewsFeed's Firestore listener then keeps it live.
// News is published every ~30 min, so a 60 s window is plenty fresh.
export const revalidate = 60;

async function getInitialNews(): Promise<NewsItem[]> {
  try {
    const snap = await adminDb.collection("news").orderBy("date", "desc").get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title ?? "",
        summary: d.summary ?? "",
        image_url: d.image_url ?? null,
        source_link: d.source_link ?? "",
        source_name: d.source_name ?? "",
        date: d.date ?? "",
        category: resolveCategory(d.category || "general"),
      };
    });
  } catch (e) {
    // Fall back to the client-side listener (skeleton, then live data).
    console.error("ai-news: initial fetch failed:", e);
    return [];
  }
}

export default async function AINewsPage() {
  const initialNews = await getInitialNews();
  return <NewsFeed initialNews={initialNews} />;
}
