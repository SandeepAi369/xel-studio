'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * YouTube-style top progress bar — a thin glowing line at the top edge.
 *
 * - Starts ONLY when the user actively clicks an internal link to another
 *   page. Never on the initial page load, and never on browser back/forward
 *   (those don't produce link clicks).
 * - Visible for at least MIN_MS (1 s), then completes and fades out. Purely
 *   visual: navigation and content are never delayed.
 * - Ignores new-tab/modified clicks, external/hash/mailto/download links and
 *   same-page links; a safety timeout clears it if a click never navigates.
 */
const MIN_MS = 1000;
const SAFETY_MS = 8000;

type Phase = 'idle' | 'running' | 'finishing';

export default function TopLoader() {
    const pathname = usePathname();
    const [phase, setPhase] = useState<Phase>('idle');
    const [width, setWidth] = useState(0);
    const startedAt = useRef(0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const prevPath = useRef(pathname);

    const clearTimers = () => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
    };

    const finish = () => {
        clearTimers();
        const wait = Math.max(0, MIN_MS - (Date.now() - startedAt.current));
        timers.current.push(setTimeout(() => {
            setPhase('finishing');
            setWidth(100);
            timers.current.push(setTimeout(() => { setPhase('idle'); setWidth(0); }, 450));
        }, wait));
    };

    // Start on active link clicks only
    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            // Note: don't check e.defaultPrevented — Next.js <Link> prevents the
            // default on every client navigation it handles.
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const anchor = (e.target as HTMLElement | null)?.closest('a');
            if (!anchor || anchor.hasAttribute('download')) return;
            if (anchor.target && anchor.target !== '_self') return;
            const href = anchor.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
            let url: URL;
            try { url = new URL(href, window.location.href); } catch { return; }
            if (url.origin !== window.location.origin) return;
            if (url.pathname === window.location.pathname) return;

            clearTimers();
            startedAt.current = Date.now();
            setPhase('running');
            setWidth(0);
            // Next frame: grow toward 85% over MIN_MS (CSS transition)
            requestAnimationFrame(() => requestAnimationFrame(() => setWidth(85)));
            timers.current.push(setTimeout(finish, SAFETY_MS));
        };
        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Route changed: complete the bar (only if a click started it)
    useEffect(() => {
        if (pathname === prevPath.current) return;
        prevPath.current = pathname;
        if (phase === 'running') finish();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    useEffect(() => clearTimers, []);

    if (phase === 'idle') return null;

    return (
        <div className="xel-topbar" aria-hidden="true" data-phase={phase}>
            <div className="xel-topbar__fill" style={{ width: `${width}%` }} />
        </div>
    );
}
