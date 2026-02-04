import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { readFileFromGitHub, writeFileToGitHub, isVercel } from './github-api';

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

export interface TechNews {
    id: string;
    title: string;
    summary: string;
    image_url: string | null;
    source_link: string;
    source_name: string;
    date: string;
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
const GITHUB_DB_PATH = 'data/data.json';

// In-memory cache for Vercel
let dbCache: Database | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000; // 1 minute cache

// Default empty database
const DEFAULT_DB: Database = {
    articles: [],
    apks: [],
    aiLabs: [],
    securityTools: [],
    downloadLogs: [],
    adminLogs: []
};

// Generate unique ID
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Ensure data directory exists (for local development)
function ensureDataDir(): void {
    if (!isVercel() && !existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Read database from filesystem (for local development)
function readDBFromFile(): Database {
    ensureDataDir();

    if (!existsSync(DB_PATH)) {
        writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
        return { ...DEFAULT_DB };
    }

    try {
        const data = readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data) as Database;
    } catch {
        console.error('Error reading database from file');
        return { ...DEFAULT_DB };
    }
}

// Write database to filesystem (for local development)
function writeDBToFile(data: Database): boolean {
    ensureDataDir();

    try {
        writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing database to file:', error);
        return false;
    }
}

// Read database (async version for GitHub API)
export async function readDBAsync(): Promise<Database> {
    if (isVercel()) {
        // Check cache first
        if (dbCache && Date.now() - cacheTimestamp < CACHE_TTL) {
            return dbCache;
        }

        try {
            const content = await readFileFromGitHub(GITHUB_DB_PATH);
            if (content) {
                dbCache = JSON.parse(content) as Database;
                cacheTimestamp = Date.now();
                return dbCache;
            }
        } catch (error) {
            console.error('Error reading from GitHub:', error);
        }
        return { ...DEFAULT_DB };
    } else {
        return readDBFromFile();
    }
}

// Write database (async version for GitHub API)
export async function writeDBAsync(data: Database): Promise<boolean> {
    if (isVercel()) {
        const success = await writeFileToGitHub(
            GITHUB_DB_PATH,
            JSON.stringify(data, null, 2),
            `Admin: Update data at ${new Date().toISOString()}`
        );
        if (success) {
            dbCache = data;
            cacheTimestamp = Date.now();
        }
        return success;
    } else {
        return writeDBToFile(data);
    }
}

// Synchronous read (uses cache on Vercel, file on localhost)
export function readDB(): Database {
    if (isVercel()) {
        // Return cache if available, otherwise empty
        return dbCache || { ...DEFAULT_DB };
    }
    return readDBFromFile();
}

// Synchronous write (local only, on Vercel use writeDBAsync)
export function writeDB(data: Database): boolean {
    if (isVercel()) {
        // Update cache synchronously, but actual write happens async
        dbCache = data;
        cacheTimestamp = Date.now();
        // Fire and forget the GitHub write
        writeDBAsync(data).catch(console.error);
        return true;
    }
    return writeDBToFile(data);
}

// Initialize cache on Vercel (call this at startup)
export async function initializeDB(): Promise<void> {
    if (isVercel() && !dbCache) {
        await readDBAsync();
    }
}

// =====================================================================
// CRUD Operations for Articles
// =====================================================================

export function getArticles(): Article[] {
    return readDB().articles;
}

export async function getArticlesAsync(): Promise<Article[]> {
    const db = await readDBAsync();
    return db.articles;
}

export function getArticleById(id: string): Article | undefined {
    return readDB().articles.find(a => a.id === id);
}

export async function addArticleAsync(article: Omit<Article, 'id' | 'date'>): Promise<Article> {
    const db = await readDBAsync();
    const newArticle: Article = {
        ...article,
        id: generateId(),
        date: new Date().toISOString()
    };
    db.articles.unshift(newArticle);  // Add to beginning so newest appears first
    await writeDBAsync(db);
    return newArticle;
}

export function addArticle(article: Omit<Article, 'id' | 'date'>): Article {
    const db = readDB();
    const newArticle: Article = {
        ...article,
        id: generateId(),
        date: new Date().toISOString()
    };
    db.articles.unshift(newArticle);  // Add to beginning so newest appears first
    writeDB(db);
    return newArticle;
}

export async function updateArticleAsync(id: string, updates: Partial<Article>): Promise<Article | null> {
    const db = await readDBAsync();
    const index = db.articles.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.articles[index] = { ...db.articles[index], ...updates };
    await writeDBAsync(db);
    return db.articles[index];
}

export function updateArticle(id: string, updates: Partial<Article>): Article | null {
    const db = readDB();
    const index = db.articles.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.articles[index] = { ...db.articles[index], ...updates };
    writeDB(db);
    return db.articles[index];
}

export async function deleteArticleAsync(id: string): Promise<boolean> {
    const db = await readDBAsync();
    const initialLength = db.articles.length;
    db.articles = db.articles.filter(a => a.id !== id);
    if (db.articles.length < initialLength) {
        await writeDBAsync(db);
        return true;
    }
    return false;
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

// =====================================================================
// CRUD Operations for APKs
// =====================================================================

export function getAPKs(): APK[] {
    return readDB().apks;
}

export async function getAPKsAsync(): Promise<APK[]> {
    const db = await readDBAsync();
    return db.apks;
}

export function getAPKById(id: string): APK | undefined {
    return readDB().apks.find(a => a.id === id);
}

export async function getAPKByIdAsync(id: string): Promise<APK | undefined> {
    const db = await readDBAsync();
    return db.apks.find(a => a.id === id);
}

export async function addAPKAsync(apk: Omit<APK, 'id'>): Promise<APK> {
    const db = await readDBAsync();
    const newAPK: APK = {
        ...apk,
        id: generateId()
    };
    db.apks.unshift(newAPK);  // Add to beginning so newest appears first
    await writeDBAsync(db);
    return newAPK;
}

export function addAPK(apk: Omit<APK, 'id'>): APK {
    const db = readDB();
    const newAPK: APK = {
        ...apk,
        id: generateId()
    };
    db.apks.unshift(newAPK);  // Add to beginning so newest appears first
    writeDB(db);
    return newAPK;
}

export async function updateAPKAsync(id: string, updates: Partial<APK>): Promise<APK | null> {
    const db = await readDBAsync();
    const index = db.apks.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.apks[index] = { ...db.apks[index], ...updates };
    await writeDBAsync(db);
    return db.apks[index];
}

export function updateAPK(id: string, updates: Partial<APK>): APK | null {
    const db = readDB();
    const index = db.apks.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.apks[index] = { ...db.apks[index], ...updates };
    writeDB(db);
    return db.apks[index];
}

export async function deleteAPKAsync(id: string): Promise<boolean> {
    const db = await readDBAsync();
    const initialLength = db.apks.length;
    db.apks = db.apks.filter(a => a.id !== id);
    if (db.apks.length < initialLength) {
        await writeDBAsync(db);
        return true;
    }
    return false;
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

// =====================================================================
// CRUD Operations for AI Labs
// =====================================================================

export function getAILabs(): AILab[] {
    return readDB().aiLabs;
}

export async function getAILabsAsync(): Promise<AILab[]> {
    const db = await readDBAsync();
    return db.aiLabs;
}

export function getAILabById(id: string): AILab | undefined {
    return readDB().aiLabs.find(a => a.id === id);
}

export async function addAILabAsync(lab: Omit<AILab, 'id'>): Promise<AILab> {
    const db = await readDBAsync();
    const newLab: AILab = {
        ...lab,
        id: generateId()
    };
    db.aiLabs.unshift(newLab);  // Add to beginning so newest appears first
    await writeDBAsync(db);
    return newLab;
}

export function addAILab(lab: Omit<AILab, 'id'>): AILab {
    const db = readDB();
    const newLab: AILab = {
        ...lab,
        id: generateId()
    };
    db.aiLabs.unshift(newLab);  // Add to beginning so newest appears first
    writeDB(db);
    return newLab;
}

export async function updateAILabAsync(id: string, updates: Partial<AILab>): Promise<AILab | null> {
    const db = await readDBAsync();
    const index = db.aiLabs.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.aiLabs[index] = { ...db.aiLabs[index], ...updates };
    await writeDBAsync(db);
    return db.aiLabs[index];
}

export function updateAILab(id: string, updates: Partial<AILab>): AILab | null {
    const db = readDB();
    const index = db.aiLabs.findIndex(a => a.id === id);
    if (index === -1) return null;

    db.aiLabs[index] = { ...db.aiLabs[index], ...updates };
    writeDB(db);
    return db.aiLabs[index];
}

export async function deleteAILabAsync(id: string): Promise<boolean> {
    const db = await readDBAsync();
    const initialLength = db.aiLabs.length;
    db.aiLabs = db.aiLabs.filter(a => a.id !== id);
    if (db.aiLabs.length < initialLength) {
        await writeDBAsync(db);
        return true;
    }
    return false;
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

// =====================================================================
// CRUD Operations for Security Tools
// =====================================================================

export function getSecurityTools(): SecurityTool[] {
    return readDB().securityTools;
}

export async function getSecurityToolsAsync(): Promise<SecurityTool[]> {
    const db = await readDBAsync();
    return db.securityTools;
}

export async function addSecurityToolAsync(tool: Omit<SecurityTool, 'id'>): Promise<SecurityTool> {
    const db = await readDBAsync();
    const newTool: SecurityTool = {
        ...tool,
        id: generateId()
    };
    db.securityTools.unshift(newTool);  // Add to beginning so newest appears first
    await writeDBAsync(db);
    return newTool;
}

export function addSecurityTool(tool: Omit<SecurityTool, 'id'>): SecurityTool {
    const db = readDB();
    const newTool: SecurityTool = {
        ...tool,
        id: generateId()
    };
    db.securityTools.unshift(newTool);  // Add to beginning so newest appears first
    writeDB(db);
    return newTool;
}

export async function deleteSecurityToolAsync(id: string): Promise<boolean> {
    const db = await readDBAsync();
    const initialLength = db.securityTools.length;
    db.securityTools = db.securityTools.filter(t => t.id !== id);
    if (db.securityTools.length < initialLength) {
        await writeDBAsync(db);
        return true;
    }
    return false;
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

// =====================================================================
// Tech News (from separate JSON file managed by Python script)
// =====================================================================

const TECH_NEWS_PATH = join(DATA_DIR, 'tech_news.json');
const GITHUB_TECH_NEWS_PATH = 'data/tech_news.json';

export function getTechNews(): TechNews[] {
    if (isVercel()) {
        // On Vercel, tech news is read from the bundled file
        try {
            const data = readFileSync(TECH_NEWS_PATH, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed.news || [];
        } catch {
            return [];
        }
    }

    try {
        if (!existsSync(TECH_NEWS_PATH)) {
            return [];
        }
        const data = readFileSync(TECH_NEWS_PATH, 'utf-8');
        const parsed = JSON.parse(data);
        return parsed.news || [];
    } catch (error) {
        console.error('Error reading tech news:', error);
        return [];
    }
}

export async function getTechNewsAsync(): Promise<TechNews[]> {
    if (isVercel()) {
        try {
            const content = await readFileFromGitHub(GITHUB_TECH_NEWS_PATH);
            if (content) {
                const parsed = JSON.parse(content);
                return parsed.news || [];
            }
        } catch (error) {
            console.error('Error reading tech news from GitHub:', error);
        }
        return [];
    }

    return getTechNews();
}

// =====================================================================
// Logging
// =====================================================================

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

export async function logAdminActionAsync(action: string, details: string, ip?: string): Promise<void> {
    const db = await readDBAsync();
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
    await writeDBAsync(db);
}

// =====================================================================
// Rate limiting and utilities
// =====================================================================

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
