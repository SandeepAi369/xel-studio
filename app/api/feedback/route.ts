import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import '@/lib/firebase-admin'; // initializes the Firebase Admin app (side effect)
import { getAuth } from 'firebase-admin/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CONTENT_CHARS = 5_000;
const MAX_NAME_CHARS = 100;

// ─── POST: Submit feedback (from Firebase-authed users) ───────
// The user's identity comes from their verified Firebase ID token, never
// from the request body (which anyone could fake).
export async function POST(request: NextRequest) {
    try {
        const idToken = request.headers.get('authorization')?.replace(/^Bearer /, '');
        if (!idToken) {
            return NextResponse.json({ error: 'Please sign in to send feedback.' }, { status: 401 });
        }
        let uid: string, email: string;
        try {
            const decoded = await getAuth().verifyIdToken(idToken);
            uid = decoded.uid;
            email = decoded.email || '';
        } catch {
            return NextResponse.json({ error: 'Your sign-in expired. Please sign in again.' }, { status: 401 });
        }

        const body = await request.json();
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        const userName = typeof body.user_name === 'string' ? body.user_name.trim() : '';

        if (!content || !userName) {
            return NextResponse.json({ error: 'Name and message are required.' }, { status: 400 });
        }
        if (content.length > MAX_CONTENT_CHARS || userName.length > MAX_NAME_CHARS) {
            return NextResponse.json(
                { error: `Message must be under ${MAX_CONTENT_CHARS} characters and name under ${MAX_NAME_CHARS}.` },
                { status: 413 }
            );
        }

        const supabaseAdmin = getSupabaseAdmin();
        const { error } = await supabaseAdmin.from('feedbacks').insert({
            content,
            user_name: userName,
            user_email: email,
            user_id: uid,
        });

        if (error) {
            console.error('Supabase insert error:', error);
            return NextResponse.json({ error: 'Could not save feedback. Please try again.' }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (err: unknown) {
        console.error('Feedback POST error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ─── GET: Fetch all feedbacks (admin only) ────────────────────
export async function GET(request: NextRequest) {
    try {
        // Session comes in a header, never the query string (keeps it out of logs)
        const sessionToken = request.headers.get('x-admin-session');
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

        if (!validateSession(sessionToken, ip)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const supabaseAdmin = getSupabaseAdmin();
        const { data, error } = await supabaseAdmin
            .from('feedbacks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase fetch error:', error);
            return NextResponse.json({ error: 'Could not load feedback.' }, { status: 500 });
        }

        return NextResponse.json({ feedbacks: data || [] });

    } catch (err) {
        console.error('Feedback GET error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ─── DELETE: Remove a feedback (admin only) ────────────────────
export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json();
        const { sessionToken, feedbackId } = body;
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

        if (!validateSession(sessionToken, ip)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!feedbackId) {
            return NextResponse.json({ error: 'feedbackId required' }, { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();
        const { error } = await supabaseAdmin
            .from('feedbacks')
            .delete()
            .eq('id', feedbackId);

        if (error) {
            console.error('Supabase delete error:', error);
            return NextResponse.json({ error: 'Could not delete feedback.' }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (err) {
        console.error('Feedback DELETE error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
