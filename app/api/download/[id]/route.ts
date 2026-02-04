import { NextRequest, NextResponse } from 'next/server';
import { getAPKByIdAsync, logDownload, checkRateLimit, isValidDownloadUrl, initializeDB } from '@/lib/db';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Maximum file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Initialize database (loads from GitHub on Vercel)
        await initializeDB();

        // Get client IP
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
            request.headers.get('x-real-ip') ||
            'unknown';

        // Rate limit check
        if (!checkRateLimit(ip, 5)) {
            return NextResponse.json(
                { error: 'Rate limit exceeded. Please try again later.' },
                { status: 429 }
            );
        }

        // Get APK from database (async for GitHub API support)
        const apk = await getAPKByIdAsync(id);
        if (!apk) {
            return NextResponse.json(
                { error: 'File not found' },
                { status: 404 }
            );
        }

        // Validate URL
        if (!isValidDownloadUrl(apk.downloadUrl)) {
            console.error('Invalid download URL:', apk.downloadUrl);
            return NextResponse.json(
                { error: 'Invalid download source' },
                { status: 400 }
            );
        }

        // Fetch the file from external source
        const response = await fetch(apk.downloadUrl, {
            headers: {
                'User-Agent': 'XeL-Studio-Proxy/1.0'
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch file:', response.status);
            return NextResponse.json(
                { error: 'Failed to fetch file from source' },
                { status: 502 }
            );
        }

        // Check content length
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: 'File too large' },
                { status: 413 }
            );
        }

        // Get file content
        const fileBuffer = await response.arrayBuffer();

        // Log the download
        logDownload(id, ip, request.headers.get('user-agent') || undefined);

        // Determine filename
        const filename = `${apk.name.replace(/[^a-zA-Z0-9.-]/g, '_')}_v${apk.version}.apk`;

        // Return file as download
        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.android.package-archive',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': fileBuffer.byteLength.toString(),
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Download-Id': id,
            }
        });

    } catch (error) {
        console.error('Download proxy error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
