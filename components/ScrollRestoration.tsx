'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Custom scroll position restoration for Next.js App Router.
 *
 * Saves scroll position to sessionStorage on route change,
 * restores it when navigating back via browser history OR
 * when returning to a previously visited page.
 */
export default function ScrollRestoration() {
    const pathname = usePathname();
    const prevPathRef = useRef<string>(pathname);
    const isPopStateRef = useRef(false);
    const visitedPagesRef = useRef<Set<string>>(new Set());

    // Track visited pages to know when we're "going back" to a page
    useEffect(() => {
        visitedPagesRef.current.add(pathname);
    }, [pathname]);

    useEffect(() => {
        const handlePopState = () => {
            isPopStateRef.current = true;
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const restoreScroll = useCallback((scrollY: number) => {
        // Aggressively restore scroll — retry many times to beat async loading & animations
        const attempts = [0, 50, 100, 200, 350, 500, 750, 1000, 1500];
        attempts.forEach((delay) => {
            setTimeout(() => {
                window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior });
            }, delay);
        });
    }, []);

    useEffect(() => {
        const prevPath = prevPathRef.current;

        // Save scroll position of the page we're leaving
        if (prevPath !== pathname) {
            const key = `scroll:${prevPath}`;
            sessionStorage.setItem(key, String(window.scrollY));
        }

        // Check if going back (popstate OR returning to a previously visited page)
        const isGoingBack = isPopStateRef.current || visitedPagesRef.current.has(pathname);
        const key = `scroll:${pathname}`;
        const saved = sessionStorage.getItem(key);

        if (isGoingBack && saved !== null) {
            const scrollY = parseInt(saved, 10);
            if (scrollY > 0) {
                restoreScroll(scrollY);
            }
        } else if (!isPopStateRef.current) {
            // Only scroll to top on genuinely new forward navigation
            window.scrollTo(0, 0);
        }

        isPopStateRef.current = false;
        prevPathRef.current = pathname;
    }, [pathname, restoreScroll]);

    return null;
}
