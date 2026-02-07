import { NextRequest, NextResponse } from 'next/server';
import {
    validateAccessToken,
    validatePassword,
    createSession,
    validateSession,
    destroySession,
    generateCSRFToken,
    isLockedOut,
    recordFailedAttempt,
    clearLoginAttempts
} from '@/lib/auth';
import {
    readDBAsync, writeDBAsync, initializeDB, generateId
} from '@/lib/db';
import { isVercel, isGitHubApiAvailable } from '@/lib/github-api';

// CORS headers for Vercel deployment
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Route segment config - force dynamic rendering (no caching)
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60; // Allow up to 60 seconds for GitHub API calls

// Handle OPTIONS preflight request (for CORS)
export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

// Main POST handler
export async function POST(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

    try {
        // Initialize database cache on first request
        await initializeDB();

        const body = await request.json();
        const { action, password, sessionToken, data, contentType, itemId } = body;

        // Handle login
        if (action === 'login') {
            // Check if IP is locked out
            const lockStatus = isLockedOut(ip);
            if (lockStatus.locked) {
                return NextResponse.json({
                    error: `Too many failed attempts. Try again in ${lockStatus.remainingTime} minutes.`
                }, { status: 429, headers: corsHeaders });
            }

            const isValid = await validatePassword(password);
            if (!isValid) {
                const attemptResult = recordFailedAttempt(ip);

                if (attemptResult.locked) {
                    return NextResponse.json({
                        error: 'Account locked for 15 minutes due to failed attempts.'
                    }, { status: 429, headers: corsHeaders });
                }

                return NextResponse.json({
                    error: `Invalid credentials. ${attemptResult.attemptsRemaining} attempts remaining.`
                }, { status: 401, headers: corsHeaders });
            }

            // Clear failed attempts on successful login
            clearLoginAttempts(ip);

            const session = createSession(ip);
            const csrf = generateCSRFToken();

            // Log login (fire-and-forget, don't block the response)
            try {
                const db = await readDBAsync();
                db.adminLogs.push({
                    id: generateId(),
                    action: 'login_success',
                    details: 'Admin logged in',
                    timestamp: new Date().toISOString(),
                    ip
                });
                if (db.adminLogs.length > 500) {
                    db.adminLogs = db.adminLogs.slice(-500);
                }
                writeDBAsync(db).catch(() => {}); // fire-and-forget
            } catch { /* ignore logging errors */ }

            return NextResponse.json({
                success: true,
                sessionToken: session,
                csrfToken: csrf,
                env: {
                    isVercel: isVercel(),
                    hasGitHubToken: isGitHubApiAvailable()
                }
            }, { headers: corsHeaders });
        }

        // All other actions require valid session
        if (!validateSession(sessionToken, ip)) {
            return NextResponse.json({ error: 'Session expired' }, { status: 401, headers: corsHeaders });
        }

        // Handle logout
        if (action === 'logout') {
            destroySession();
            return NextResponse.json({ success: true }, { headers: corsHeaders });
        }

        // =====================================================================
        // CONTENT OPERATIONS
        // All use SINGLE-WRITE pattern: read once, modify, log, write once
        // This cuts GitHub API calls in half and prevents race conditions
        // =====================================================================

        if (action === 'add') {
            try {
                // Single read from GitHub (force refresh for latest data)
                const db = await readDBAsync(true);
                let result;

                switch (contentType) {
                    case 'article':
                        result = {
                            ...data,
                            id: generateId(),
                            date: new Date().toISOString()
                        };
                        db.articles.unshift(result);
                        break;
                    case 'apk':
                        result = { ...data, id: generateId() };
                        db.apks.unshift(result);
                        break;
                    case 'aiLab':
                        result = { ...data, id: generateId() };
                        db.aiLabs.unshift(result);
                        break;
                    case 'securityTool':
                        result = { ...data, id: generateId() };
                        db.securityTools.unshift(result);
                        break;
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }

                // Add admin log in the SAME write (no double-write!)
                db.adminLogs.push({
                    id: generateId(),
                    action: 'add',
                    details: `Added ${contentType}: ${JSON.stringify(data).substring(0, 100)}`,
                    timestamp: new Date().toISOString(),
                    ip
                });
                if (db.adminLogs.length > 500) {
                    db.adminLogs = db.adminLogs.slice(-500);
                }

                // Single write to GitHub
                const success = await writeDBAsync(db);
                if (!success) {
                    return NextResponse.json({
                        error: 'Failed to save content',
                        details: isVercel() && !isGitHubApiAvailable()
                            ? 'GITHUB_TOKEN not configured on Vercel. Add it in Vercel Project Settings > Environment Variables.'
                            : 'Write to storage failed. Check server logs.'
                    }, { status: 500, headers: corsHeaders });
                }

                return NextResponse.json({
                    success: true,
                    data: result,
                    storage: isVercel() ? 'github' : 'filesystem'
                }, { headers: corsHeaders });

            } catch (writeError) {
                console.error('Write error:', writeError);
                return NextResponse.json({
                    error: 'Failed to save content',
                    details: writeError instanceof Error ? writeError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        if (action === 'update') {
            try {
                const db = await readDBAsync(true);
                let result = null;

                switch (contentType) {
                    case 'article': {
                        const idx = db.articles.findIndex(a => a.id === itemId);
                        if (idx !== -1) {
                            db.articles[idx] = { ...db.articles[idx], ...data };
                            result = db.articles[idx];
                        }
                        break;
                    }
                    case 'apk': {
                        const idx = db.apks.findIndex(a => a.id === itemId);
                        if (idx !== -1) {
                            db.apks[idx] = { ...db.apks[idx], ...data };
                            result = db.apks[idx];
                        }
                        break;
                    }
                    case 'aiLab': {
                        const idx = db.aiLabs.findIndex(a => a.id === itemId);
                        if (idx !== -1) {
                            db.aiLabs[idx] = { ...db.aiLabs[idx], ...data };
                            result = db.aiLabs[idx];
                        }
                        break;
                    }
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }

                if (!result) {
                    return NextResponse.json({ error: 'Item not found' }, { status: 404, headers: corsHeaders });
                }

                // Admin log in same write
                db.adminLogs.push({
                    id: generateId(),
                    action: 'update',
                    details: `Updated ${contentType} ${itemId}`,
                    timestamp: new Date().toISOString(),
                    ip
                });
                if (db.adminLogs.length > 500) {
                    db.adminLogs = db.adminLogs.slice(-500);
                }

                const success = await writeDBAsync(db);
                if (!success) {
                    return NextResponse.json({
                        error: 'Failed to update content',
                        details: 'Write to storage failed'
                    }, { status: 500, headers: corsHeaders });
                }

                return NextResponse.json({
                    success: true,
                    data: result,
                    storage: isVercel() ? 'github' : 'filesystem'
                }, { headers: corsHeaders });

            } catch (updateError) {
                console.error('Update error:', updateError);
                return NextResponse.json({
                    error: 'Failed to update content',
                    details: updateError instanceof Error ? updateError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        if (action === 'delete') {
            try {
                const db = await readDBAsync(true);
                let deleted = false;

                switch (contentType) {
                    case 'article': {
                        const len = db.articles.length;
                        db.articles = db.articles.filter(a => a.id !== itemId);
                        deleted = db.articles.length < len;
                        break;
                    }
                    case 'apk': {
                        const len = db.apks.length;
                        db.apks = db.apks.filter(a => a.id !== itemId);
                        deleted = db.apks.length < len;
                        break;
                    }
                    case 'aiLab': {
                        const len = db.aiLabs.length;
                        db.aiLabs = db.aiLabs.filter(a => a.id !== itemId);
                        deleted = db.aiLabs.length < len;
                        break;
                    }
                    case 'securityTool': {
                        const len = db.securityTools.length;
                        db.securityTools = db.securityTools.filter(t => t.id !== itemId);
                        deleted = db.securityTools.length < len;
                        break;
                    }
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }

                if (!deleted) {
                    return NextResponse.json({ error: 'Item not found' }, { status: 404, headers: corsHeaders });
                }

                // Admin log in same write
                db.adminLogs.push({
                    id: generateId(),
                    action: 'delete',
                    details: `Deleted ${contentType} ${itemId}`,
                    timestamp: new Date().toISOString(),
                    ip
                });
                if (db.adminLogs.length > 500) {
                    db.adminLogs = db.adminLogs.slice(-500);
                }

                const success = await writeDBAsync(db);
                if (!success) {
                    return NextResponse.json({ error: 'Delete failed - write error' }, { status: 500, headers: corsHeaders });
                }

                return NextResponse.json({ success: true }, { headers: corsHeaders });

            } catch (deleteError) {
                console.error('Delete error:', deleteError);
                return NextResponse.json({
                    error: 'Failed to delete content',
                    details: deleteError instanceof Error ? deleteError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        if (action === 'getData') {
            // Force refresh to always show latest data in admin panel
            const db = await readDBAsync(true);
            return NextResponse.json({
                articles: db.articles || [],
                apks: db.apks || [],
                aiLabs: db.aiLabs || [],
                securityTools: db.securityTools || [],
                downloadLogs: (db.downloadLogs || []).slice(-50),
                adminLogs: (db.adminLogs || []).slice(-50),
                env: {
                    isVercel: isVercel(),
                    hasGitHubToken: isGitHubApiAvailable()
                }
            }, { headers: corsHeaders });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders });

    } catch (error) {
        console.error('Admin API error:', error);
        return NextResponse.json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
    }
}

// Validate token endpoint
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token');

    if (!validateAccessToken(token)) {
        return NextResponse.json({ valid: false }, { headers: corsHeaders });
    }

    return NextResponse.json({
        valid: true,
        env: {
            isVercel: isVercel(),
            hasGitHubToken: isGitHubApiAvailable()
        }
    }, { headers: corsHeaders });
}
