import Hero from '@/components/Hero';
import QuickActions from '@/components/QuickActions';
import BentoGrid from '@/components/BentoCard';
import FeedbackForm from '@/components/FeedbackForm';
import LoginButton from '@/components/LoginButton';
import { Github } from 'lucide-react';

export default function Home() {
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <div className="fixed top-4 right-4 z-50">
        <LoginButton />
      </div>

      <main id="main-content" role="main" aria-label="Signature Prime Home" className="flex-grow">
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

        {/* User Feedback — button-triggered */}
        <FeedbackForm />

        {/* GitHub Profile */}
        <div className="text-center pb-10">
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
        </div>
      </main>
    </>
  );
}
