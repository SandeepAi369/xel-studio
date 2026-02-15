import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

/**
 * On-Demand Revalidation API
 * 
 * Call this endpoint after data changes to instantly clear cached pages.
 * This makes new articles/updates appear immediately without waiting for rebuild.
 * 
 * Usage:
 *   POST /api/revalidate
 *   Body: { "secret": "...", "paths": ["/articles", "/ai-news"] }
 * 
 * Or without body (revalidates all common paths):
 *   POST /api/revalidate?secret=...
 */

// All paths that display dynamic content
const ALL_CONTENT_PATHS = [
    '/',
    '/articles',
    '/ai-news',
    '/apks',
    '/ai-labs',
    '/security',
];

export async function POST(request: NextRequest) {
    try {
        // Check secret from body or query
        let secret: string | null = null;
        let paths: string[] | null = null;

        const query = request.nextUrl.searchParams.get('secret');
        
        try {
            const body = await request.json();
            secret = body.secret || query;
            paths = body.paths || null;
        } catch {
            secret = query;
        }

        // Validate secret
        const expectedSecret = process.env.REVALIDATION_SECRET || process.env.ADMIN_PASSWORD;
        if (secret !== expectedSecret) {
            return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
        }

        // Revalidate specified paths or all content paths
        const targetPaths = paths || ALL_CONTENT_PATHS;
        const revalidated: string[] = [];

        for (const path of targetPaths) {
            try {
                revalidatePath(path);
                revalidated.push(path);
            } catch (e) {
                console.error(`Failed to revalidate ${path}:`, e);
            }
        }

        // Also revalidate layout (catches dynamic routes like /articles/[id])
        try {
            revalidatePath('/', 'layout');
        } catch { /* ignore */ }

        return NextResponse.json({
            revalidated: true,
            paths: revalidated,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Revalidation error:', error);
        return NextResponse.json({ error: 'Revalidation failed' }, { status: 500 });
    }
}

// GET for simple webhook calls
export async function GET(request: NextRequest) {
    const secret = request.nextUrl.searchParams.get('secret');
    const expectedSecret = process.env.REVALIDATION_SECRET || process.env.ADMIN_PASSWORD;
    
    if (secret !== expectedSecret) {
        return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
    }

    // Revalidate all paths
    for (const path of ALL_CONTENT_PATHS) {
        try { revalidatePath(path); } catch { /* ignore */ }
    }
    try { revalidatePath('/', 'layout'); } catch { /* ignore */ }

    return NextResponse.json({
        revalidated: true,
        paths: ALL_CONTENT_PATHS,
        timestamp: new Date().toISOString()
    });
}
