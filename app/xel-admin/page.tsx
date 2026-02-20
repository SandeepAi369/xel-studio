'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldCheck, BookOpen, Brain, ShoppingBag,
    Plus, Trash2, Edit, LogOut, Eye, Download,
    Save, X, AlertTriangle, MessageSquare, Mail,
    Upload, Image as ImageIcon, Loader2, CheckCircle2
} from 'lucide-react';

// ─── Interfaces (aligned with Supabase schema) ────────────────
interface Article {
    id: string;
    title: string;
    image: string;
    content: string;
    date: string;
    category?: string;
}

interface APK {
    id: string;
    name: string;
    version: string;
    downloadUrl: string;
    size: string;
    icon?: string;
    description?: string;
}

interface AILab {
    id: string;
    name: string;
    description: string;
    icon?: string;
    url?: string;
    category?: string;
}

interface SecurityTool {
    id: string;
    title: string;
    description: string;
    icon?: string;
    url?: string;
    category?: string;
}

interface DownloadLog {
    id: string;
    apkId: string;
    ip: string;
    timestamp: string;
}

interface AdminLog {
    id: string;
    action: string;
    details: string;
    timestamp: string;
}

interface Feedback {
    id: string;
    created_at: string;
    content: string;
    user_email: string;
    user_name: string;
    user_id: string;
}

type ContentItem = Article | APK | AILab | SecurityTool;
type Tab = 'articles' | 'apks' | 'aiLabs' | 'security' | 'logs' | 'feedbacks';

// ─── Image Upload Component (Direct-to-Cloudinary) ─────────────
function ImageUploader({
    token,
    currentUrl,
    onUploaded,
}: {
    token: string;
    currentUrl: string;
    onUploaded: (url: string) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadResult, setUploadResult] = useState<{ url: string; savings: string } | null>(null);
    const [uploadError, setUploadError] = useState('');

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Client-side size check (10MB)
        if (file.size > 10 * 1024 * 1024) {
            setUploadError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`);
            return;
        }

        // Validate type
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
        if (!validTypes.includes(file.type)) {
            setUploadError('Invalid image type. Supported: JPEG, PNG, WebP, GIF, AVIF');
            return;
        }

        setUploading(true);
        setUploadError('');
        setUploadResult(null);
        setProgress(0);

        let lastError = '';

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                // Step 1: Get signed upload params from our server (tiny JSON — no file data)
                setProgress(5);
                const signRes = await fetch('/api/upload/sign', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (!signRes.ok) {
                    const signData = await signRes.json();
                    lastError = signData.error || `Auth failed (${signRes.status})`;
                    if (signRes.status === 401) break; // Don't retry auth errors
                    continue;
                }

                const { signature, timestamp, cloudName, apiKey, folder, transformation } = await signRes.json();

                // Step 2: Upload DIRECTLY to Cloudinary (browser → Cloudinary, Vercel is out)
                setProgress(10);
                const formData = new FormData();
                formData.append('file', file);
                formData.append('api_key', apiKey);
                formData.append('timestamp', String(timestamp));
                formData.append('signature', signature);
                formData.append('folder', folder);
                formData.append('transformation', transformation);
                formData.append('unique_filename', 'true');
                formData.append('overwrite', 'false');

                const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

                // Use XMLHttpRequest for upload progress tracking
                const result = await new Promise<{ secure_url: string; bytes: number; format: string; width: number; height: number }>((resolve, reject) => {
                    const xhr = new XMLHttpRequest();

                    xhr.upload.addEventListener('progress', (e) => {
                        if (e.lengthComputable) {
                            // Map 10-95% for the actual file upload
                            const pct = Math.round(10 + (e.loaded / e.total) * 85);
                            setProgress(pct);
                        }
                    });

                    xhr.addEventListener('load', () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            setProgress(100);
                            resolve(JSON.parse(xhr.responseText));
                        } else {
                            try {
                                const err = JSON.parse(xhr.responseText);
                                reject(new Error(err.error?.message || `Cloudinary error (${xhr.status})`));
                            } catch {
                                reject(new Error(`Upload failed (${xhr.status})`));
                            }
                        }
                    });

                    xhr.addEventListener('error', () => reject(new Error('Network error')));
                    xhr.addEventListener('timeout', () => reject(new Error('Upload timed out')));
                    xhr.timeout = 120000; // 2 min — direct upload can handle large files

                    xhr.open('POST', cloudinaryUrl);
                    xhr.send(formData);
                });

                const originalSize = file.size;
                const savings = Math.round((1 - result.bytes / originalSize) * 100);

                setUploadResult({ url: result.secure_url, savings: `${savings}%` });
                onUploaded(result.secure_url);
                setUploading(false);
                return;

            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                lastError = attempt === 0 ? `Retrying... (${msg})` : msg;
            }
        }

        setUploadError(lastError);
        setUploading(false);
    };

    return (
        <div className="space-y-2">
            <label className="text-xs text-zinc-400 font-medium uppercase tracking-wider">
                Article Image
            </label>

            {/* Current image preview */}
            {currentUrl && (
                <div className="relative w-full h-32 rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700">
                    <img src={currentUrl} alt="Preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
            )}

            {/* URL input + Upload button */}
            <div className="flex gap-2">
                <input
                    type="text"
                    placeholder="Image URL (or upload below)"
                    value={currentUrl}
                    onChange={(e) => onUploaded(e.target.value)}
                    className="flex-1 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                />
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="px-4 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium whitespace-nowrap"
                >
                    {uploading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> {progress}%</>
                    ) : (
                        <><Upload className="w-4 h-4" /> Upload</>
                    )}
                </button>
            </div>

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="hidden"
            />

            {/* Upload progress bar */}
            {uploading && (
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}

            {/* Result */}
            {uploadResult && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Uploaded directly to Cloudinary! Saved {uploadResult.savings}
                </div>
            )}
            {uploadError && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {uploadError}
                </div>
            )}
        </div>
    );
}

// ─── Main Admin Panel ──────────────────────────────────────────
function AdminPanel() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get('token');

    const [isValidToken, setIsValidToken] = useState<boolean | null>(null);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [sessionToken, setSessionToken] = useState('');
    const [csrfToken, setCsrfToken] = useState('');

    const [activeTab, setActiveTab] = useState<Tab>('articles');
    const [articles, setArticles] = useState<Article[]>([]);
    const [apks, setApks] = useState<APK[]>([]);
    const [aiLabs, setAiLabs] = useState<AILab[]>([]);
    const [securityTools, setSecurityTools] = useState<SecurityTool[]>([]);
    const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([]);
    const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [feedbackLoading, setFeedbackLoading] = useState(false);

    const [showForm, setShowForm] = useState(false);
    const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
    const [formData, setFormData] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!token) {
            router.push('/');
            return;
        }

        fetch(`/api/admin?token=${token}`)
            .then(res => res.json())
            .then(data => {
                if (!data.valid) {
                    router.push('/');
                } else {
                    setIsValidToken(true);
                }
            })
            .catch(() => router.push('/'));
    }, [token, router]);

    useEffect(() => {
        if (isLoggedIn && sessionToken) {
            loadData();
            loadFeedbacks();
        }
    }, [isLoggedIn, sessionToken]);

    const loadData = async () => {
        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getData', token })
            });
            const data = await res.json();
            if (data.error) {
                if (data.error === 'Session expired') {
                    setIsLoggedIn(false);
                    setError('Session expired. Please login again.');
                }
                return;
            }
            setArticles(data.articles || []);
            setApks(data.apks || []);
            setAiLabs(data.aiLabs || []);
            setSecurityTools(data.securityTools || []);
            setDownloadLogs(data.downloadLogs || []);
            setAdminLogs(data.adminLogs || []);
        } catch (err) {
            console.error('Failed to load data:', err);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', password })
            });
            const data = await res.json();

            if (data.error) {
                setError(data.error);
                setLoading(false);
                return;
            }

            setSessionToken(data.sessionToken);
            setCsrfToken(data.csrfToken);
            setIsLoggedIn(true);
            setPassword('');
        } catch {
            setError('Connection failed');
        }
        setLoading(false);
    };

    const handleLogout = async () => {
        await fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'logout', sessionToken })
        });
        setIsLoggedIn(false);
        setSessionToken('');
        router.push('/');
    };

    const getContentType = () => {
        if (activeTab === 'security') return 'securityTool';
        if (activeTab === 'aiLabs') return 'aiLab';
        if (activeTab === 'apks') return 'apk';
        return 'article';
    };

    const handleAdd = async () => {
        setLoading(true);
        setError('');

        const payload = JSON.stringify({
            action: 'add',
            token,
            csrfToken,
            contentType: getContentType(),
            data: formData
        });

        if (payload.length > 4 * 1024 * 1024) {
            setError('Content too large. Maximum allowed is 4MB.');
            setLoading(false);
            return;
        }

        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });

            if (!res.ok) {
                const text = await res.text();
                setError(`Server error (${res.status}): ${text.substring(0, 200)}`);
                setLoading(false);
                return;
            }

            const data = await res.json();
            if (data.success) {
                loadData();
                setShowForm(false);
                setFormData({});
            } else {
                setError(data.error + (data.details ? `: ${data.details}` : ''));
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            setError(`Network error: ${errorMsg}`);
        }
        setLoading(false);
    };

    const handleUpdate = async () => {
        if (!editingItem) return;
        setLoading(true);
        setError('');

        const payload = JSON.stringify({
            action: 'update',
            token,
            csrfToken,
            contentType: getContentType(),
            itemId: editingItem.id,
            data: formData
        });

        if (payload.length > 4 * 1024 * 1024) {
            setError('Content too large. Maximum allowed is 4MB.');
            setLoading(false);
            return;
        }

        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });

            if (!res.ok) {
                const text = await res.text();
                setError(`Server error (${res.status}): ${text.substring(0, 200)}`);
                setLoading(false);
                return;
            }

            const data = await res.json();
            if (data.success) {
                loadData();
                setEditingItem(null);
                setFormData({});
            } else {
                setError(data.error + (data.details ? `: ${data.details}` : ''));
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            setError(`Network error: ${errorMsg}`);
        }
        setLoading(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this item?')) return;

        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete',
                    token,
                    csrfToken,
                    contentType: getContentType(),
                    itemId: id
                })
            });
            const data = await res.json();
            if (data.success) {
                loadData();
            } else {
                setError(data.error);
            }
        } catch {
            setError('Failed to delete item');
        }
    };

    // ─── Feedback Operations ──────────────────────────────────
    const loadFeedbacks = async () => {
        setFeedbackLoading(true);
        try {
            const res = await fetch(`/api/feedback?session=${sessionToken}`);
            const data = await res.json();
            if (data.error) {
                if (data.error === 'Unauthorized') {
                    setIsLoggedIn(false);
                    setError('Session expired. Please login again.');
                } else {
                    console.error('Feedback load error:', data.error);
                }
            } else {
                setFeedbacks(data.feedbacks || []);
            }
        } catch (err) {
            console.error('Failed to load feedbacks:', err);
        }
        setFeedbackLoading(false);
    };

    const deleteFeedback = async (id: string) => {
        if (!confirm('Delete this feedback?')) return;
        try {
            const res = await fetch('/api/feedback', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionToken, feedbackId: id })
            });
            const data = await res.json();
            if (data.success) {
                setFeedbacks(prev => prev.filter(f => f.id !== id));
            } else {
                setError(data.error || 'Failed to delete feedback');
            }
        } catch {
            setError('Failed to delete feedback');
        }
    };

    const startEdit = (item: ContentItem) => {
        setEditingItem(item);
        const itemRecord: Record<string, string> = {};
        Object.entries(item).forEach(([key, value]) => {
            if (typeof value === 'string') {
                itemRecord[key] = value;
            }
        });
        setFormData(itemRecord);
    };

    const closeForm = () => {
        setShowForm(false);
        setEditingItem(null);
        setFormData({});
    };

    // ─── Loading / Token Check ────────────────────────────────
    if (isValidToken === null) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // ─── Login Screen ─────────────────────────────────────────
    if (!isLoggedIn) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md p-8 bg-zinc-900/50 border border-zinc-800 rounded-2xl"
                >
                    <div className="text-center mb-8">
                        <ShieldCheck className="w-12 h-12 mx-auto mb-4 text-emerald-400" />
                        <h1 className="text-2xl font-bold text-white">XeL Admin</h1>
                        <p className="text-zinc-500 text-sm mt-2">Ghost Protocol Access</p>
                    </div>

                    <form onSubmit={handleLogin}>
                        <div className="mb-6">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password"
                                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
                                autoFocus
                            />
                        </div>

                        {error && (
                            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Authenticating...' : 'Access Dashboard'}
                        </button>
                    </form>
                </motion.div>
            </div>
        );
    }

    // ─── Dashboard ─────────────────────────────────────────────
    const showModal = showForm || editingItem !== null;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            <header className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldCheck className="w-8 h-8 text-emerald-400" />
                        <span className="text-xl font-bold">XeL Admin</span>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 text-zinc-400 hover:text-white transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Logout
                    </button>
                </div>
            </header>

            <div className="border-b border-zinc-800">
                <div className="max-w-7xl mx-auto px-4">
                    <nav className="flex gap-1 -mb-px overflow-x-auto">
                        {([
                            { id: 'articles' as Tab, icon: BookOpen, label: 'Articles' },
                            { id: 'apks' as Tab, icon: ShoppingBag, label: 'APKs' },
                            { id: 'aiLabs' as Tab, icon: Brain, label: 'AI Labs' },
                            { id: 'security' as Tab, icon: ShieldCheck, label: 'Security' },
                            { id: 'feedbacks' as Tab, icon: MessageSquare, label: 'Feedbacks' },
                            { id: 'logs' as Tab, icon: Eye, label: 'Logs' },
                        ]).map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); closeForm(); }}
                                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id
                                    ? 'border-emerald-500 text-emerald-400'
                                    : 'border-transparent text-zinc-500 hover:text-white'
                                    }`}
                            >
                                <tab.icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            <main className="max-w-7xl mx-auto px-4 py-8">
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        {error}
                        <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
                    </div>
                )}

                {activeTab !== 'logs' && activeTab !== 'feedbacks' && (
                    <div className="mb-6 flex justify-between items-center">
                        <h2 className="text-xl font-semibold capitalize">{activeTab}</h2>
                        <button
                            onClick={() => { setShowForm(true); setEditingItem(null); setFormData({}); }}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Add New
                        </button>
                    </div>
                )}

                {/* ─── Modal Form ─────────────────────────────── */}
                <AnimatePresence>
                    {showModal && activeTab !== 'logs' && activeTab !== 'feedbacks' && (
                        <motion.div
                            key="modal"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
                            onClick={closeForm}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
                            >
                                <h3 className="text-lg font-semibold mb-6">
                                    {editingItem ? 'Edit' : 'Add'} {activeTab === 'security' ? 'Security Tool' : activeTab.slice(0, -1)}
                                </h3>

                                <div className="space-y-4">
                                    {/* ── Article Form ─── */}
                                    {activeTab === 'articles' && (
                                        <>
                                            <input type="text" placeholder="Title" value={formData.title || ''} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />

                                            {/* Cloudinary Image Upload */}
                                            <ImageUploader
                                                token={token || ''}
                                                currentUrl={formData.image || ''}
                                                onUploaded={(url) => setFormData({ ...formData, image: url })}
                                            />

                                            <textarea placeholder="Content (Markdown)" rows={8} value={formData.content || ''} onChange={e => setFormData({ ...formData, content: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono text-sm" />
                                            <input type="text" placeholder="Category" value={formData.category || ''} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                        </>
                                    )}

                                    {/* ── APK Form ─── */}
                                    {activeTab === 'apks' && (
                                        <>
                                            <input type="text" placeholder="Name" value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Version (e.g., 1.0.0)" value={formData.version || ''} onChange={e => setFormData({ ...formData, version: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Download URL (GitHub releases)" value={formData.downloadUrl || ''} onChange={e => setFormData({ ...formData, downloadUrl: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Size (e.g., 15 MB)" value={formData.size || ''} onChange={e => setFormData({ ...formData, size: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Icon URL (optional)" value={formData.icon || ''} onChange={e => setFormData({ ...formData, icon: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <textarea placeholder="Description" rows={3} value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                        </>
                                    )}

                                    {/* ── AI Lab Form (aligned with schema) ─── */}
                                    {activeTab === 'aiLabs' && (
                                        <>
                                            <input type="text" placeholder="Name" value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <textarea placeholder="Description" rows={4} value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Icon URL (optional)" value={formData.icon || ''} onChange={e => setFormData({ ...formData, icon: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="URL (optional)" value={formData.url || ''} onChange={e => setFormData({ ...formData, url: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Category (optional)" value={formData.category || ''} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                        </>
                                    )}

                                    {/* ── Security Tool Form (aligned with schema) ─── */}
                                    {activeTab === 'security' && (
                                        <>
                                            <input type="text" placeholder="Tool Title" value={formData.title || ''} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <textarea placeholder="Description" rows={3} value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Icon URL (optional)" value={formData.icon || ''} onChange={e => setFormData({ ...formData, icon: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="URL (optional)" value={formData.url || ''} onChange={e => setFormData({ ...formData, url: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Category (optional)" value={formData.category || ''} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                        </>
                                    )}
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <button onClick={closeForm} className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                                        Cancel
                                    </button>
                                    <button
                                        onClick={editingItem ? handleUpdate : handleAdd}
                                        disabled={loading}
                                        className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Save className="w-4 h-4" />
                                        {loading ? 'Saving...' : 'Save'}
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ─── Content Lists ──────────────────────────── */}

                {activeTab === 'articles' && (
                    <div className="grid gap-4">
                        {articles.length === 0 ? (
                            <div className="text-center py-12 text-zinc-500">No articles yet. Add your first article!</div>
                        ) : articles.map(item => (
                            <div key={item.id} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-center gap-4">
                                {item.image && (
                                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                                        <img src={item.image} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                    </div>
                                )}
                                {!item.image && <BookOpen className="w-8 h-8 text-cyan-400 flex-shrink-0" />}
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium truncate">{item.title}</h3>
                                    <p className="text-sm text-zinc-500">{new Date(item.date).toLocaleDateString()}{item.category ? ` • ${item.category}` : ''}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => startEdit(item)} className="p-2 hover:bg-zinc-800 rounded-lg"><Edit className="w-4 h-4 text-zinc-400" /></button>
                                    <button onClick={() => handleDelete(item.id)} className="p-2 hover:bg-red-500/20 rounded-lg"><Trash2 className="w-4 h-4 text-red-400" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'apks' && (
                    <div className="grid gap-4">
                        {apks.length === 0 ? (
                            <div className="text-center py-12 text-zinc-500">No APKs yet. Add your first APK!</div>
                        ) : apks.map(item => (
                            <div key={item.id} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-center gap-4">
                                <Download className="w-8 h-8 text-emerald-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium truncate">{item.name}</h3>
                                    <p className="text-sm text-zinc-500">v{item.version} • {item.size}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => startEdit(item)} className="p-2 hover:bg-zinc-800 rounded-lg"><Edit className="w-4 h-4 text-zinc-400" /></button>
                                    <button onClick={() => handleDelete(item.id)} className="p-2 hover:bg-red-500/20 rounded-lg"><Trash2 className="w-4 h-4 text-red-400" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'aiLabs' && (
                    <div className="grid gap-4">
                        {aiLabs.length === 0 ? (
                            <div className="text-center py-12 text-zinc-500">No AI Labs yet. Add your first experiment!</div>
                        ) : aiLabs.map(item => (
                            <div key={item.id} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-center gap-4">
                                <Brain className="w-8 h-8 text-purple-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium truncate">{item.name}</h3>
                                    <p className="text-sm text-zinc-500">{item.category || 'Uncategorized'}{item.url ? ` • ${item.url}` : ''}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => startEdit(item)} className="p-2 hover:bg-zinc-800 rounded-lg"><Edit className="w-4 h-4 text-zinc-400" /></button>
                                    <button onClick={() => handleDelete(item.id)} className="p-2 hover:bg-red-500/20 rounded-lg"><Trash2 className="w-4 h-4 text-red-400" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'security' && (
                    <div className="grid gap-4">
                        {securityTools.length === 0 ? (
                            <div className="text-center py-12 text-zinc-500">No security tools yet. Add your first tool!</div>
                        ) : securityTools.map(item => (
                            <div key={item.id} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-center gap-4">
                                <ShieldCheck className="w-8 h-8 text-red-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium truncate">{item.title}</h3>
                                    <p className="text-sm text-zinc-500">{item.category || 'Uncategorized'}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => startEdit(item)} className="p-2 hover:bg-zinc-800 rounded-lg"><Edit className="w-4 h-4 text-zinc-400" /></button>
                                    <button onClick={() => handleDelete(item.id)} className="p-2 hover:bg-red-500/20 rounded-lg"><Trash2 className="w-4 h-4 text-red-400" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'feedbacks' && (
                    <div>
                        <div className="mb-6 flex justify-between items-center">
                            <h2 className="text-xl font-semibold">User Feedbacks</h2>
                            <button
                                onClick={loadFeedbacks}
                                disabled={feedbackLoading}
                                className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {feedbackLoading ? 'Loading...' : 'Refresh'}
                            </button>
                        </div>
                        <div className="grid gap-4">
                            {feedbacks.length === 0 ? (
                                <div className="text-center py-12 text-zinc-500">
                                    {feedbackLoading ? (
                                        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                                    ) : (
                                        'No feedbacks yet'
                                    )}
                                </div>
                            ) : feedbacks.map(fb => (
                                <div key={fb.id} className="p-5 bg-zinc-900/50 border border-zinc-800 rounded-xl">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-2">
                                                <MessageSquare className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                                                <span className="font-medium text-white">{fb.user_name}</span>
                                            </div>
                                            <a
                                                href={`mailto:${fb.user_email}`}
                                                className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors mb-3"
                                            >
                                                <Mail className="w-3.5 h-3.5" />
                                                {fb.user_email}
                                            </a>
                                            <p className="text-zinc-300 text-sm whitespace-pre-wrap">{fb.content}</p>
                                            <p className="text-xs text-zinc-600 mt-3">
                                                {new Date(fb.created_at).toLocaleString()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => deleteFeedback(fb.id)}
                                            className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors flex-shrink-0"
                                            title="Delete feedback"
                                        >
                                            <Trash2 className="w-4 h-4 text-red-400" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'logs' && (
                    <div className="space-y-8">
                        <div>
                            <h3 className="text-lg font-semibold mb-4">Recent Downloads</h3>
                            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                                {downloadLogs.length === 0 ? (
                                    <div className="p-8 text-center text-zinc-500">No downloads yet</div>
                                ) : (
                                    <div className="divide-y divide-zinc-800 max-h-64 overflow-y-auto">
                                        {downloadLogs.map((log) => (
                                            <div key={log.id} className="p-3 text-sm">
                                                <span className="text-zinc-400">{new Date(log.timestamp).toLocaleString()}</span>
                                                <span className="mx-2 text-zinc-600">|</span>
                                                <span className="text-emerald-400">APK: {log.apkId}</span>
                                                <span className="mx-2 text-zinc-600">|</span>
                                                <span className="text-zinc-500">IP: {log.ip}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-semibold mb-4">Admin Activity</h3>
                            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                                {adminLogs.length === 0 ? (
                                    <div className="p-8 text-center text-zinc-500">No admin activity yet</div>
                                ) : (
                                    <div className="divide-y divide-zinc-800 max-h-64 overflow-y-auto">
                                        {adminLogs.map((log) => (
                                            <div key={log.id} className="p-3 text-sm">
                                                <span className="text-zinc-400">{new Date(log.timestamp).toLocaleString()}</span>
                                                <span className="mx-2 text-zinc-600">|</span>
                                                <span className="text-purple-400">{log.action}</span>
                                                <span className="mx-2 text-zinc-600">|</span>
                                                <span className="text-zinc-500 truncate">{log.details}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default function AdminPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
        }>
            <AdminPanel />
        </Suspense>
    );
}
