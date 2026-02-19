import { NextRequest, NextResponse } from 'next/server';
import {
    getArticles, getApps, getAILabs, getSecurityTools,
} from '@/lib/supabase-db';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
    const type = request.nextUrl.searchParams.get('type');

    try {
        let data;

        switch (type) {
            case 'articles':
                data = { items: await getArticles() };
                break;
            case 'apks':
                data = { items: await getApps() };
                break;
            case 'aiLabs':
                data = { items: await getAILabs() };
                break;
            case 'securityTools':
                data = { items: await getSecurityTools() };
                break;
            default:
                // Return all content types
                const [articles, apks, aiLabs, securityTools] = await Promise.all([
                    getArticles(),
                    getApps(),
                    getAILabs(),
                    getSecurityTools(),
                ]);
                data = { articles, apks, aiLabs, securityTools };
        }

        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        });

    } catch (error) {
        console.error('Content API error:', error);
        return NextResponse.json({
            error: 'Failed to load content',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
