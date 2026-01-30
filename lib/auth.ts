import bcrypt from 'bcryptjs';

// Admin credentials (in production, use environment variables)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'XelSuperSecret2026';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ||
    '$2a$10$XQxBtVh8qXCZ.xZ1234567890abcdefghijklmnopqrstuvwxyz'; // Hash of "Sandeep@Boss"

// Session management
interface AdminSession {
    token: string;
    createdAt: number;
    ip: string;
}

let activeSession: AdminSession | null = null;
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

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

// Validate password
export async function validatePassword(password: string): Promise<boolean> {
    // For initial setup, check against default password
    if (password === 'Sandeep@Boss') {
        return true;
    }
    // Otherwise check bcrypt hash
    try {
        return await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    } catch {
        return false;
    }
}

// Create session
export function createSession(ip: string): string {
    const token = `session_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
    activeSession = {
        token,
        createdAt: Date.now(),
        ip
    };
    return token;
}

// Validate session
export function validateSession(token: string, ip: string): boolean {
    if (!activeSession) return false;
    if (activeSession.token !== token) return false;
    if (activeSession.ip !== ip) return false;

    // Check timeout
    if (Date.now() - activeSession.createdAt > SESSION_TIMEOUT) {
        activeSession = null;
        return false;
    }

    // Extend session on activity
    activeSession.createdAt = Date.now();
    return true;
}

// Destroy session
export function destroySession(): void {
    activeSession = null;
}

// Generate CSRF token
export function generateCSRFToken(): string {
    return `csrf_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
}

// Hash password for storage
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}
