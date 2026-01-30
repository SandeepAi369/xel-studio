import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Type definitions
export interface Article {
    id: string;
    title: string;
    image: string;
    content: string;
    date: string;
    category?: string;
}

export interface APK {
    id: string;
    name: string;
    version: string;
    downloadUrl: string;
    size: string;
    icon?: string;
    description?: string;
    category?: string;
}

export interface AILab {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'experimental' | 'archived';
    demoUrl?: string;
    image?: string;
}

export interface SecurityTool {
    id: string;
    name: string;
    description: string;
    category: string;
    link?: string;
}

export interface DownloadLog {
    id: string;
    apkId: string;
    ip: string;
    timestamp: string;
    userAgent?: string;
}

export interface AdminLog {
    id: string;
    action: string;
    details: string;
    timestamp: string;
    ip?: string;
}

export interface Database {
    articles: Article[];
    apks: APK[];
    aiLabs: AILab[];
    securityTools: SecurityTool[];
    downloadLogs: DownloadLog[];
    adminLogs: AdminLog[];
}

// Path to database file
const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'data.json');

// Generate unique ID
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Ensure data directory exists
function ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Read database
export function readDB(): Database {
    ensureDataDir();

    if (!existsSync(DB_PATH)) {
        const defaultDB: Database = {
            articles: [],
            apks: [],
            aiLabs: [],
            securityTools: [],
            downloadLogs: [],
            adminLogs: []
        };
        writeFileSync(DB_PATH, JSON.stringify(defaultDB, null, 2));
        return defaultDB;
    }

    try {
        const data = readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data) as Database;
    } catch {
        console.error('Error reading database, returning empty');
        return {
            articles: [],
            apks: [],
            aiLabs: [],
            securityTools: [],
            downloadLogs: [],
            adminLogs: []
        };
    }
}

// Write database atomically
export function writeDB(data: Database): boolean {
    ensureDataDir();

    try {
        const tempPath = `${DB_PATH}.tmp`;
        writeFileSync(tempPath, JSON.stringify(data, null, 2));
        writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing database:', error);
        return false;
    }
}

// CRUD Operations for Articles
export function getArticles(): Article[] {
    return readDB().articles;
}

export function getArticleById(id: string): Article | undefined {
    return readDB().articles.find(a => a.id === id);
}

export function addArticle(article: Omit<Article, 'id' | 'date'>): Article {
    const db = readDB();
    const newArticle: Article = {
        ...article,
        id: generateId(),
        date: new Date().toISOString()
    };
    db.articles.push(newArticle);
    writeDB(db);
    return newArticle;
}

export function updateArticle(id: string, updates: Partial<Article>): Article | null {
    const db = readDB();
    const index = db.articles.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.articles[index] = { ...db.articles[index], ...updates };
    writeDB(db);
    return db.articles[index];
}

export function deleteArticle(id: string): boolean {
    const db = readDB();
    const initialLength = db.articles.length;
    db.articles = db.articles.filter(a => a.id !== id);
    if (db.articles.length < initialLength) {
        writeDB(db);
        return true;
    }
    return false;
}

// CRUD Operations for APKs
export function getAPKs(): APK[] {
    return readDB().apks;
}

export function getAPKById(id: string): APK | undefined {
    return readDB().apks.find(a => a.id === id);
}

export function addAPK(apk: Omit<APK, 'id'>): APK {
    const db = readDB();
    const newAPK: APK = {
        ...apk,
        id: generateId()
    };
    db.apks.push(newAPK);
    writeDB(db);
    return newAPK;
}

export function updateAPK(id: string, updates: Partial<APK>): APK | null {
    const db = readDB();
    const index = db.apks.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.apks[index] = { ...db.apks[index], ...updates };
    writeDB(db);
    return db.apks[index];
}

export function deleteAPK(id: string): boolean {
    const db = readDB();
    const initialLength = db.apks.length;
    db.apks = db.apks.filter(a => a.id !== id);
    if (db.apks.length < initialLength) {
        writeDB(db);
        return true;
    }
    return false;
}

// CRUD Operations for AI Labs
export function getAILabs(): AILab[] {
    return readDB().aiLabs;
}

export function getAILabById(id: string): AILab | undefined {
    return readDB().aiLabs.find(a => a.id === id);
}

export function addAILab(lab: Omit<AILab, 'id'>): AILab {
    const db = readDB();
    const newLab: AILab = {
        ...lab,
        id: generateId()
    };
    db.aiLabs.push(newLab);
    writeDB(db);
    return newLab;
}

export function updateAILab(id: string, updates: Partial<AILab>): AILab | null {
    const db = readDB();
    const index = db.aiLabs.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.aiLabs[index] = { ...db.aiLabs[index], ...updates };
    writeDB(db);
    return db.aiLabs[index];
}

export function deleteAILab(id: string): boolean {
    const db = readDB();
    const initialLength = db.aiLabs.length;
    db.aiLabs = db.aiLabs.filter(a => a.id !== id);
    if (db.aiLabs.length < initialLength) {
        writeDB(db);
        return true;
    }
    return false;
}

// CRUD Operations for Security Tools
export function getSecurityTools(): SecurityTool[] {
    return readDB().securityTools;
}

export function addSecurityTool(tool: Omit<SecurityTool, 'id'>): SecurityTool {
    const db = readDB();
    const newTool: SecurityTool = {
        ...tool,
        id: generateId()
    };
    db.securityTools.push(newTool);
    writeDB(db);
    return newTool;
}

export function deleteSecurityTool(id: string): boolean {
    const db = readDB();
    const initialLength = db.securityTools.length;
    db.securityTools = db.securityTools.filter(t => t.id !== id);
    if (db.securityTools.length < initialLength) {
        writeDB(db);
        return true;
    }
    return false;
}

// Logging
export function logDownload(apkId: string, ip: string, userAgent?: string): void {
    const db = readDB();
    db.downloadLogs.push({
        id: generateId(),
        apkId,
        ip,
        timestamp: new Date().toISOString(),
        userAgent
    });
    // Keep only last 1000 logs
    if (db.downloadLogs.length > 1000) {
        db.downloadLogs = db.downloadLogs.slice(-1000);
    }
    writeDB(db);
}

export function logAdminAction(action: string, details: string, ip?: string): void {
    const db = readDB();
    db.adminLogs.push({
        id: generateId(),
        action,
        details,
        timestamp: new Date().toISOString(),
        ip
    });
    // Keep only last 500 logs
    if (db.adminLogs.length > 500) {
        db.adminLogs = db.adminLogs.slice(-500);
    }
    writeDB(db);
}

// Rate limiting check
export function checkRateLimit(ip: string, limit: number = 5): boolean {
    const db = readDB();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const recentDownloads = db.downloadLogs.filter(
        log => log.ip === ip && log.timestamp > oneHourAgo
    );

    return recentDownloads.length < limit;
}

// URL validation for downloads
const ALLOWED_DOMAINS = [
    'github.com',
    'raw.githubusercontent.com',
    'objects.githubusercontent.com',
    'github-releases.githubusercontent.com'
];

export function isValidDownloadUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return ALLOWED_DOMAINS.some(domain =>
            parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        );
    } catch {
        return false;
    }
}

// Sanitize input
export function sanitizeInput(input: string): string {
    return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}
