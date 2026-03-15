<div align="center">

# ⚡ XeL Studio

### Architecting Intelligence — AI Research & Cyber Security

A cutting-edge, full-stack platform built with **Next.js 16** and **React 19**, featuring an automated AI news pipeline, real-time chat, text-to-speech, security tools, and a comprehensive admin panel — all wrapped in a stunning cyberpunk-inspired dark interface.

[![Live](https://img.shields.io/badge/🌐_Live-xel--studio.vercel.app-00ffaa?style=for-the-badge)](https://xel-studio.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16.1.5-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript)](https://typescriptlang.org)
[![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com)

**v2.5**

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
- [AI News Pipeline](#-ai-news-pipeline)
- [Text-to-Speech Engine](#-text-to-speech-engine)
- [Admin Panel](#-admin-panel)
- [Accessibility](#-accessibility)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**XeL Studio** is a personal AI research and cyber security platform that combines:

- 🤖 **AI-powered news generation** — fully automated pipeline that searches the web, writes articles, and generates images using AI
- 💬 **Multi-model AI chat** — conversational AI powered by Google Gemini with model selection
- 🔊 **Smart text-to-speech** — listen to any article with chunked streaming for instant playback
- 🛡️ **Security toolkit** — curated cyber security tools and resources
- 📱 **Responsive design** — optimized for both desktop and mobile with device auto-detection

Every feature is designed for **accessibility first** — screen reader support, keyboard navigation, focus management, and ARIA attributes throughout.

---

## ✨ Key Features

### 📰 Automated AI News

- Real-time news aggregation powered by **Tavily AI Search** + **Cerebras GPT-OSS 120B**
- AI-generated images via **FLUX** model (g4f open-source library)
- Categorized feeds: **AI & Tech**, **Disability & Accessibility**, **World**, **General**
- Smart 10-day URL-based deduplication — no repeated stories
- Full-screen snap-scroll card UI with smooth transitions
- Firestore real-time listener — new articles appear instantly without refresh
- Scroll position memory (sessionStorage) — position restores on back-navigation, resets on fresh browser open

### 💬 AI Chat

- Powered by **Google Gemini** (2.5 Flash & 3 Flash models)
- Real-time streaming responses with markdown rendering
- Chat history persisted in localStorage
- Model selector for switching between Gemini variants
- Code syntax highlighting and GFM table support

### 📝 Articles

- Rich article reading experience with markdown support
- **Text-to-Speech** — listen to any article with one click
- Incremental Static Regeneration (ISR) with 60-second revalidation
- Skeleton loading states for seamless transitions
- Supabase-backed article storage with admin CRUD

### 🛡️ Shield — Security Tools

- Curated collection of cyber security tools and resources
- Categorized: Encryption, Forensics, Penetration Testing, Authentication
- Search and filter with animated transitions
- Client-side data caching for instant page loads

### 🧪 AI Labs

- Showcase of AI experiments and research projects
- Status indicators: Active, Experimental, Archived
- Search and filter capabilities
- Supabase-backed content management

### 🏪 Digital Store

- APK downloads with ghost download technology (seamless, no-popup downloads)
- Download progress tracking with animated indicators
- Supabase-backed product catalog

### 🔊 Text-to-Speech Engine

- Microsoft Edge TTS (en-US-AvaNeural voice)
- **Smart chunking** — first sentence plays instantly (~1-2 seconds), remaining audio loads in background
- Aggressive prefetching (6 chunks ahead) for gap-free playback
- In-memory audio caching for instant replay
- Singleton audio manager — only one audio plays at a time across all pages

### 🔐 Authentication & Security

- Google Sign-In via Firebase Authentication
- Protected admin panel with token-based access and bcrypt password hashing
- Session management with signed tokens (30-minute TTL)
- Login attempt tracking and security logging

### 💬 User Feedback

- Accessible feedback form with screen reader support
- Stored in Supabase with user metadata
- Keyboard navigation and focus management

### 🎨 Design System

- Custom cyberpunk dark theme with neon green/cyan accents
- Glassmorphism effects, Matrix rain background animation
- Geist Sans & Geist Mono typography
- Framer Motion page transitions and micro-animations
- Custom scrollbar styling and selection highlighting
- `prefers-reduced-motion` support for accessibility

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT (Browser)                          │
│                                                                    │
│    Next.js 16 App Router  ·  React 19  ·  Tailwind CSS 4          │
│    Framer Motion  ·  Lucide Icons  ·  React Markdown              │
│                                                                    │
│    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│    │ AI News  │ │  Chat    │ │ Articles │ │ Store/Shield/Labs  │  │
│    │ (Snap    │ │ (Gemini  │ │ (ISR +   │ │ (Supabase +        │  │
│    │  Scroll) │ │  Stream) │ │  Supabase│ │  Data Cache)       │  │
│    └─────┬────┘ └────┬─────┘ └────┬─────┘ └────────┬───────────┘  │
│          │           │            │                 │              │
│    ┌─────┴───────────┴────────────┴─────────────────┴───────────┐  │
│    │  Firebase Auth  ·  ScrollRestoration  ·  TopLoader         │  │
│    │  TTS (SmartListenButton)  ·  DataCache  ·  PageTransition  │  │
│    └────────────────────────────┬────────────────────────────────┘  │
└─────────────────────────────────┼──────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │     VERCEL EDGE / NODE     │
                    │                            │
                    │  /api/chat      → Gemini   │
                    │  /api/feedback  → Supabase │
                    │  /api/admin     → Supabase │
                    │  /api/content   → Supabase │
                    │  /api/download  → Ghost DL │
                    │  /api/stream_audio → TTS   │
                    │  /api/cron/generate-news   │
                    │  /api/cron/cleanup-history │
                    └──────┬────┬────┬───────────┘
                           │    │    │
              ┌────────────┘    │    └────────────┐
              ▼                 ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │   Firebase    │  │   Supabase   │  │   External   │
     │   Firestore   │  │  PostgreSQL  │  │   APIs       │
     │               │  │              │  │              │
     │  • News       │  │  • Articles  │  │  • Cerebras  │
     │  • History    │  │  • Store     │  │  • Tavily    │
     │  • Health     │  │  • Shield    │  │  • Gemini    │
     │               │  │  • AI Labs   │  │  • Edge TTS  │
     │               │  │  • Feedback  │  │  • g4f/FLUX  │
     │               │  │  • Logs      │  │  • Cloudinary│
     └──────────────┘  └──────────────┘  └──────────────┘

     ┌──────────────────────────────────────┐
     │        GITHUB ACTIONS (CI/CD)        │
     │                                      │
     │  news_cron.yml  → Python pipeline    │
     │    Tavily Search → Cerebras Article  │
     │    → g4f FLUX Image → Firestore     │
     │                                      │
     │  news_cleanup.yml → History cleanup  │
     │  deploy.yml → Manual Vercel deploy   │
     └──────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Category | Technology |
|:---------|:-----------|
| **Framework** | Next.js 16.1.5 (App Router, Turbopack) |
| **UI Library** | React 19.2.3 |
| **Language** | TypeScript 5 |
| **Styling** | Tailwind CSS 4 |
| **Animations** | Framer Motion 12 |
| **Icons** | Lucide React |
| **Auth** | Firebase Authentication (Google Sign-In) |
| **Databases** | Firebase Firestore + Supabase PostgreSQL |
| **AI (News)** | Cerebras GPT-OSS 120B |
| **AI (Chat)** | Google Gemini 2.5 Flash / 3 Flash |
| **AI (Search)** | Tavily AI Search |
| **AI (Images)** | g4f FLUX-dev (open-source, no API key) |
| **TTS** | Microsoft Edge TTS (Python, en-US-AvaNeural) |
| **Media** | Cloudinary (admin image uploads) |
| **Markdown** | react-markdown + remark-gfm |
| **CI/CD** | GitHub Actions |
| **Hosting** | Vercel |

---

## 📂 Project Structure

```
xel-studio/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Home (Hero + QuickActions + BentoGrid)
│   ├── layout.tsx                # Root layout (fonts, metadata, providers)
│   ├── globals.css               # Design tokens & global styles
│   ├── ai-news/                  # AI news feed (snap-scroll)
│   │   ├── page.tsx              # News listing with category filters
│   │   └── [id]/page.tsx         # Article detail (ISR, 60s revalidation)
│   ├── articles/                 # Article section
│   │   ├── page.tsx              # Article grid with search
│   │   └── [id]/                 # Dynamic article pages
│   │       ├── page.tsx          # Article detail with TTS
│   │       └── loading.tsx       # Skeleton loading state
│   ├── chat/                     # AI chat (Gemini)
│   ├── ai/                       # AI Labs experiments
│   ├── store/                    # Digital store (APK downloads)
│   ├── shield/                   # Cyber security tools
│   ├── dashboard/                # User dashboard (auth-protected)
│   ├── xel-admin/                # Admin panel (1000+ lines)
│   └── api/                      # API routes
│       ├── chat/                 # Gemini chat endpoint
│       ├── cron/
│       │   ├── generate-news/    # News generation pipeline
│       │   └── cleanup-history/  # History cleanup cron
│       ├── admin/                # Admin CRUD operations
│       ├── content/              # Content management
│       ├── download/             # Ghost download handler
│       ├── feedback/             # Feedback submission
│       ├── upload/               # Cloudinary upload (signed)
│       └── revalidate/           # Vercel ISR revalidation
├── api/                          # Vercel Python Serverless
│   └── stream_audio.py           # Edge TTS streaming endpoint
├── components/                   # React components
│   ├── Hero.tsx                  # Animated hero with gradient text
│   ├── BentoCard.tsx             # Bento grid navigation cards
│   ├── QuickActions.tsx          # AI News & Chat action cards
│   ├── SmartListenButton.tsx     # TTS player (chunked streaming)
│   ├── FeedbackForm.tsx          # Accessible feedback form
│   ├── LoginButton.tsx           # Firebase Google Sign-In
│   ├── MatrixRain.tsx            # Matrix rain background animation
│   ├── SkeletonCard.tsx          # Loading skeletons (card + grid)
│   ├── TopLoader.tsx             # Top progress bar
│   ├── ScrollRestoration.tsx     # Custom scroll position memory
│   ├── PageTransition.tsx        # Fade+slide page entry animation
│   ├── Footer.tsx                # Site footer
│   └── Providers.tsx             # Auth + context providers
├── lib/                          # Shared utilities
│   ├── firebase.ts               # Firebase client initialization
│   ├── firebase-admin.ts         # Firebase Admin SDK (server)
│   ├── auth.ts                   # Admin auth (bcrypt + tokens)
│   ├── AuthContext.tsx           # React auth context provider
│   ├── supabase.ts               # Supabase client
│   ├── supabase-db.ts            # Supabase CRUD operations
│   ├── DataCache.ts              # Client-side data cache (TTL)
│   ├── ghost-download.ts         # Seamless file downloads
│   ├── download-helpers.ts       # Download utilities
│   ├── tts-text.ts               # TTS text preparation & cleanup
│   ├── tts-cache.ts              # In-memory audio cache
│   ├── audio-manager.ts          # Singleton audio playback manager
│   └── constants.ts              # App constants
├── scripts/                      # Automation (GitHub Actions)
│   ├── run_news_cycle.py         # Main news generation pipeline
│   ├── gemini_image_gen.py       # g4f FLUX image generation
│   ├── cleanup_news.py           # Old news cleanup
│   ├── tts_server.py             # Local TTS dev server
│   └── requirements.txt          # Python dependencies
├── data/                         # Local data storage
│   └── data.json                 # Cached content data
├── .github/workflows/            # CI/CD
│   ├── news_cron.yml             # News generation workflow
│   ├── news_cleanup.yml          # History cleanup workflow
│   └── deploy.yml                # Manual Vercel deployment
├── vercel.json                   # Vercel config (Python runtime, crons)
├── next.config.ts                # Next.js config (image domains, etc.)
├── package.json                  # Dependencies (v2.5.0)
├── tsconfig.json                 # TypeScript configuration
└── env.d.ts                      # TypeScript environment declarations
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+ — [Download](https://nodejs.org)
- **Python** 3.11+ — [Download](https://python.org)
- **Git** — [Download](https://git-scm.com)

### Setup

```bash
# 1. Clone
git clone https://github.com/SandeepAi369/xel-studio.git
cd xel-studio

# 2. Install dependencies
npm install

# 3. Install Python TTS dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.local.example .env.local
# Edit .env.local with your API keys (see section below)

# 5. Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the app hot-reloads on changes.

### Production Build

```bash
npm run build
npm start
```

---

## 🔑 Environment Variables

Create a `.env.local` file with the following variables:

### Firebase (Client + Server)

```env
# Client-side (Firebase Auth + Firestore)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

# Server-side (Firebase Admin SDK — base64-encoded service account JSON)
FIREBASE_SERVICE_ACCOUNT=
```

### Supabase

```env
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

### AI Services

```env
GEMINI_API_KEY=                 # Google Gemini (chat)
CEREBRAS_API_KEY=               # Cerebras (news article generation)
TAVILY_API_KEY=                 # Tavily (news search)
TAVILY_API_KEY_2=               # Tavily fallback key (optional)
```

### Admin Panel

```env
ADMIN_TOKEN=                    # Admin API token
ADMIN_PASSWORD=                 # Admin login password
SESSION_SECRET=                 # Session signing secret
```

### Media & Deployment

```env
CLOUDINARY_CLOUD_NAME=          # Cloudinary (admin image uploads)
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

CRON_SECRET=                    # Vercel cron auth token
REVALIDATION_SECRET=            # ISR revalidation secret
```

> **Vercel**: Add all variables in **Settings → Environment Variables** for all environments.

---

## 🌐 Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to [Vercel](https://vercel.com)
2. Add all environment variables
3. Deploy — auto-deploys on every push to `main`

The `vercel.json` handles Python runtime for TTS and scheduled cron jobs:

```json
{
  "functions": {
    "api/stream_audio.py": {
      "runtime": "@vercel/python@4.5.0",
      "maxDuration": 30
    }
  },
  "crons": [
    { "path": "/api/cron/cleanup-history", "schedule": "5 21 * * *" },
    { "path": "/api/cron/cleanup-history", "schedule": "5 23 * * *" }
  ]
}
```

### Manual Deploy via GitHub Actions

Go to **Actions → Deploy to Vercel (Manual)** → **Run workflow** → Choose `production` or `preview`.

Requires secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

---

## 📰 AI News Pipeline

The news generation pipeline is a fully automated, multi-stage AI system:

```
Tavily AI Search  →  URL Dedup Filter  →  Cerebras GPT-OSS 120B  →  Image Prompt
       ↓                    ↓                      ↓                     ↓
  Real-time web       10-day URL          Structured JSON           g4f FLUX-dev
  news search         history check        article text             AI image gen
                                                                         ↓
                                                                    Firestore
                                                                    (real-time)
```

### Pipeline Stages

1. **Dynamic Query Generation** — randomly selects from 40+ categorized search queries
2. **Tavily AI Search** — fetches 10 real-time news results with dual API key fallback
3. **URL Deduplication** — checks against 10-day history stored in Firestore (exact URL match)
4. **Cerebras Article Generation** — GPT-OSS 120B writes 175-225 word factual articles with auto-retry for word count
5. **Image Prompt Generation** — Cerebras llama3.1-8b creates cinematic image descriptions
6. **Image Generation** — g4f FLUX-dev model (priority 1) / FLUX base (fallback)
7. **Firestore Storage** — article saved to `news` collection, URLs saved to `news_history`
8. **Health Tracking** — success/failure status logged to `system/cron_health`

### Triggers

| Trigger | Method |
|:--------|:-------|
| **GitHub Actions** | `news_cron.yml` — manual dispatch or `repository_dispatch` |
| **Vercel Cron** | `/api/cron/generate-news` — called with `CRON_SECRET` bearer token |

### Image Model Priority (Tested March 2026)

| Priority | Model | Quality | Status |
|:---------|:------|:--------|:-------|
| 1st | **FLUX-dev** | Best — rich detail, artistic composition | ✅ Working |
| 2nd | **FLUX** (base) | Good — clean, less artistic | ✅ Working |

---

## 🔊 Text-to-Speech Engine

Every article and news item has a **Listen** button powered by a custom smart chunking system for **instant playback** with zero waiting.

### How It Works

1. Text is cleaned — markdown, URLs, code blocks stripped
2. **Smart chunking** splits text at sentence boundaries:
   - First chunk: 1-2 sentences (~25 words) → plays in ~1 second
   - Remaining chunks: 35-55 words each
3. First chunk fetches immediately for instant playback
4. 6 chunks prefetched ahead in background
5. Audio cached in memory for instant replay

### Configuration

```python
# api/stream_audio.py
VOICE = "en-US-AvaNeural"      # Microsoft Edge TTS voice
RATE = "+15%"                   # Slightly above normal speed
MAX_TEXT_LENGTH = 5000          # Max characters per request
```

---

## 🔧 Admin Panel

The full-featured admin panel at `/xel-admin` manages all content across the platform.

### Capabilities

| Section | Operations |
|:--------|:-----------|
| **Articles** | Create, edit, delete with markdown editor |
| **Store** | Manage APK downloads with version tracking |
| **AI Labs** | Manage experiment entries and status |
| **Shield** | Manage security tools catalog |
| **Feedback** | View and manage user feedback |
| **Image Upload** | Direct-to-Cloudinary signed uploads |
| **Logs** | Admin activity and download tracking |

### Access

1. Navigate to `/xel-admin`
2. Enter `ADMIN_PASSWORD` to authenticate
3. Session lasts 30 minutes (auto-expiry)

---

## ♿ Accessibility

XeL Studio is built with accessibility as a core principle:

- **ARIA roles & labels** — `role="feed"`, `role="tablist"`, `aria-selected`, `aria-busy`, `aria-live`
- **Keyboard navigation** — all interactive elements focusable, visible focus rings (`focus-visible`)
- **Screen reader support** — descriptive `aria-label` on all buttons, images, and navigation
- **Skip link** — "Skip to main content" link for keyboard users
- **Reduced motion** — respects `prefers-reduced-motion` media query
- **Semantic HTML** — `<nav>`, `<main>`, `<article>`, `<time>`, `<header>`, `<footer>`
- **Text-to-Speech** — listen to any content with one click

---

## 🤝 Contributing

1. **Fork** the repository
2. **Create a branch**: `git checkout -b feature/your-feature`
3. **Make changes** and test locally
4. **Commit**: `git commit -m "feat: your feature description"`
5. **Push**: `git push origin feature/your-feature`
6. **Open a Pull Request**

### Commit Convention

| Prefix | Use For |
|:-------|:--------|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `perf:` | Performance improvements |
| `chore:` | Maintenance |
| `docs:` | Documentation |

---

## 📄 License

This project is open source under the [MIT License](LICENSE).

---

<div align="center">

**Built with ❤️ by [Sandeep](https://github.com/SandeepAi369)**

⚡ XeL Studio v2.5

</div>
