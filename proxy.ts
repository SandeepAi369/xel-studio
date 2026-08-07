import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
    const url = request.nextUrl;
    
    // Only intercept /articles/... routes
    if (!url.pathname.startsWith('/articles/')) return NextResponse.next();
    
    // Split and clean path parts
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    // Example: /articles/latest
    if (pathParts.length === 2 && pathParts[0] === 'articles') {
        const intent = pathParts[1].toLowerCase();
        
        if (intent === 'latest' || intent === 'oldest') {
            try {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
                
                if (supabaseUrl && supabaseKey) {
                    const order = intent === 'latest' ? 'desc' : 'asc';
                    const res = await fetch(`${supabaseUrl}/rest/v1/articles?select=id&order=created_at.${order}&limit=1`, {
                        headers: {
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${supabaseKey}`
                        },
                        next: { revalidate: 60 } // Lightweight cache to prevent query storms
                    });
                    
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.length > 0) {
                            // 302 Temporary Redirect because "latest" changes over time
                            return NextResponse.redirect(new URL(`/articles/${data[0].id}`, request.url), 302);
                        }
                    }
                }
            } catch (e) {
                console.error('Middleware semantic route error:', e);
            }
        }
    }
    
    // Example: /articles/[id]/next or /articles/[id]/previous
    if (pathParts.length === 3 && pathParts[0] === 'articles') {
        const id = pathParts[1];
        const intent = pathParts[2].toLowerCase();
        
        if (intent === 'next' || intent === 'previous') {
            try {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
                
                if (supabaseUrl && supabaseKey) {
                    // 1. Get current article's timestamp
                    const currentRes = await fetch(`${supabaseUrl}/rest/v1/articles?select=id,created_at&id=eq.${id}`, {
                        headers: {
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${supabaseKey}`
                        },
                        next: { revalidate: 60 }
                    });
                    
                    if (currentRes.ok) {
                        const currentData = await currentRes.json();
                        if (currentData && currentData.length > 0) {
                            const createdAt = currentData[0].created_at;
                            
                            // 2. Fetch adjacent article
                            // next = newer article (created_at > current), oldest among the newer
                            // previous = older article (created_at < current), newest among the older
                            const operator = intent === 'next' ? 'gt' : 'lt';
                            const order = intent === 'next' ? 'asc' : 'desc';
                            
                            const adjRes = await fetch(`${supabaseUrl}/rest/v1/articles?select=id&created_at=${operator}.${createdAt}&order=created_at.${order}&limit=1`, {
                                headers: {
                                    'apikey': supabaseKey,
                                    'Authorization': `Bearer ${supabaseKey}`
                                },
                                next: { revalidate: 60 }
                            });
                            
                            if (adjRes.ok) {
                                const adjData = await adjRes.json();
                                if (adjData && adjData.length > 0) {
                                    return NextResponse.redirect(new URL(`/articles/${adjData[0].id}`, request.url), 302);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Middleware semantic routing error:', e);
            }
            
            // If next/previous fails or doesn't exist, just redirect to the article itself or /articles
            return NextResponse.redirect(new URL(`/articles/${id}`, request.url), 302);
        }
    }
    
    return NextResponse.next();
}

export const config = {
    matcher: '/articles/:path*',
};
