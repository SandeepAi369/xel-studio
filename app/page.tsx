import Hero from '@/components/Hero';
import BentoGrid from '@/components/BentoCard';
import Footer from '@/components/Footer';
import LoginButton from '@/components/LoginButton';

export default function Home() {
  return (
    <>
      {/* Skip to main content link for accessibility */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Top-right Login Button */}
      <div className="fixed top-4 right-4 z-50">
        <LoginButton />
      </div>

      <main id="main-content" aria-labelledby="site-title" className="flex-grow">
        {/* Hero Section */}
        <Hero />

        {/* Bento Grid Navigation */}
        <nav
          aria-label="Primary Navigation - Bento Grid"
          className="max-w-6xl mx-auto px-4 pb-16"
        >
          <BentoGrid />
        </nav>
      </main>

      {/* Footer */}
      <Footer />
    </>
  );
}
