/**
 * /api/cron/cleanup-history — Database Cleanup Service
 * ====================================================
 * Dedicated cleanup route (separated from news generation to prevent timeouts).
 *
 * Responsibilities:
 *   1. Delete expired news articles (older than NEWS_TTL_HOURS)
 *   2. Delete expired URL history entries (older than HISTORY_TTL_DAYS)
 *   3. Log cleanup results
 *
 * Schedule (vercel.json):
 *   - Runs twice daily at 2:00 AM IST and 4:00 AM IST (20:30 UTC, 22:30 UTC)
 *   - Second run at 4 AM catches anything missed by the first run
 *
 * Firestore batch limit: 500 ops per batch — handled with chunking.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// ─── Config ──────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEWS_COLLECTION = 'news';
const HISTORY_COLLECTION = 'news_history';
const NEWS_TTL_HOURS = 24;        // Delete articles older than 24 hours
const HISTORY_TTL_DAYS = 10;       // Delete history entries older than 10 days

// ─── Cleanup Functions ───────────────────────────────────────

/** Delete expired news articles from 'news' collection */
async function cleanupOldArticles(): Promise<number> {
    const cutoff = new Date(Date.now() - NEWS_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const old = await adminDb.collection(NEWS_COLLECTION).where('date', '<', cutoff).get();

    if (old.size > 0) {
        // Firestore batch limit = 500, chunk deletes
        for (let i = 0; i < old.docs.length; i += 500) {
            const batch = adminDb.batch();
            old.docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        console.log(`🧹 News cleanup: removed ${old.size} articles older than ${NEWS_TTL_HOURS}h`);
    } else {
        console.log('✅ News collection: no expired articles found');
    }

    return old.size;
}

/** Delete expired URL history entries from 'news_history' collection */
async function cleanupOldHistory(): Promise<number> {
    const cutoff = new Date(Date.now() - HISTORY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const old = await adminDb.collection(HISTORY_COLLECTION).where('createdAt', '<', cutoff).get();

    if (old.size > 0) {
        for (let i = 0; i < old.docs.length; i += 500) {
            const batch = adminDb.batch();
            old.docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        console.log(`🧹 History cleanup: removed ${old.size} entries older than ${HISTORY_TTL_DAYS} days`);
    } else {
        console.log('✅ History collection: no expired entries found');
    }

    return old.size;
}

/** Get collection sizes for reporting */
async function getCollectionStats(): Promise<{ newsCount: number; historyCount: number }> {
    const [newsSnap, historySnap] = await Promise.all([
        adminDb.collection(NEWS_COLLECTION).count().get(),
        adminDb.collection(HISTORY_COLLECTION).count().get(),
    ]);
    return {
        newsCount: newsSnap.data().count,
        historyCount: historySnap.data().count,
    };
}

// ─── Route Handler ───────────────────────────────────────────

export async function GET(req: Request) {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (token !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const t0 = Date.now();
    console.log('🧹 CLEANUP SERVICE — Starting database maintenance...');

    try {
        // Run both cleanups in parallel for speed
        const [articlesRemoved, historyRemoved] = await Promise.all([
            cleanupOldArticles(),
            cleanupOldHistory(),
        ]);

        // Get remaining collection sizes
        const stats = await getCollectionStats();
        const duration = Date.now() - t0;

        const result = {
            status: 'ok',
            articles_removed: articlesRemoved,
            history_removed: historyRemoved,
            remaining_articles: stats.newsCount,
            remaining_history: stats.historyCount,
            news_ttl_hours: NEWS_TTL_HOURS,
            history_ttl_days: HISTORY_TTL_DAYS,
            duration_ms: duration,
            timestamp: new Date().toISOString(),
            run_at_ist: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        };

        console.log(`✅ Cleanup complete in ${duration}ms — removed ${articlesRemoved} articles + ${historyRemoved} history entries`);

        return NextResponse.json(result);
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        console.error('❌ Cleanup failed:', errorMsg);

        return NextResponse.json(
            { status: 'error', error: errorMsg, timestamp: new Date().toISOString() },
            { status: 500 }
        );
    }
}
