'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldCheck, BookOpen, Brain, ShoppingBag,
    Plus, Trash2, Edit, LogOut, Eye, Download,
    Save, X, AlertTriangle
} from 'lucide-react';

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
    status: 'active' | 'experimental' | 'archived';
    demoUrl?: string;
}

interface SecurityTool {
    id: string;
    name: string;
    description: string;
    category: string;
    link?: string;
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

type ContentItem = Article | APK | AILab | SecurityTool;
type Tab = 'articles' | 'apks' | 'aiLabs' | 'security' | 'logs';

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
        }
    }, [isLoggedIn, sessionToken]);

    const loadData = async () => {
        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getData', sessionToken })
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
        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'add',
                    sessionToken,
                    csrfToken,
                    contentType: getContentType(),
                    data: formData
                })
            });
            const data = await res.json();
            if (data.success) {
                loadData();
                setShowForm(false);
                setFormData({});
            } else {
                setError(data.error);
            }
        } catch {
            setError('Failed to add item');
        }
        setLoading(false);
    };

    const handleUpdate = async () => {
        if (!editingItem) return;
        setLoading(true);

        try {
            const res = await fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update',
                    sessionToken,
                    csrfToken,
                    contentType: getContentType(),
                    itemId: editingItem.id,
                    data: formData
                })
            });
            const data = await res.json();
            if (data.success) {
                loadData();
                setEditingItem(null);
                setFormData({});
            } else {
                setError(data.error);
            }
        } catch {
            setError('Failed to update item');
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
                    sessionToken,
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

    if (isValidToken === null) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

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
                    <nav className="flex gap-1 -mb-px">
                        {[
                            { id: 'articles' as Tab, icon: BookOpen, label: 'Articles' },
                            { id: 'apks' as Tab, icon: ShoppingBag, label: 'APKs' },
                            { id: 'aiLabs' as Tab, icon: Brain, label: 'AI Labs' },
                            { id: 'security' as Tab, icon: ShieldCheck, label: 'Security' },
                            { id: 'logs' as Tab, icon: Eye, label: 'Logs' },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); closeForm(); }}
                                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${activeTab === tab.id
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

                {activeTab !== 'logs' && (
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

                <AnimatePresence>
                    {showModal && activeTab !== 'logs' && (
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
                                    {editingItem ? 'Edit' : 'Add'} {activeTab.slice(0, -1)}
                                </h3>

                                <div className="space-y-4">
                                    {activeTab === 'articles' && (
                                        <>
                                            <input type="text" placeholder="Title" value={formData.title || ''} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Image URL" value={formData.image || ''} onChange={e => setFormData({ ...formData, image: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <textarea placeholder="Content (Markdown)" rows={6} value={formData.content || ''} onChange={e => setFormData({ ...formData, content: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Category" value={formData.category || ''} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                        </>
                                    )}

                                    {activeTab === 'apks' && (
                                        <>
                                            <input type="text" placeholder="Name" value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Version (e.g., 1.0.0)" value={formData.version || ''} onChange={e => setFormData({ ...formData, version: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Download URL (GitHub releases)" value={formData.downloadUrl || ''} onChange={e => setFormData({ ...formData, downloadUrl: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Size (e.g., 15 MB)" value={formData.size || ''} onChange={e => setFormData({ ...formData, size: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <textarea placeholder="Description" rows={3} value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                        </>
                                    )}

                                    {activeTab === 'aiLabs' && (
                                        <>
                                            <input type="text" placeholder="Name" value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <textarea placeholder="Description" rows={4} value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <select value={formData.status || 'experimental'} onChange={e => setFormData({ ...formData, status: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white">
                                                <option value="active">Active</option>
                                                <option value="experimental">Experimental</option>
                                                <option value="archived">Archived</option>
                                            </select>
                                            <input type="text" placeholder="Demo URL (optional)" value={formData.demoUrl || ''} onChange={e => setFormData({ ...formData, demoUrl: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                        </>
                                    )}

                                    {activeTab === 'security' && (
                                        <>
                                            <input type="text" placeholder="Tool Name" value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <textarea placeholder="Description" rows={3} value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Category" value={formData.category || ''} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
                                            <input type="text" placeholder="Link (optional)" value={formData.link || ''} onChange={e => setFormData({ ...formData, link: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" />
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

                {activeTab === 'articles' && (
                    <div className="grid gap-4">
                        {articles.length === 0 ? (
                            <div className="text-center py-12 text-zinc-500">No articles yet. Add your first article!</div>
                        ) : articles.map(item => (
                            <div key={item.id} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-center gap-4">
                                <BookOpen className="w-8 h-8 text-cyan-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium truncate">{item.title}</h3>
                                    <p className="text-sm text-zinc-500">{new Date(item.date).toLocaleDateString()}</p>
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
                                    <p className="text-sm text-zinc-500 capitalize">{item.status}</p>
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
                                    <h3 className="font-medium truncate">{item.name}</h3>
                                    <p className="text-sm text-zinc-500">{item.category}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleDelete(item.id)} className="p-2 hover:bg-red-500/20 rounded-lg"><Trash2 className="w-4 h-4 text-red-400" /></button>
                                </div>
                            </div>
                        ))}
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
