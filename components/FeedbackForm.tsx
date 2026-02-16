'use client';

import { useState, useCallback } from 'react';
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

    // Pre-fill name from Firebase user when form opens
    if (user && !nameInitialized) {
        setName(user.displayName || '');
        setNameInitialized(true);
    }

    // ─── Submit Feedback via API ──────────────────────────────
    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !message.trim() || !name.trim()) return;

        setStatus('submitting');
        setErrorMsg('');

        try {
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

            const data = await res.json();

            if (!res.ok || data.error) {
                setStatus('error');
                setErrorMsg(data.error || 'Failed to send feedback');
            } else {
                setStatus('success');
                setMessage('');
                setTimeout(() => {
                    setStatus('idle');
                    setIsOpen(false);
                }, 3000);
            }
        } catch {
            setStatus('error');
            setErrorMsg('Network error. Please try again.');
        }
    }, [user, name, message]);

    return (
        <section className="max-w-2xl mx-auto px-4 py-12">
            {/* ─── Trigger Button (always visible) ───────────── */}
            {!isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                >
                    <button
                        onClick={() => setIsOpen(true)}
                        className="inline-flex items-center gap-2.5 px-6 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-400 font-medium rounded-xl transition-all"
                        aria-label="Open feedback form"
                    >
                        <MessageSquare className="w-5 h-5" />
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
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <MessageSquare className="w-6 h-6 text-emerald-400" />
                                <h2 className="text-xl font-bold text-white">Share Your Feedback</h2>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800"
                                aria-label="Close feedback form"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 backdrop-blur-md">
                            {/* ─── Not Signed In ─────────────── */}
                            {!user && (
                                <div className="text-center py-6">
                                    <p className="text-zinc-400 mb-6 text-sm">
                                        Sign in with Google to share your feedback
                                    </p>
                                    <button
                                        onClick={signInWithGoogle}
                                        className="inline-flex items-center gap-2.5 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors"
                                        aria-label="Sign in with Google to submit feedback"
                                    >
                                        <LogIn className="w-4 h-4" />
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
                                                alt=""
                                                className="w-8 h-8 rounded-full flex-shrink-0"
                                                referrerPolicy="no-referrer"
                                            />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                                {name.charAt(0) || 'U'}
                                            </div>
                                        )}
                                        <span className="text-sm text-zinc-300 truncate">
                                            {user.email}
                                        </span>
                                    </div>

                                    <form onSubmit={handleSubmit} className="space-y-5">
                                        {/* Name Field */}
                                        <div>
                                            <label htmlFor="feedback-name" className="block text-sm font-medium text-zinc-300 mb-1.5">
                                                What should we call you?
                                            </label>
                                            <input
                                                id="feedback-name"
                                                type="text"
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="Your preferred name"
                                                required
                                                aria-label="Your preferred name for feedback"
                                                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
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
                                                aria-label="Your feedback message"
                                                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors resize-none"
                                            />
                                        </div>

                                        {/* Status Messages */}
                                        <AnimatePresence mode="wait">
                                            {status === 'success' && (
                                                <motion.div
                                                    key="success"
                                                    initial={{ opacity: 0, y: -5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -5 }}
                                                    className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm"
                                                >
                                                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                                    Thank you! Your feedback has been sent.
                                                </motion.div>
                                            )}
                                            {status === 'error' && (
                                                <motion.div
                                                    key="error"
                                                    initial={{ opacity: 0, y: -5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -5 }}
                                                    className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm"
                                                >
                                                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                                    {errorMsg || 'Something went wrong. Please try again.'}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        {/* Submit Button */}
                                        <button
                                            type="submit"
                                            disabled={status === 'submitting' || !message.trim() || !name.trim()}
                                            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                                            aria-label="Submit your feedback"
                                        >
                                            {status === 'submitting' ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    Sending...
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="w-4 h-4" />
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
