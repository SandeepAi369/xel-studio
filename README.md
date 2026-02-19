<div align="center">

# ⚡ XeL Studio

### AI Research & Cyber Security Platform

A modern, full-stack web application built with **Next.js 16**, featuring AI-powered tools, automated news aggregation, text-to-speech article reading, and a secure admin panel.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://xel-studio.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**v2.0**

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
- [Automated News System](#-automated-news-system)
- [Text-to-Speech](#-text-to-speech)
- [Admin Panel](#-admin-panel)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

XeL Studio is a personal platform for AI research and cyber security content. It serves as a hub for publishing articles, aggregating AI and tech news from across the web, chatting with an AI assistant, and exploring security tools — all wrapped in a sleek, dark-themed interface with smooth animations.

---

## ✨ Features

### 🤖 AI Chat
- Chat with an AI assistant powered by Google Gemini
- Real-time streaming responses
- Intent classification for smart reply formatting

### 📰 Automated News
- AI and tech news automatically fetched every hour via GitHub Actions
- Summaries generated using Google Gemini AI
- Categorized into AI and Tech sections
- Duplicate detection to prevent repeated stories

### 📝 Articles
- Publish and manage articles through the admin panel
- Articles stored in GitHub repository as structured JSON
- Full markdown support with rich text rendering
- Reading time estimates and metadata

### 🔊 Text-to-Speech
- Listen to any article or news item with one click
- Powered by Microsoft Edge TTS (en-US-AvaNeural voice)
- Smart chunking for instant playback (no waiting for full audio)
- Cached audio for fast replay

### 🔐 Authentication
- Google Sign-In via Firebase Authentication
- Secure admin panel with token-based access
- Session management with signed tokens
- Login attempt tracking for security

### 💬 User Feedback
- Built-in feedback form with accessible design
- Feedback stored in Supabase database
- Keyboard navigation and screen reader support

### 🛡️ Security Tools
- Dedicated Shield page for security resources
- Admin dashboard for content management

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **Language** | TypeScript 5 |
| **Styling** | Tailwind CSS 4 |
| **Animations** | Framer Motion |
| **Icons** | Lucide React |
| **Auth** | Firebase Authentication |
| **Database** | Firebase Firestore, Supabase |
| **AI** | Google Gemini API |
| **TTS** | Microsoft Edge TTS (Python) |
| **News Script** | Python 3.12 |
| **CI/CD** | GitHub Actions |
| **Hosting** | Vercel |
| **Markdown** | react-markdown, remark-gfm |

---

## 📂 Project Structure

```
xel-studio/
├── app/                    # Next.js App Router pages
│   ├── page.tsx            # Home page (Hero + Bento Grid)
│   ├── layout.tsx          # Root layout with metadata
│   ├── globals.css         # Global styles and design tokens
│   ├── ai/                 # AI tools page
│   ├── ai-news/            # Automated AI & Tech news feed
│   ├── articles/           # Article listing and detail pages
│   │   └── [id]/           # Dynamic article page
│   ├── chat/               # AI chat interface
│   ├── dashboard/          # User dashboard
│   ├── shield/             # Security tools page
│   ├── store/              # Digital store page
│   ├── xel-admin/          # Admin panel (protected)
│   └── api/                # API routes
│       ├── admin/          # Admin CRUD operations
│       ├── chat/           # AI chat endpoint
│       ├── content/        # Content management
│       ├── download/       # File download handler
│       ├── feedback/       # Feedback submission
│       └── revalidate/     # Vercel cache revalidation
├── api/                    # Vercel Python Serverless Functions
│   └── stream_audio.py     # Text-to-Speech API (edge-tts)
├── components/             # React components
│   ├── Hero.tsx            # Animated hero section
│   ├── BentoCard.tsx       # Bento grid navigation cards
│   ├── QuickActions.tsx    # AI News & Chat action cards
│   ├── SmartListenButton.tsx # TTS player with chunked playback
│   ├── FeedbackForm.tsx    # Accessible feedback form
│   ├── LoginButton.tsx     # Firebase Google Sign-In
│   ├── MatrixRain.tsx      # Matrix rain animation
│   ├── SkeletonCard.tsx    # Loading skeleton components
│   ├── Footer.tsx          # Site footer
│   └── Providers.tsx       # React context providers
├── lib/                    # Shared utilities and config
│   ├── firebase.ts         # Firebase app initialization
│   ├── auth.ts             # Admin authentication logic
│   ├── db.ts               # Database helpers
│   ├── github-api.ts       # GitHub content API
│   ├── supabase.ts         # Supabase client
│   ├── tts-text.ts         # TTS text preparation
│   ├── tts-cache.ts        # Audio caching layer
│   └── audio-manager.ts    # Audio playback manager
├── scripts/                # Automation scripts
│   ├── generate_news.py    # Hourly news generator (GitHub Actions)
│   └── requirements.txt    # Python dependencies
├── data/                   # Data storage
│   └── tech_news.json      # Aggregated news articles
├── public/                 # Static assets
│   └── data/
│       └── tech_news.json  # Public copy of news data
├── supabase/               # Database setup
│   └── feedbacks.sql       # Feedback table schema
├── .github/workflows/      # CI/CD automation
│   ├── daily-news.yml      # Hourly news generation workflow
│   └── deploy.yml          # Manual Vercel deployment
├── vercel.json             # Vercel configuration (Python runtime)
├── package.json            # Node.js dependencies
├── tsconfig.json           # TypeScript configuration
├── next.config.ts          # Next.js configuration
└── env.d.ts                # TypeScript env var declarations
```

---

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed on your machine:

- **Node.js** 20 or higher — [Download here](https://nodejs.org)
- **Python** 3.12 or higher — [Download here](https://python.org)
- **Git** — [Download here](https://git-scm.com)

### Step 1: Clone the Repository

```bash
git clone https://github.com/Sandeepchch/PCL.git
cd PCL
```

### Step 2: Install Node.js Dependencies

```bash
npm install
```

### Step 3: Install Python Dependencies

The Python TTS function needs `edge-tts`:

```bash
pip install -r requirements.txt
```

### Step 4: Set Up Environment Variables

Create a `.env.local` file in the project root. See the [Environment Variables](#-environment-variables) section below for all required values.

```bash
cp .env.local.example .env.local
```

Then edit `.env.local` and fill in your actual values.

### Step 5: Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The app will hot-reload as you make changes.

### Step 6: Build for Production (Optional)

```bash
npm run build
npm start
```

---

## 🔑 Environment Variables

Create a `.env.local` file with the following variables. All values are required for full functionality.

### Firebase (Client-Side Authentication)

These power Google Sign-In and Firestore. Get them from [Firebase Console](https://console.firebase.google.com) → Project Settings.

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
```

### Supabase (Feedback Database)

Used to store user feedback. Get these from [Supabase Dashboard](https://supabase.com/dashboard) → Project Settings → API.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Admin Authentication

Secure values for the admin panel. Choose your own strong values.

```env
ADMIN_TOKEN=your-secret-admin-token
ADMIN_PASSWORD=your-strong-admin-password
SESSION_SECRET=any-random-string-for-signing-sessions
```

### Google Gemini AI

Powers the AI chat and news summaries. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

```env
GEMINI_API_KEY=your-gemini-api-key
```

### GitHub (Content Storage)

Used by the admin panel to read/write articles to the repository.

```env
GITHUB_TOKEN=your-github-personal-access-token
GITHUB_REPO=YourUsername/YourRepo
```

> **Note**: On Vercel, add all these variables in **Settings → Environment Variables**. Select all environments (Production, Preview, Development).

---

## 🌐 Deployment

### Vercel (Recommended)

XeL Studio is designed to deploy on [Vercel](https://vercel.com) with zero configuration.

1. **Connect your GitHub repository** to Vercel
2. **Add environment variables** in Vercel Dashboard → Settings → Environment Variables
3. **Deploy** — Vercel auto-deploys on every push to `main`

The `vercel.json` file is pre-configured to handle the Python TTS function:

```json
{
  "functions": {
    "api/stream_audio.py": {
      "runtime": "@vercel/python@4.5.0",
      "maxDuration": 30
    }
  }
}
```

### Manual Deploy via GitHub Actions

You can also trigger a manual deploy from the **Actions** tab:

1. Go to **Actions → Deploy to Vercel (Manual)**
2. Click **Run workflow**
3. Choose `production` or `preview`

This requires `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` secrets in your GitHub repo.

---

## 📰 Automated News System

XeL Studio automatically fetches and summarizes AI and tech news every hour using GitHub Actions.

### How It Works

1. **GitHub Actions** runs `scripts/generate_news.py` every hour (cron: `0 * * * *`)
2. The script fetches RSS feeds from top AI and tech sources
3. **Google Gemini** generates concise summaries for each article
4. New articles are saved to `data/tech_news.json`
5. Changes are auto-committed and pushed to the repository
6. Vercel cache is revalidated so new content appears instantly

### Required GitHub Secrets

Add these in your GitHub repo → **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key for generating summaries |
| `SITE_URL` | Your deployed site URL (e.g., `https://xel-studio.vercel.app`) |
| `REVALIDATION_SECRET` | Secret for Vercel cache revalidation |

### Manual Trigger

You can manually trigger news generation from the **Actions** tab → **Hourly News Generator** → **Run workflow**.

---

## 🔊 Text-to-Speech

Every article and news item has a **Listen** button that reads the content aloud.

### How It Works

1. Text is cleaned (markdown stripped) on the frontend
2. Text is split into chunks (first 10 words, then ~50 words each)
3. The first chunk is sent to `/api/stream_audio` immediately for instant playback
4. Remaining chunks are fetched and queued in the background
5. Audio is cached in memory for instant replay

### Configuration

The TTS settings are in `api/stream_audio.py`:

```python
VOICE = "en-US-AvaNeural"    # Microsoft Edge TTS voice
RATE = "+15%"                 # Playback speed (slightly above normal)
MAX_TEXT_LENGTH = 5000        # Maximum characters per request
```

Available voices include:
- `en-US-AvaNeural` — Clear, professional female voice (default)
- `en-US-AndrewMultilingualNeural` — Natural male voice
- `en-US-JennyNeural` — Conversational female voice
- `en-GB-SoniaNeural` — British female voice

---

## 🔧 Admin Panel

The admin panel is accessible at `/xel-admin` and requires authentication.

### Accessing the Panel

1. Navigate to `https://your-site.vercel.app/xel-admin`
2. Enter your `ADMIN_PASSWORD` to log in
3. Your session lasts 30 minutes

### Capabilities

- **Create articles** — Write and publish new articles with markdown support
- **Edit articles** — Modify existing article content and metadata
- **Delete articles** — Remove articles from the repository
- **Manage content** — Organize all site content from one place

Articles are stored as JSON in your GitHub repository via the GitHub API.

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a branch** for your feature:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** and test locally
4. **Commit** with a clear message:
   ```bash
   git commit -m "feat: Add your feature description"
   ```
5. **Push** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
6. **Open a Pull Request** on GitHub

### Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org):

| Prefix | Use For |
|--------|---------|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `chore:` | Maintenance tasks |
| `docs:` | Documentation changes |
| `perf:` | Performance improvements |

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<div align="center">

**Built with ❤️ by [Sandeep](https://github.com/Sandeepchch)**

⚡ XeL Studio v2.0

</div>
