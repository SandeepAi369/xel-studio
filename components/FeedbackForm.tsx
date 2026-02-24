'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, LogIn, CheckCircle, AlertTriangle, X } from 'lucide-react';

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

export default function FeedbackForm() {
    const { user, signInWithGoogle } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [name, setName] = useState('');
    const [nameInitialized, setNameInitialized] = useState(false);
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState<FormStatus>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const nameInputRef = useRef<HTMLInputElement>(null);
    const triggerBtnRef = useRef<HTMLButtonElement>(null);

    // Pre-fill name from Firebase user when available
    useEffect(() => {
        if (user && !nameInitialized) {
            setName(user.displayName || '');
            setNameInitialized(true);
        }
    }, [user, nameInitialized]);

    // Focus management: move focus to name input when form opens
    useEffect(() => {
        if (isOpen && user && nameInputRef.current) {
            nameInputRef.current.focus();
        }
    }, [isOpen, user]);

    // Handle close — return focus to trigger button
    const handleClose = useCallback(() => {
        setIsOpen(false);
        setTimeout(() => triggerBtnRef.current?.focus(), 100);
    }, []);

    // Handle Escape key to close form
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, handleClose]);

    // ─── Submit Feedback via API ──────────────────────────────
    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !message.trim() || !name.trim()) return;

        setStatus('submitting');
        setErrorMsg('');

        try {
            const sendFeedback = async () => {
                const res = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: message.trim(),
                        user_name: name.trim(),
                        user_email: user.email,
                        user_id: user.uid,
                    }),
                });
                return res;
            };

            let res = await sendFeedback();

            // Retry once if 404 (dev mode cold-start)
            if (res.status === 404) {
                await new Promise(r => setTimeout(r, 500));
                res = await sendFeedback();
            }

            const data = await res.json();

            if (!res.ok || data.error) {
                setStatus('error');
                setErrorMsg(data.error || 'Failed to send feedback');
            } else {
                setStatus('success');
                setMessage('');
                setTimeout(() => {
                    setStatus('idle');
                    handleClose();
                }, 3000);
            }
        } catch {
            setStatus('error');
            setErrorMsg('Network error. Please try again.');
        }
    }, [user, name, message, handleClose]);

    return (
        <section
            className="max-w-2xl mx-auto px-4 py-12"
            aria-label="User feedback"
        >
            {/* ─── Trigger Button (always visible) ───────────── */}
            {!isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                >
                    <button
                        ref={triggerBtnRef}
                        onClick={() => setIsOpen(true)}
                        className="inline-flex items-center gap-2.5 px-6 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-400 font-medium rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
                        aria-label="Open feedback form"
                    >
                        <MessageSquare className="w-5 h-5" aria-hidden="true" />
                        Send Feedback
                    </button>
                </motion.div>
            )}

            {/* ─── Expanded Form (on click) ──────────────────── */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="feedback-panel"
                        initial={{ opacity: 0, y: 20, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: 'auto' }}
                        exit={{ opacity: 0, y: 20, height: 0 }}
                        transition={{ duration: 0.3 }}
                        role="region"
                        aria-label="Feedback form"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <MessageSquare className="w-6 h-6 text-emerald-400" aria-hidden="true" />
                                <h2 id="feedback-heading" className="text-xl font-bold text-white">Share Your Feedback</h2>
                            </div>
                            <button
                                onClick={handleClose}
                                className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                aria-label="Close feedback form"
                            >
                                <X className="w-5 h-5" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 backdrop-blur-md">
                            {/* ─── Not Signed In ─────────────── */}
                            {!user && (
                                <div className="text-center py-6" role="alert">
                                    <p className="text-zinc-400 mb-6 text-sm">
                                        Sign in with Google to share your feedback
                                    </p>
                                    <button
                                        onClick={signInWithGoogle}
                                        className="inline-flex items-center gap-2.5 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
                                        aria-label="Sign in with Google to submit feedback"
                                    >
                                        <LogIn className="w-4 h-4" aria-hidden="true" />
                                        Sign in with Google
                                    </button>
                                </div>
                            )}

                            {/* ─── Signed In — Form ──────────── */}
                            {user && (
                                <>
                                    {/* User Info Bar */}
                                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-800">
                                        {user.photoURL ? (
                                            <img
                                                src={user.photoURL}
                                                alt={`${user.displayName || 'User'} profile picture`}
                                                className="w-8 h-8 rounded-full flex-shrink-0"
                                                referrerPolicy="no-referrer"
                                            />
                                        ) : (
                                            <div
                                                className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-sm font-bold flex-shrink-0"
                                                role="img"
                                                aria-label={`${name || 'User'} avatar`}
                                            >
                                                {name.charAt(0) || 'U'}
                                            </div>
                                        )}
                                        <span className="text-sm text-zinc-300 truncate">
                                            {user.email}
                                        </span>
                                    </div>

                                    <form
                                        onSubmit={handleSubmit}
                                        className="space-y-5"
                                        aria-labelledby="feedback-heading"
                                    >
                                        {/* Name Field */}
                                        <div>
                                            <label htmlFor="feedback-name" className="block text-sm font-medium text-zinc-300 mb-1.5">
                                                What should we call you?
                                            </label>
                                            <input
                                                ref={nameInputRef}
                                                id="feedback-name"
                                                type="text"
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="Your preferred name"
                                                required
                                                aria-required="true"
                                                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30 transition-colors"
                                            />
                                        </div>

                                        {/* Message Field */}
                                        <div>
                                            <label htmlFor="feedback-message" className="block text-sm font-medium text-zinc-300 mb-1.5">
                                                Your feedback
                                            </label>
                                            <textarea
                                                id="feedback-message"
                                                value={message}
                                                onChange={(e) => setMessage(e.target.value)}
                                                placeholder="Tell us what you think, suggest improvements, or share your experience..."
                                                required
                                                rows={4}
                                                aria-required="true"
                                                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30 transition-colors resize-none"
                                            />
                                        </div>

                                        {/* Status Messages — Live Region for screen readers */}
                                        <div aria-live="polite" aria-atomic="true">
                                            <AnimatePresence mode="wait">
                                                {status === 'success' && (
                                                    <motion.div
                                                        key="success"
                                                        initial={{ opacity: 0, y: -5 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, y: -5 }}
                                                        role="status"
                                                        className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm"
                                                    >
                                                        <CheckCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                                        Thank you! Your feedback has been sent.
                                                    </motion.div>
                                                )}
                                                {status === 'error' && (
                                                    <motion.div
                                                        key="error"
                                                        initial={{ opacity: 0, y: -5 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, y: -5 }}
                                                        role="alert"
                                                        className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm"
                                                    >
                                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                                        {errorMsg || 'Something went wrong. Please try again.'}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>

                                        {/* Submit Button */}
                                        <button
                                            type="submit"
                                            disabled={status === 'submitting' || !message.trim() || !name.trim()}
                                            aria-disabled={status === 'submitting' || !message.trim() || !name.trim()}
                                            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
                                            aria-label={status === 'submitting' ? 'Sending your feedback...' : 'Submit your feedback'}
                                        >
                                            {status === 'submitting' ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" role="status" aria-label="Loading" />
                                                    Sending...
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="w-4 h-4" aria-hidden="true" />
                                                    Send Feedback
                                                </>
                                            )}
                                        </button>
                                    </form>
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
