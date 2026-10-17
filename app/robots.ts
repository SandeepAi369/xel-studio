import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: [
                    '/',
                    '/api/rss',
                    '/articles/feed.xml',
                    '/articles/atom.xml',
                    '/llms.txt',
                    '/llms-full.txt',
                    '/articles.txt',
                    '/d942c55b41224d45a963b655513ab0a9.txt',
                ],
                disallow: ['/xel-admin', '/dashboard', '/api/'],
            },
        ],
        sitemap: 'https://xel-studio.vercel.app/sitemap.xml',
    };
}
