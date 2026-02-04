import { NextRequest, NextResponse } from 'next/server';
import {
    getArticlesAsync,
    getAPKsAsync,
    getAILabsAsync,
    getSecurityToolsAsync,
    getTechNewsAsync,
    initializeDB
} from '@/lib/db';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
    const type = request.nextUrl.searchParams.get('type');

    try {
        // Initialize database (loads from GitHub on Vercel)
        await initializeDB();

        let data;

        switch (type) {
            case 'articles':
                data = { items: await getArticlesAsync() };
                break;
            case 'apks':
                data = { items: await getAPKsAsync() };
                break;
            case 'aiLabs':
                data = { items: await getAILabsAsync() };
                break;
            case 'securityTools':
                data = { items: await getSecurityToolsAsync() };
                break;
            case 'aiNews':
            case 'techNews':
                data = { items: await getTechNewsAsync() };
                break;
            default:
                data = {
                    articles: await getArticlesAsync(),
                    apks: await getAPKsAsync(),
                    aiLabs: await getAILabsAsync(),
                    securityTools: await getSecurityToolsAsync()
                };
        }

        // Return with no-cache headers to always get fresh data
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
