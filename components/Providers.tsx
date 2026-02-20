'use client';

import { AuthProvider } from '@/lib/AuthContext';
import ScrollRestoration from '@/components/ScrollRestoration';
import { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
    return (
        <AuthProvider>
            <ScrollRestoration />
            {children}
        </AuthProvider>
    );
}
