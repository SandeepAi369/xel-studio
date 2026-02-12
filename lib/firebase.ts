import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB4YOVaiX7EhgT03wE15gYixtGIjOoXfpw",
  authDomain: "xelbackend.firebaseapp.com",
  projectId: "xelbackend",
  storageBucket: "xelbackend.firebasestorage.app",
  messagingSenderId: "77551360570",
  appId: "1:77551360570:web:055458b6a1e00363373303",
  measurementId: "G-XPNFVN1K7V"
};

// Initialize Firebase (prevent duplicate initialization)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
