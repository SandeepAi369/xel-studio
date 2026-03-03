import { MetadataRoute } from 'next';
import { adminDb } from '@/lib/firebase-admin';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://xel-studio.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    // ── Static pages ────────────────────────────────────────────
    const staticPages: MetadataRoute.Sitemap = [
        { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
        { url: `${BASE_URL}/ai-news`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.9 },
        { url: `${BASE_URL}/articles`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
        { url: `${BASE_URL}/ai`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
        { url: `${BASE_URL}/chat`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
        { url: `${BASE_URL}/store`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
        { url: `${BASE_URL}/shield`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    ];

    // ── Dynamic: AI News articles from Firestore ────────────────
    let newsPages: MetadataRoute.Sitemap = [];
    try {
        const newsSnap = await adminDb.collection('news')
            .orderBy('date', 'desc')
            .limit(100)
            .select('date')
            .get();

        newsPages = newsSnap.docs.map(doc => ({
            url: `${BASE_URL}/ai-news/${doc.id}`,
            lastModified: doc.data().date ? new Date(doc.data().date) : new Date(),
            changeFrequency: 'weekly' as const,
            priority: 0.7,
        }));
    } catch (e) {
        console.warn('Sitemap: failed to fetch news articles:', e);
    }

    // ── Dynamic: Articles from Supabase ─────────────────────────
    let articlePages: MetadataRoute.Sitemap = [];
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);
            const { data } = await supabase
                .from('articles')
                .select('id, date')
                .order('date', { ascending: false })
                .limit(100);

            if (data) {
                articlePages = data.map(article => ({
                    url: `${BASE_URL}/articles/${article.id}`,
                    lastModified: article.date ? new Date(article.date) : new Date(),
                    changeFrequency: 'monthly' as const,
                    priority: 0.7,
                }));
            }
        }
    } catch (e) {
        console.warn('Sitemap: failed to fetch articles:', e);
    }

    return [...staticPages, ...newsPages, ...articlePages];
}
