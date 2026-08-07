import { NextResponse } from 'next/server';

// IndexNow requires a verification key hosted at the root.
// We use a static 32-character hex key for XeL Studio.
export const INDEXNOW_KEY = 'd942c55b41224d45a963b655513ab0a9';

export async function GET() {
    return new NextResponse(INDEXNOW_KEY, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
}
