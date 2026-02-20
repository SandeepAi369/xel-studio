'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * YouTube-style top loading bar.
 * Shows a thin animated progress bar at the very top of the viewport
 * during route transitions — replaces the old round spinner pattern.
 */
export default function TopLoader() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [progress, setProgress] = useState(0);
    const [visible, setVisible] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const prevPathRef = useRef(pathname);

    const startLoading = useCallback(() => {
        setVisible(true);
        setProgress(0);

        // Simulate progress — fast initially, then slows down
        let p = 0;
        timerRef.current = setInterval(() => {
            p += Math.random() * 15;
            if (p > 90) p = 90; // never reach 100 until route completes
            setProgress(p);
        }, 150);
    }, []);

    const completeLoading = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setProgress(100);
        setTimeout(() => {
            setVisible(false);
            setProgress(0);
        }, 300);
    }, []);

    // Start loading on navigation
    useEffect(() => {
        // Intercept link clicks to start the bar immediately
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const anchor = target.closest('a');
            if (!anchor) return;

            const href = anchor.getAttribute('href');
            if (!href) return;

            // Skip external links, hash links, and same-page links
            if (
                href.startsWith('http') ||
                href.startsWith('#') ||
                href.startsWith('mailto:') ||
                anchor.target === '_blank'
            ) return;

            // Only start if navigating to a different page
            if (href !== pathname) {
                startLoading();
            }
        };

        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, [pathname, startLoading]);

    // Complete loading when route changes
    useEffect(() => {
        if (pathname !== prevPathRef.current) {
            completeLoading();
            prevPathRef.current = pathname;
        }
    }, [pathname, searchParams, completeLoading]);

    // Cleanup
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    if (!visible) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] bg-transparent pointer-events-none">
            <div
                className="h-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)] transition-all duration-200 ease-out"
                style={{ width: `${progress}%` }}
            />
            {/* Glow pulse at the tip */}
            {progress > 0 && progress < 100 && (
                <div
                    className="absolute top-0 right-0 h-full w-24 bg-gradient-to-l from-emerald-400/50 to-transparent animate-pulse"
                    style={{ right: `${100 - progress}%` }}
                />
            )}
        </div>
    );
}
