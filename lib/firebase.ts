import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Lazy initialization — only initialize when actually used (client-side)
// This prevents build crashes when env vars aren't set yet
function getApp(): FirebaseApp {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp(firebaseConfig);
}

// Lazy getters — Firebase only initializes when these are accessed
export const auth: Auth = typeof window !== 'undefined' ? getAuth(getApp()) : ({} as Auth);
export const db: Firestore = typeof window !== 'undefined' ? getFirestore(getApp()) : ({} as Firestore);
export const googleProvider = typeof window !== 'undefined' ? new GoogleAuthProvider() : ({} as GoogleAuthProvider);

export default typeof window !== 'undefined' ? getApp() : ({} as FirebaseApp);
