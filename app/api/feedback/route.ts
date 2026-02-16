import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ─── POST: Submit feedback (from Firebase-authed users) ───────
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { content, user_name, user_email, user_id } = body;

        // Basic validation
        if (!content?.trim() || !user_name?.trim() || !user_email?.trim() || !user_id?.trim()) {
            return NextResponse.json(
                { error: 'All fields are required: content, user_name, user_email, user_id' },
                { status: 400 }
            );
        }

        const supabaseAdmin = getSupabaseAdmin();
        const { error } = await supabaseAdmin.from('feedbacks').insert({
            content: content.trim(),
            user_name: user_name.trim(),
            user_email: user_email.trim(),
            user_id: user_id.trim(),
        });

        if (error) {
            console.error('Supabase insert error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (err) {
        console.error('Feedback POST error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ─── GET: Fetch all feedbacks (admin only) ────────────────────
export async function GET(request: NextRequest) {
    try {
        const sessionToken = request.nextUrl.searchParams.get('session');
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
            return NextResponse.json({ error: error.message }, { status: 500 });
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
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (err) {
        console.error('Feedback DELETE error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
