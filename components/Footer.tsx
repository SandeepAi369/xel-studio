import { Mail, Github } from 'lucide-react';

export default function Footer() {
    return (
        <footer
            className="mt-auto py-6 px-4 border-t border-emerald-500/10"
            style={{
                background: 'linear-gradient(to bottom, #0a0a0a, #18181b)',
            }}
        >
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
                    <p className="text-sm text-zinc-400">
                        © 2026 XeL Studio. Built by{' '}
                        <span className="text-emerald-400 font-medium">Sandeep</span>.
                    </p>
                    <span className="text-xs text-zinc-600">v1.3</span>
                </div>

                <div className="flex items-center gap-4">
                    <a
                        href="mailto:sandeep@xelstudio.dev"
                        aria-label="Send email"
                        className="text-zinc-400 hover:text-emerald-400 transition-colors"
                    >
                        <Mail className="w-5 h-5" />
                    </a>
                    <a
                        href="https://github.com/Sandeepchch"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GitHub Profile"
                        className="text-zinc-400 hover:text-emerald-400 transition-colors"
                    >
                        <Github className="w-5 h-5" />
                    </a>
                </div>
            </div>
        </footer>
    );
}
