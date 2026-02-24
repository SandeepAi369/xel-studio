'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Trash2, Bot, User, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
    role: 'user' | 'ai';
    text: string;
}

const STORAGE_KEY = 'xel-chat-history';
const MODEL_KEY = 'xel-chat-model';

const MODELS = [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
];

export default function ChatPage() {
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
    const [modelOpen, setModelOpen] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const modelRef = useRef<HTMLDivElement>(null);

    // Load from localStorage
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) setMessages(JSON.parse(saved));
            const savedModel = localStorage.getItem(MODEL_KEY);
            if (savedModel && MODELS.some(m => m.id === savedModel)) setSelectedModel(savedModel);
        } catch { }
    }, []);

    // Save to localStorage (debounced to avoid blocking main thread)
    useEffect(() => {
        if (messages.length > 0) {
            const timer = setTimeout(() => {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [messages]);

    // Save model preference
    useEffect(() => {
        localStorage.setItem(MODEL_KEY, selectedModel);
    }, [selectedModel]);

    // Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    // Close model dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
                setModelOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const clearChat = () => {
        setMessages([]);
        localStorage.removeItem(STORAGE_KEY);
    };

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || loading) return;

        const userMsg: Message = { role: 'user', text };
        const updated = [...messages, userMsg];
        setMessages(updated);
        setInput('');
        setLoading(true);

        if (inputRef.current) inputRef.current.style.height = 'auto';

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    model: selectedModel,
                    history: updated.map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text })),
                }),
            });

            const data = await res.json();

            if (data.error) {
                setMessages([...updated, { role: 'ai', text: `⚠️ ${data.error}` }]);
            } else {
                setMessages([...updated, { role: 'ai', text: data.reply }]);
            }
        } catch {
            setMessages([...updated, { role: 'ai', text: '⚠️ Network error. Please try again.' }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    };

    const currentModelLabel = MODELS.find(m => m.id === selectedModel)?.label || selectedModel;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
            {/* Header */}
            <div className="border-b border-white/5 shrink-0">
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-sm">Back</span>
                    </button>

                    {/* Model Selector */}
                    <div className="relative" ref={modelRef}>
                        <button
                            onClick={() => setModelOpen(!modelOpen)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                       bg-zinc-800/60 border border-white/10 text-zinc-300
                                       hover:bg-zinc-700/60 hover:text-white transition-colors"
                        >
                            <Bot className="w-3.5 h-3.5 text-purple-400" />
                            {currentModelLabel}
                            <ChevronDown className={`w-3 h-3 transition-transform ${modelOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {modelOpen && (
                            <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 w-48 rounded-xl overflow-hidden z-50
                                            bg-zinc-900/90 backdrop-blur-xl border border-white/10 shadow-lg">
                                {MODELS.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => { setSelectedModel(m.id); setModelOpen(false); }}
                                        className={`w-full text-left px-4 py-2.5 text-xs transition-colors
                                            ${m.id === selectedModel
                                                ? 'bg-purple-500/15 text-purple-300 font-medium'
                                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={clearChat}
                        className="flex items-center gap-1.5 text-zinc-500 hover:text-red-400 transition-colors text-xs"
                        title="Clear chat"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
                    {messages.length === 0 && !loading && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col items-center justify-center pt-24 text-center"
                        >
                            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                                <Bot className="w-8 h-8 text-purple-400" />
                            </div>
                            <h2 className="text-xl font-bold text-zinc-200 mb-2">Chat with AI</h2>
                            <p className="text-sm text-zinc-500 max-w-sm">
                                Ask anything — code, research, ideas, or just chat. Powered by Gemini.
                            </p>
                        </motion.div>
                    )}

                    {messages.map((msg, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            {msg.role === 'ai' && (
                                <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                                    <Bot className="w-4 h-4 text-purple-400" />
                                </div>
                            )}
                            <div
                                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === 'user'
                                        ? 'bg-purple-600/20 border border-purple-500/20 text-zinc-200'
                                        : 'bg-zinc-800/50 border border-white/5 text-zinc-300'
                                    }`}
                            >
                                {msg.role === 'ai' ? (
                                    <div className="prose-cyber prose prose-sm max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {msg.text}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                )}
                            </div>
                            {msg.role === 'user' && (
                                <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                                    <User className="w-4 h-4 text-cyan-400" />
                                </div>
                            )}
                        </motion.div>
                    ))}

                    {loading && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                            <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/20 flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4 text-purple-400" />
                            </div>
                            <div className="bg-zinc-800/50 border border-white/5 rounded-2xl px-4 py-3 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </motion.div>
                    )}

                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Input Bar */}
            <div className="border-t border-white/5 shrink-0">
                <div className="max-w-3xl mx-auto px-4 py-3">
                    <div className="flex items-end gap-2 bg-zinc-900/60 border border-white/10 rounded-2xl px-4 py-2 backdrop-blur-md focus-within:border-purple-500/30 transition-colors">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={handleTextareaInput}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask anything..."
                            rows={1}
                            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-500 resize-none outline-none max-h-[120px] py-1.5"
                        />
                        <button
                            onClick={sendMessage}
                            disabled={!input.trim() || loading}
                            className="p-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:hover:bg-purple-600 transition-colors shrink-0"
                        >
                            <Send className="w-4 h-4 text-white" />
                        </button>
                    </div>
                    <p className="text-[10px] text-zinc-600 text-center mt-2">
                        {currentModelLabel} · History saved locally
                    </p>
                </div>
            </div>
        </div>
    );
}
