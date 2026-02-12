'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { LogOut, User, LayoutDashboard } from 'lucide-react';

export default function LoginButton() {
    const { user, loading, signInWithGoogle, signOut } = useAuth();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (loading) {
        return (
            <div className="w-9 h-9 rounded-full bg-zinc-800 animate-pulse" />
        );
    }

    // Not logged in — show Sign In button
    if (!user) {
        return (
            <button
                onClick={signInWithGoogle}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                           bg-white/5 border border-white/10 text-zinc-300
                           hover:bg-white/10 hover:border-white/20 hover:text-white
                           backdrop-blur-md transition-all duration-200 cursor-pointer"
            >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign In
            </button>
        );
    }

    // Logged in — show profile picture with dropdown
    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-transparent
                           hover:border-purple-500/50 transition-all duration-200 cursor-pointer
                           ring-0 hover:ring-2 hover:ring-purple-500/20"
            >
                {user.photoURL ? (
                    <img
                        src={user.photoURL}
                        alt={user.displayName || 'Profile'}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <div className="w-full h-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold">
                        {user.displayName?.charAt(0) || 'U'}
                    </div>
                )}
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl overflow-hidden z-50
                                bg-zinc-900/80 backdrop-blur-xl border border-white/10
                                shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.05)]
                                animate-in fade-in slide-in-from-top-2 duration-200">

                    {/* User Info Header */}
                    <div className="px-4 py-3 border-b border-white/5">
                        <div className="flex items-center gap-3">
                            {user.photoURL ? (
                                <img
                                    src={user.photoURL}
                                    alt=""
                                    className="w-10 h-10 rounded-full"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold">
                                    {user.displayName?.charAt(0) || 'U'}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate">
                                    {user.displayName}
                                </p>
                                <p className="text-xs text-zinc-400 truncate">
                                    {user.email}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Menu Items */}
                    <div className="p-1.5">
                        <button
                            onClick={() => { setDropdownOpen(false); router.push('/dashboard'); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-300
                                       hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                        >
                            <LayoutDashboard className="w-4 h-4 text-purple-400" />
                            Dashboard
                        </button>
                        <button
                            onClick={() => { setDropdownOpen(false); router.push('/dashboard'); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-300
                                       hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                        >
                            <User className="w-4 h-4 text-cyan-400" />
                            Profile
                        </button>
                        <div className="my-1 border-t border-white/5" />
                        <button
                            onClick={() => { setDropdownOpen(false); signOut(); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400
                                       hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer"
                        >
                            <LogOut className="w-4 h-4" />
                            Sign Out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
