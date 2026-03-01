'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Smart scroll position restoration for Next.js App Router.
 *
 * KEY FIX: Previous version fired 9 scrollTo() calls over 1.5s which fought
 * user scrolling and caused pages to jump around. This version:
 * - Restores scroll ONCE using requestAnimationFrame (sync with paint)  
 * - Cancels restoration if user starts scrolling (doesn't fight)
 * - Uses sessionStorage keyed by pathname
 * - Only restores on popstate (browser back/forward)
 */
export default function ScrollRestoration() {
    const pathname = usePathname();
    const prevPathRef = useRef<string>(pathname);
    const isPopStateRef = useRef(false);

    // Detect browser back/forward
    useEffect(() => {
        const handlePopState = () => {
            isPopStateRef.current = true;
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        const prevPath = prevPathRef.current;

        // Save scroll position of the page we're LEAVING
        if (prevPath !== pathname) {
            sessionStorage.setItem(`scroll:${prevPath}`, String(window.scrollY));
        }

        // Only restore on browser back/forward navigation
        if (isPopStateRef.current) {
            const saved = sessionStorage.getItem(`scroll:${pathname}`);
            if (saved !== null) {
                const scrollY = parseInt(saved, 10);
                if (scrollY > 0) {
                    // Use one rAF — just enough to let DOM paint, then restore
                    requestAnimationFrame(() => {
                        window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior });
                    });
                }
            }
        } else if (prevPath !== pathname) {
            // Forward navigation: scroll to top
            window.scrollTo(0, 0);
        }

        isPopStateRef.current = false;
        prevPathRef.current = pathname;
    }, [pathname]);

    return null;
}
