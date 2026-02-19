import { NextRequest, NextResponse } from 'next/server';
import {
    getArticles as getArticlesFromSupabase,
    getApps as getAppsFromSupabase,
    getAILabs as getAILabsFromSupabase,
    getSecurityTools as getSecurityToolsFromSupabase,
} from '@/lib/supabase-db';
import {
    getArticlesAsync,
    getAPKsAsync,
    getAILabsAsync,
    getSecurityToolsAsync,
} from '@/lib/db';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Try Supabase first, fall back to data.json/GitHub if empty or error */
async function getArticles() {
    try {
        const items = await getArticlesFromSupabase();
        if (items.length > 0) return items;
    } catch (e) {
        console.warn('Supabase articles failed, falling back to data.json:', e);
    }
    return await getArticlesAsync();
}

async function getApps() {
    try {
        const items = await getAppsFromSupabase();
        if (items.length > 0) return items;
    } catch (e) {
        console.warn('Supabase apps failed, falling back to data.json:', e);
    }
    return await getAPKsAsync();
}

async function getAILabs() {
    try {
        const items = await getAILabsFromSupabase();
        if (items.length > 0) return items;
    } catch (e) {
        console.warn('Supabase AI labs failed, falling back to data.json:', e);
    }
    return await getAILabsAsync();
}

async function getSecurityTools() {
    try {
        const items = await getSecurityToolsFromSupabase();
        if (items.length > 0) return items;
    } catch (e) {
        console.warn('Supabase security tools failed, falling back to data.json:', e);
    }
    return await getSecurityToolsAsync();
}

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
