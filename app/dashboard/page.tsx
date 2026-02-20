'use client';

import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Shield, Clock, Mail } from 'lucide-react';

export default function DashboardPage() {
    const { user, loading } = useAuth();
    const router = useRouter();

    // Redirect to home if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            router.push('/');
        }
    }, [user, loading, router]);

    // Loading state
    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-800 animate-pulse" />
                    <div className="w-32 h-4 rounded bg-zinc-800 animate-pulse" />
                    <div className="w-24 h-3 rounded bg-zinc-800/60 animate-pulse" />
                </div>
            </div>
        );
    }

    // Not logged in (will redirect)
    if (!user) return null;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* Header */}
            <div className="border-b border-white/5">
                <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-sm">Back</span>
                    </button>
                    <h1 className="text-sm font-medium text-zinc-500">Dashboard</h1>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-12">
                {/* Welcome Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="flex items-center gap-6 mb-12"
                >
                    {user.photoURL ? (
                        <img
                            src={user.photoURL}
                            alt={user.displayName || 'Profile'}
                            className="w-20 h-20 rounded-2xl border-2 border-purple-500/30 shadow-lg shadow-purple-500/10"
                            referrerPolicy="no-referrer"
                        />
                    ) : (
                        <div className="w-20 h-20 rounded-2xl bg-purple-600 flex items-center justify-center text-3xl font-bold">
                            {user.displayName?.charAt(0) || 'U'}
                        </div>
                    )}
                    <div>
                        <motion.h2
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.2 }}
                            className="text-2xl md:text-3xl font-bold"
                        >
                            Welcome back,{' '}
                            <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                                {user.displayName?.split(' ')[0] || 'User'}
                            </span>
                        </motion.h2>
                        <p className="text-zinc-500 mt-1 text-sm">
                            Signed in as {user.email}
                        </p>
                    </div>
                </motion.div>

                {/* Info Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="p-6 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md"
                    >
                        <Mail className="w-5 h-5 text-cyan-400 mb-3" />
                        <p className="text-xs text-zinc-500 mb-1">Email</p>
                        <p className="text-sm text-zinc-200 truncate">{user.email}</p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="p-6 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md"
                    >
                        <Shield className="w-5 h-5 text-purple-400 mb-3" />
                        <p className="text-xs text-zinc-500 mb-1">Account ID</p>
                        <p className="text-sm text-zinc-200 font-mono truncate">{user.uid}</p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="p-6 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md"
                    >
                        <Clock className="w-5 h-5 text-green-400 mb-3" />
                        <p className="text-xs text-zinc-500 mb-1">Provider</p>
                        <p className="text-sm text-zinc-200">Google</p>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
