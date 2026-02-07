import { NextRequest, NextResponse } from 'next/server';
import { readDBAsync } from '@/lib/db';
import { isVercel } from '@/lib/github-api';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
    const type = request.nextUrl.searchParams.get('type');

    try {
        // Always get fresh data from GitHub (on Vercel) or filesystem (local)
        // Force refresh on Vercel to ensure newly added articles appear immediately
        const db = await readDBAsync(isVercel());

        let data;

        switch (type) {
            case 'articles':
                data = { items: db.articles || [] };
                break;
            case 'apks':
                data = { items: db.apks || [] };
                break;
            case 'aiLabs':
                data = { items: db.aiLabs || [] };
                break;
            case 'securityTools':
                data = { items: db.securityTools || [] };
                break;
            case 'aiNews':
            case 'techNews': {
                // Tech news is separate - import dynamically
                const { getTechNewsAsync } = await import('@/lib/db');
                data = { items: await getTechNewsAsync() };
                break;
            }
            default:
                data = {
                    articles: db.articles || [],
                    apks: db.apks || [],
                    aiLabs: db.aiLabs || [],
                    securityTools: db.securityTools || []
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
