/**
 * /api/rss — legacy feed URL.
 *
 * This feed used to mix AI News with Articles. AI News is aggregated
 * content that is now kept out of search engines, AI crawlers and feeds,
 * so the old URL permanently redirects to the articles-only feed.
 * Feed readers follow the 308 and keep working.
 */

import { NextResponse } from 'next/server';

export function GET() {
    return NextResponse.redirect('https://xel-studio.vercel.app/articles/feed.xml', 308);
}
