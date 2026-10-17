'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

/**
 * Client-side search for the static /articles page.
 *
 * The article cards are server-rendered into the HTML (so crawlers and AI
 * readers always get the full list). This only hides cards that don't match,
 * using each card's data-search text. The query is mirrored to ?q= so
 * search links keep working. Without JavaScript the form still submits and
 * the full list is shown.
 */
export default function ArticleSearch() {
    const [query, setQuery] = useState('');
    const [visible, setVisible] = useState<number | null>(null);

    // Read ?q= once on mount (not via useSearchParams, so replaceState below
    // can't re-trigger this effect).
    useEffect(() => {
        const q = new URLSearchParams(window.location.search).get('q') || '';
        setQuery(q);
    }, []);

    useEffect(() => {
        const q = query.trim().toLowerCase();
        const cards = document.querySelectorAll<HTMLElement>('[data-search]');
        let shown = 0;
        cards.forEach((card) => {
            const match = !q || (card.dataset.search || '').includes(q);
            card.hidden = !match;
            if (match) shown++;
        });
        setVisible(q ? shown : null);

        const url = q ? `${window.location.pathname}?q=${encodeURIComponent(query.trim())}` : window.location.pathname;
        window.history.replaceState(null, '', url);
    }, [query]);

    return (
        <div className="mb-8">
            <form action="/articles" method="GET" role="search" className="relative max-w-md mx-auto" onSubmit={(e) => e.preventDefault()}>
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" aria-hidden="true" />
                <label htmlFor="article-search" className="sr-only">Search articles</label>
                <input
                    id="article-search"
                    type="search"
                    name="q"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search articles..."
                    className="w-full pl-12 pr-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/50 transition-colors"
                />
            </form>
            <p className="sr-only" role="status" aria-live="polite">
                {visible === null ? '' : `${visible} article${visible === 1 ? '' : 's'} found`}
            </p>
            {visible === 0 && (
                <div className="text-center py-16">
                    <Search className="w-12 h-12 mx-auto mb-4 text-zinc-600" aria-hidden="true" />
                    <p className="text-zinc-500">No articles match your search</p>
                </div>
            )}
        </div>
    );
}
