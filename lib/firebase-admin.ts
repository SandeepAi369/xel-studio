/**
 * Firebase Admin SDK — Server-side Firestore access
 * Used by API routes (cron, etc.) to read/write Firestore
 */

import { initializeApp, getApps, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getFirebaseAdmin() {
    if (getApps().length > 0) {
        return getFirestore();
    }

    // Option 1: Service account JSON from env var (for Vercel)
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
        try {
            const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
            initializeApp({ credential: cert(serviceAccount) });
            return getFirestore();
        } catch (e) {
            console.error('Invalid FIREBASE_SERVICE_ACCOUNT JSON:', e);
        }
    }

    // Option 2: Individual credential env vars
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
        initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
        });
        return getFirestore();
    }

    // Option 3: Default credentials (for local dev with gcloud auth)
    initializeApp({ projectId: projectId || 'xelbackend' });
    return getFirestore();
}

export const adminDb = getFirebaseAdmin();
