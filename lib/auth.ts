import bcrypt from 'bcryptjs';
import { createHmac, randomBytes } from 'crypto';

// Admin credentials — read from environment variables
// Set these in Vercel (xel-studio) and in .env.local for local dev
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Session config
// Stateless signed tokens - works across ALL Vercel serverless instances
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes (extended for reliability)

function getSessionSecret(): string {
    if (!SESSION_SECRET) {
        throw new Error('SESSION_SECRET env var is required for secure session management');
    }
    return SESSION_SECRET;
}

// Login attempt tracking - Shadow Integration security
interface LoginAttempt {
    count: number;
    firstAttempt: number;
    lockedUntil: number | null;
}

const loginAttempts: Map<string, LoginAttempt> = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW = 30 * 60 * 1000; // 30 minute window for tracking attempts

// Check if IP is locked out
export function isLockedOut(ip: string): { locked: boolean; remainingTime?: number } {
    const attempt = loginAttempts.get(ip);
    if (!attempt) return { locked: false };

    if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
        return {
            locked: true,
            remainingTime: Math.ceil((attempt.lockedUntil - Date.now()) / 1000 / 60)
        };
    }

    // Reset if lockout has expired
    if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
        loginAttempts.delete(ip);
        return { locked: false };
    }

    return { locked: false };
}

// Record failed login attempt
export function recordFailedAttempt(ip: string): { locked: boolean; attemptsRemaining: number } {
    const now = Date.now();
    let attempt = loginAttempts.get(ip);

    if (!attempt) {
        attempt = { count: 1, firstAttempt: now, lockedUntil: null };
    } else {
        // Reset if outside attempt window
        if (now - attempt.firstAttempt > ATTEMPT_WINDOW) {
            attempt = { count: 1, firstAttempt: now, lockedUntil: null };
        } else {
            attempt.count++;
        }
    }

    // Lock if max attempts reached
    if (attempt.count >= MAX_ATTEMPTS) {
        attempt.lockedUntil = now + LOCKOUT_DURATION;
        loginAttempts.set(ip, attempt);
        return { locked: true, attemptsRemaining: 0 };
    }

    loginAttempts.set(ip, attempt);
    return { locked: false, attemptsRemaining: MAX_ATTEMPTS - attempt.count };
}

// Clear login attempts on successful login
export function clearLoginAttempts(ip: string): void {
    loginAttempts.delete(ip);
}

// Validate access token
export function validateAccessToken(token: string | null): boolean {
    return token === ADMIN_TOKEN;
}

// Validate password - bcrypt when hashed, plaintext fallback
export async function validatePassword(password: string): Promise<boolean> {
    if (!ADMIN_PASSWORD) return false;
    // If stored password is a bcrypt hash, compare securely
    if (ADMIN_PASSWORD.startsWith('$2')) {
        return bcrypt.compare(password, ADMIN_PASSWORD);
    }
    // Fallback: plaintext comparison (for backward compatibility)
    return password === ADMIN_PASSWORD;
}

// =====================================================================
// STATELESS SESSION MANAGEMENT
// Uses cryptographically signed tokens (HMAC-SHA256)
// Works across ALL Vercel serverless instances - no in-memory state needed
// =====================================================================

// Create session - returns a cryptographically signed token
export function createSession(_ip: string): string {
    const payload = JSON.stringify({
        ts: Date.now(),
        n: randomBytes(8).toString('hex')
    });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

// Validate session - verifies signature and checks timeout
// Stateless: works on ANY serverless instance without shared memory
export function validateSession(token: string, _ip: string): boolean {
    try {
        if (!token || typeof token !== 'string') return false;

        const dotIndex = token.indexOf('.');
        if (dotIndex === -1) return false;

        const payloadB64 = token.substring(0, dotIndex);
        const sig = token.substring(dotIndex + 1);

        // Verify signature
        const expectedSig = createHmac('sha256', getSessionSecret())
            .update(payloadB64)
            .digest('base64url');
        if (sig !== expectedSig) return false;

        // Verify not expired
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        if (Date.now() - payload.ts > SESSION_TIMEOUT) return false;

        return true;
    } catch {
        return false;
    }
}

// Destroy session - stateless tokens auto-expire after SESSION_TIMEOUT
export function destroySession(): void {
    // No server-side state to clear
    // Client will clear token and redirect to login
}

// Generate CSRF token
export function generateCSRFToken(): string {
    return `csrf_${Date.now()}_${randomBytes(8).toString('hex')}`;
}

// Hash password for storage
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}
