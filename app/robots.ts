import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/xel-admin', '/dashboard', '/api/'],
            },
        ],
        sitemap: 'https://xel-studio.vercel.app/sitemap.xml',
    };
}
