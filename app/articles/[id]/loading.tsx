export default function ArticleLoading() {
    return (
        <main className="min-h-screen bg-[#0a0a0a]">
            {/* Hero skeleton */}
            <div className="relative h-[40vh] min-h-[300px] w-full overflow-hidden bg-zinc-900">
                <div className="w-full h-full animate-pulse bg-gradient-to-br from-zinc-800 to-zinc-900" />
                <div
                    className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent"
                    style={{ pointerEvents: 'none' }}
                />

                {/* Back button skeleton */}
                <div className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 bg-black/60 rounded-full z-10">
                    <div className="w-4 h-4 rounded-full bg-zinc-600 animate-pulse" />
                    <div className="w-8 h-4 rounded bg-zinc-600 animate-pulse" />
                </div>
            </div>

            {/* Content skeleton */}
            <div className="max-w-4xl mx-auto px-4 -mt-20 relative z-10 pb-16">
                <div className="bg-zinc-900/95 rounded-2xl border border-zinc-800 overflow-hidden">
                    {/* Header skeleton */}
                    <div className="p-8 md:p-10 border-b border-zinc-800">
                        {/* Category & date tags */}
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-20 h-7 rounded-full bg-green-500/10 animate-pulse" />
                            <div className="w-32 h-5 rounded bg-zinc-800 animate-pulse" />
                            <div className="w-24 h-5 rounded bg-zinc-800 animate-pulse" />
                        </div>
                        {/* Title skeleton */}
                        <div className="space-y-3">
                            <div className="h-8 bg-zinc-800 rounded animate-pulse w-full" />
                            <div className="h-8 bg-zinc-800 rounded animate-pulse w-3/4" />
                        </div>
                    </div>

                    {/* Body skeleton — paragraph lines */}
                    <div className="p-8 md:p-10 space-y-6">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="space-y-3">
                                <div className="h-4 bg-zinc-800/60 rounded animate-pulse w-full" />
                                <div className="h-4 bg-zinc-800/60 rounded animate-pulse w-full" />
                                <div className="h-4 bg-zinc-800/60 rounded animate-pulse w-11/12" />
                                <div className="h-4 bg-zinc-800/60 rounded animate-pulse w-4/5" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </main>
    );
}
