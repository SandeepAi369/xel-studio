'use client';

import { usePathname } from 'next/navigation';

/**
 * Aesthetic 2-second intro loader (purely visual).
 *
 * The page underneath is fully server-rendered and cached at the edge; this
 * overlay only covers it for 2 s and then fades out with a CSS animation
 * (works without JavaScript). Content is never hidden from the DOM, so AI
 * readers, scrapers and screen readers get the full page immediately.
 *
 * - Keyed by pathname: replays on every page navigation.
 * - A click skips it. The logo is a CSS pseudo-element (no text in the DOM).
 * - Not rendered on /xel-admin; hidden by CSS for prefers-reduced-motion.
 */
export default function IntroLoader() {
    const pathname = usePathname();
    if (pathname?.startsWith('/xel-admin')) return null;

    return (
        <div
            key={pathname}
            className="xel-intro"
            aria-hidden="true"
            onClick={(e) => e.currentTarget.classList.add('xel-intro--done')}
        >
            <div className="xel-intro__core">
                <span className="xel-intro__ring" />
                <span className="xel-intro__ring xel-intro__ring--2" />
                <span className="xel-intro__mark" />
            </div>
            <div className="xel-intro__bar"><span /></div>
        </div>
    );
}
