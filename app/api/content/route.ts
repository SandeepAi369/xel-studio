import { NextRequest, NextResponse } from 'next/server';
import { getArticles, getAPKs, getAILabs, getSecurityTools } from '@/lib/db';

export async function GET(request: NextRequest) {
    const type = request.nextUrl.searchParams.get('type');

    try {
        switch (type) {
            case 'articles':
                return NextResponse.json({ items: getArticles() });
            case 'apks':
                return NextResponse.json({ items: getAPKs() });
            case 'aiLabs':
                return NextResponse.json({ items: getAILabs() });
            case 'securityTools':
                return NextResponse.json({ items: getSecurityTools() });
            default:
                return NextResponse.json({
                    articles: getArticles(),
                    apks: getAPKs(),
                    aiLabs: getAILabs(),
                    securityTools: getSecurityTools()
                });
        }
    } catch (error) {
        console.error('Content API error:', error);
        return NextResponse.json({ error: 'Failed to load content' }, { status: 500 });
    }
}
