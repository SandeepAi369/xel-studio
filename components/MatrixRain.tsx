'use client';

import { useEffect, useRef, useState } from 'react';

interface MatrixRainProps {
    className?: string;
    opacity?: number;
}

/**
 * Matrix Code Rain Component
 * Pure CSS/Canvas fallback for missing images
 * IMPORTANT: pointer-events: none ensures this never blocks clicks
 */
export default function MatrixRain({ className = '', opacity = 0.15 }: MatrixRainProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
        const charArray = chars.split('');
        const fontSize = 14;
        const columns = Math.floor(canvas.width / fontSize);
        const drops: number[] = Array(columns).fill(1);

        const draw = () => {
            ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#00FFAA';
            ctx.font = `${fontSize}px monospace`;

            for (let i = 0; i < drops.length; i++) {
                const char = charArray[Math.floor(Math.random() * charArray.length)];
                const x = i * fontSize;
                const y = drops[i] * fontSize;
                ctx.fillText(char, x, y);

                if (y > canvas.height && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i]++;
            }
        };

        const interval = setInterval(draw, 50);

        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className={`absolute inset-0 w-full h-full ${className}`}
            style={{ 
                opacity,
                pointerEvents: 'none' // CRITICAL: Never block clicks
            }}
            aria-hidden="true"
        />
    );
}

/**
 * CSS-only Matrix effect (lighter alternative)
 * Uses pseudo-element with katakana characters
 */
export function MatrixRainCSS({ className = '' }: { className?: string }) {
    return (
        <div
            className={`matrix-rain absolute inset-0 ${className}`}
            style={{ pointerEvents: 'none' }}
            aria-hidden="true"
        />
    );
}

/**
 * Image with Matrix fallback
 * Shows Matrix rain when image fails to load
 */
interface ImageWithFallbackProps {
    src: string;
    alt: string;
    className?: string;
}

export function ImageWithFallback({ src, alt, className = '' }: ImageWithFallbackProps) {
    const [showFallback, setShowFallback] = useState(false);
    const [loaded, setLoaded] = useState(false);

    return (
        <div className={`relative overflow-hidden ${className}`}>
            {showFallback && <MatrixRainCSS />}

            {!showFallback && (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                    onLoad={() => setLoaded(true)}
                    onError={() => setShowFallback(true)}
                />
            )}
        </div>
    );
}
