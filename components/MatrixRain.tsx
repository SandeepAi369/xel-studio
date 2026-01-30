'use client';

import { useEffect, useRef, useState } from 'react';

interface MatrixRainProps {
    className?: string;
    opacity?: number;
}

/**
 * Matrix Code Rain Component
 * Pure CSS/Canvas fallback for missing images
 * Displays katakana characters falling like digital rain
 */
export default function MatrixRain({ className = '', opacity = 0.15 }: MatrixRainProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        const resize = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        // Katakana characters
        const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
        const charArray = chars.split('');

        const fontSize = 14;
        const columns = Math.floor(canvas.width / fontSize);

        // Drop positions for each column
        const drops: number[] = Array(columns).fill(1);

        // Animation
        const draw = () => {
            // Semi-transparent black for trail effect
            ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Green neon text
            ctx.fillStyle = '#00FFAA';
            ctx.font = `${fontSize}px monospace`;

            for (let i = 0; i < drops.length; i++) {
                const char = charArray[Math.floor(Math.random() * charArray.length)];
                const x = i * fontSize;
                const y = drops[i] * fontSize;

                ctx.fillText(char, x, y);

                // Reset drop randomly
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
            style={{ opacity }}
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
    const imgRef = useRef<HTMLImageElement>(null);
    const [showFallback, setShowFallback] = useState(false);
    const [loaded, setLoaded] = useState(false);

    return (
        <div className={`relative overflow-hidden ${className}`}>
            {showFallback && <MatrixRainCSS />}

            {!showFallback && (
                <img
                    ref={imgRef}
                    src={src}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'
                        }`}
                    onLoad={() => setLoaded(true)}
                    onError={() => setShowFallback(true)}
                />
            )}
        </div>
    );
}
