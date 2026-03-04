import Hero from '@/components/Hero';
import QuickActions from '@/components/QuickActions';
import BentoGrid from '@/components/BentoCard';
import FeedbackForm from '@/components/FeedbackForm';
import LoginButton from '@/components/LoginButton';
import { Github } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'XeL Studio | AI Research & Cyber Security Platform',
  description:
    'XeL Studio is an AI research and cyber security platform by Sandeep. Explore AI-powered news, research articles, AI chat, security tools, and more.',
  openGraph: {
    title: 'XeL Studio | AI Research & Cyber Security Platform',
    description:
      'AI-powered news aggregation, research articles, Gemini chat, security tools, and text-to-speech — all in one platform.',
    type: 'website',
    url: 'https://xel-studio.vercel.app',
    siteName: 'XeL Studio',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'XeL Studio | AI Research & Cyber Security',
    description:
      'AI-powered news, articles, chat, security tools by Sandeep.',
  },
  alternates: {
    canonical: 'https://xel-studio.vercel.app',
    types: {
      'application/rss+xml': 'https://xel-studio.vercel.app/api/rss',
    },
  },
};

// JSON-LD structured data for Google, bots, and AI assistants
function JsonLd() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': 'https://xel-studio.vercel.app/#website',
        url: 'https://xel-studio.vercel.app',
        name: 'XeL Studio',
        description:
          'AI Research & Cyber Security Platform — Automated news, research articles, AI chat, security tools, and text-to-speech.',
        publisher: { '@id': 'https://xel-studio.vercel.app/#organization' },
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://xel-studio.vercel.app/articles?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        '@id': 'https://xel-studio.vercel.app/#organization',
        name: 'XeL Studio',
        url: 'https://xel-studio.vercel.app',
        founder: {
          '@type': 'Person',
          name: 'Sandeep',
          url: 'https://github.com/Sandeepchch',
        },
        sameAs: ['https://github.com/Sandeepchch'],
      },
      {
        '@type': 'WebPage',
        '@id': 'https://xel-studio.vercel.app/#homepage',
        url: 'https://xel-studio.vercel.app',
        name: 'XeL Studio — Architecting Intelligence',
        isPartOf: { '@id': 'https://xel-studio.vercel.app/#website' },
        about: { '@id': 'https://xel-studio.vercel.app/#organization' },
        description:
          'XeL Studio home page. Navigate to AI News, Articles, AI Chat, Store, and Security Tools.',
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: [
            {
              '@type': 'SiteNavigationElement',
              position: 1,
              name: 'AI Tech News',
              description:
                'Automated AI and tech news powered by Cerebras GPT and Tavily search. Updated multiple times daily.',
              url: 'https://xel-studio.vercel.app/ai-news',
            },
            {
              '@type': 'SiteNavigationElement',
              position: 2,
              name: 'Chat with AI',
              description:
                'Interactive AI chat powered by Google Gemini 2.5 Flash and 3 Flash models with streaming responses.',
              url: 'https://xel-studio.vercel.app/chat',
            },
            {
              '@type': 'SiteNavigationElement',
              position: 3,
              name: 'Articles',
              description:
                'Deep dives into AI research, LLM architecture, and technical analysis.',
              url: 'https://xel-studio.vercel.app/articles',
            },
            {
              '@type': 'SiteNavigationElement',
              position: 4,
              name: 'AI Labs',
              description:
                'Research and experimental AI models, custom automation systems.',
              url: 'https://xel-studio.vercel.app/ai',
            },
            {
              '@type': 'SiteNavigationElement',
              position: 5,
              name: 'Store',
              description:
                'Premium APKs, bots, and tools with direct downloads.',
              url: 'https://xel-studio.vercel.app/store',
            },
            {
              '@type': 'SiteNavigationElement',
              position: 6,
              name: 'Security',
              description:
                'Cyber defense tools, Kali scripts, and security protocols.',
              url: 'https://xel-studio.vercel.app/shield',
            },
          ],
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}

export default function Home() {
  return (
    <>
      <JsonLd />

      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <div className="fixed top-4 right-4 z-50">
        <LoginButton />
      </div>

      <main id="main-content" role="main" aria-label="XeL Studio Home" className="flex-grow">
        {/* Hero Section */}
        <Hero />

        {/* AI News + Chat — distinct action cards */}
        <QuickActions />

        {/* Bento Grid Navigation */}
        <nav
          aria-label="Primary Navigation - Bento Grid"
          className="max-w-6xl mx-auto px-4 pb-16"
        >
          <BentoGrid />
        </nav>

        {/* SSR-visible section descriptions for SEO & bots */}
        <section className="sr-only" aria-label="Platform sections overview">
          <h2>XeL Studio Sections</h2>
          <article>
            <h3>AI Tech News</h3>
            <p>
              Automated AI and technology news feed. Articles are generated using Cerebras GPT-OSS 120B
              from real-time web search results via Tavily AI. Each article includes an AI-generated image
              using FLUX model. Categories include AI &amp; Tech, Open Source, Disability &amp; Accessibility,
              Climate &amp; Environment, World Affairs, Health, and General news.
              The feed is updated multiple times daily via automated pipelines.
            </p>
          </article>
          <article>
            <h3>AI Chat</h3>
            <p>
              Interactive AI chat assistant powered by Google Gemini 2.5 Flash and Gemini 3 Flash models.
              Features real-time streaming responses, markdown rendering, code syntax highlighting,
              and persistent chat history. Users can switch between Gemini models.
            </p>
          </article>
          <article>
            <h3>Articles</h3>
            <p>
              Research articles covering AI, machine learning, LLM architecture, and technical analysis.
              Each article supports text-to-speech listening via Microsoft Edge TTS.
              Articles are stored in Supabase and managed through the admin panel.
            </p>
          </article>
          <article>
            <h3>AI Labs</h3>
            <p>
              Research and experimental AI models, custom automation systems, and AI projects by Sandeep.
              Projects are categorized as Active, Experimental, or Archived.
            </p>
          </article>
          <article>
            <h3>Digital Store</h3>
            <p>
              Premium APKs, bots, and developer tools available for direct download.
              Features seamless ghost download technology with progress tracking.
            </p>
          </article>
          <article>
            <h3>Security Tools</h3>
            <p>
              Curated cyber security tools and resources including encryption tools,
              forensics utilities, penetration testing scripts, and authentication tools.
              Part of the Shield security section of XeL Studio.
            </p>
          </article>
          <article>
            <h3>Text-to-Speech</h3>
            <p>
              Every article and news item can be listened to using the built-in text-to-speech feature.
              Powered by Microsoft Edge TTS with the en-US-AvaNeural voice. Features smart chunking
              for instant playback with 6-chunk prefetching for gap-free audio.
            </p>
          </article>
          <article>
            <h3>User Authentication</h3>
            <p>
              Google Sign-In via Firebase Authentication. Authenticated users can access their dashboard
              with account information and provider details.
            </p>
          </article>
          <article>
            <h3>Feedback</h3>
            <p>
              Built-in feedback form for users to share suggestions and comments.
              Supports keyboard navigation and screen reader accessibility.
              Feedback is stored in Supabase database.
            </p>
          </article>
        </section>

        {/* User Feedback — button-triggered */}
        <FeedbackForm />

        {/* GitHub Profile + Version */}
        <footer className="text-center pb-10">
          <a
            href="https://github.com/Sandeepchch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-zinc-400 hover:text-white transition-colors"
            aria-label="Visit GitHub profile"
          >
            <Github className="w-5 h-5" />
            <span className="text-sm">GitHub</span>
          </a>
          <p className="mt-3 text-sm text-zinc-400 font-medium tracking-widest">
            v2.5
          </p>
        </footer>
      </main>
    </>
  );
}
