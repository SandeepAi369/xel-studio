'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Custom scroll position restoration for Next.js App Router.
 * 
 * Saves scroll position to sessionStorage on route change,
 * restores it when navigating back via browser history.
 */
export default function ScrollRestoration() {
    const pathname = usePathname();
    const prevPathRef = useRef<string>(pathname);
    const isPopStateRef = useRef(false);

    useEffect(() => {
        // Detect back/forward navigation
        const handlePopState = () => {
            isPopStateRef.current = true;
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        // Save scroll position of the page we're leaving
        if (prevPathRef.current !== pathname) {
            const key = `scroll:${prevPathRef.current}`;
            sessionStorage.setItem(key, String(window.scrollY));
        }

        // Restore scroll position if this is a back/forward navigation
        if (isPopStateRef.current) {
            const key = `scroll:${pathname}`;
            const saved = sessionStorage.getItem(key);

            if (saved !== null) {
                const scrollY = parseInt(saved, 10);
                // Use requestAnimationFrame + timeout to wait for content to render
                const restore = () => {
                    requestAnimationFrame(() => {
                        window.scrollTo(0, scrollY);
                    });
                };
                // Try multiple times as content may load asynchronously
                restore();
                setTimeout(restore, 100);
                setTimeout(restore, 300);
                setTimeout(restore, 600);
            }

            isPopStateRef.current = false;
        } else {
            // Forward navigation — scroll to top
            window.scrollTo(0, 0);
        }

        prevPathRef.current = pathname;
    }, [pathname]);

    return null;
}
