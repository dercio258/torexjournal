import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import {
    CloudflareR2StorageService,
    R2StorageConfig,
    StoredObjectResult,
    normalizeSafeExtension,
    resolveMimeForExtension,
} from '../common/security/cloudflare-r2-storage.service';

export type MigrationVisibility = 'public' | 'private';
export type PublicFolder = 'avatars' | 'network';
export type PrivateFolder =
    | 'journal-screenshots'
    | 'backtest-screenshots'
    | 'mental-logs'
    | 'reports';

export interface SqlExecutor {
    query(sql: string, params?: any[]): Promise<any>;
}

export interface R2MigrationClient {
    getConfig(): R2StorageConfig;
    computeOwnerTag(userId: string): string;
    sanitizeObjectKey(rawKey: string): string | null;
    verifyR2Connection(): Promise<{
        ok: boolean;
        publicBucket: { name: string; ok: boolean; status: number; detail?: string };
        privateBucket: { name: string; ok: boolean; status: number; detail?: string };
    }>;
    objectExistsInR2(visibility: MigrationVisibility, key: string): Promise<boolean>;
    uploadRawObjectToR2(params: {
        visibility: MigrationVisibility;
        key: string;
        buffer: Buffer;
        contentType: string;
        cacheControl?: string;
    }): Promise<StoredObjectResult>;
}

export interface MigrationCliOptions {
    apply: boolean;
    dryRun: boolean;
    cleanupLocal: boolean;
    includeOrphans: boolean;
    skipPreflight: boolean;
    help: boolean;
    onlyTables: string[] | null;
    extraRoots: string[];
    manifestPath: string | null;
}

export type ClassifiedMediaRef =
    | { kind: 'empty' }
    | { kind: 'already-r2-public'; normalizedUrl: string; changed: boolean }
    | {
          kind: 'private-gateway';
          key: string;
          fragment: string;
          normalizedUrl: string;
          changed: boolean;
      }
    | {
          kind: 'local-upload';
          relativePath: string;
          fragment: string;
      }
    | {
          kind: 'data-uri';
          mimeType: string;
          ext: string;
          base64Data: string;
          fragment: string;
      }
    | { kind: 'external-or-other' };

export interface DetectedFileFormat {
    ext: string;
    contentType: string;
    detectedByMagic: boolean;
    rejectedReason?: string;
}

export interface MigrationMappingEntry {
    table: string;
    rowId: string;
    column: string;
    oldRef: string;
    newRef: string;
    action:
        | 'uploaded-local-to-r2'
        | 'uploaded-data-uri-to-r2'
        | 'synced-private-local-to-r2'
        | 'normalized-url-only'
        | 'deduplicated-reuse'
        | 'dry-run-would-upload'
        | 'dry-run-would-sync-private'
        | 'dry-run-would-normalize';
    visibility: MigrationVisibility;
    bucket: string;
    key: string;
    localPath?: string;
    sha256?: string;
    sizeBytes?: number;
    contentType?: string;
}

export interface MissingFileEntry {
    table: string;
    rowId: string;
    column: string;
    ref: string;
    reason: string;
}

export interface OrphanFileEntry {
    localPath: string;
    relativePath: string;
    rootType: 'uploads' | 'private-uploads';
    sizeBytes: number;
    action: 'reported-only' | 'migrated-to-r2' | 'already-in-r2' | 'dry-run-would-migrate' | 'skipped-unsafe';
    bucket?: string;
    key?: string;
    reason?: string;
}

export interface MigrationSummary {
    tablesScanned: number;
    tablesSkippedMissing: number;
    rowsScanned: number;
    rowsUpdated: number;
    refsInspected: number;
    refsAlreadyOnR2: number;
    refsExternalSkipped: number;
    refsNormalizedOnly: number;
    uploadedPublicToR2: number;
    uploadedPrivateToR2: number;
    privateLocalSyncedToR2: number;
    dataUrisConverted: number;
    deduplicatedReuses: number;
    missingLocalFiles: number;
    unsafeFilesSkipped: number;
    orphansFound: number;
    orphansMigrated: number;
    bytesUploaded: number;
    localFilesDeleted: number;
    errorsCount: number;
}

export interface MigrationManifest {
    version: '1.0';
    mode: 'dry-run' | 'apply';
    startedAt: string;
    finishedAt: string;
    searchRoots: {
        uploadsDirs: string[];
        privateUploadsDirs: string[];
    };
    r2Target: {
        accountId: string;
        endpoint: string;
        publicBucket: string;
        privateBucket: string;
        publicBaseUrl: string;
        sharedBucketWarning: boolean;
    };
    summary: MigrationSummary;
    mappings: MigrationMappingEntry[];
    missingFiles: MissingFileEntry[];
    orphans: OrphanFileEntry[];
    deletedLocalFiles: string[];
    errors: Array<{ context: string; message: string }>;
}

const KNOWN_TARGETS = [
    'users',
    'leaderboard_ranks',
    'network_posts',
    'network_video_lessons',
    'mental_logs',
    'daily_notes',
    'trade_notes',
    'general_notes',
    'backtest_session_blobs',
    'backtest_sessions',
    'backtest_strategies',
    'backtest_hypotheses',
] as const;

const PLACEHOLDER_PATTERNS = [
    /^sua_/i,
    /^seu_/i,
    /^your_/i,
    /change[_-]?me/i,
    /^placeholder/i,
    /^replace[_-]?me/i,
    /<[^>]+>/,
    /^example/i,
    /^xxx+$/i,
];

const LOCAL_UPLOAD_HOST_ALLOWLIST = new Set([
    'torexjournal.com',
    'www.torexjournal.com',
    'api.torexjournal.com',
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
]);

const DATA_URI_RE =
    /^data:(image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/i;

const MAX_INLINE_DATA_URI_BYTES = 25 * 1024 * 1024; // 25 MB safety cap
const MAX_LOCAL_FILE_BYTES = 250 * 1024 * 1024; // 250 MB safety cap (allows local videos)

export function isPlaceholderValue(value?: string | null): boolean {
    const trimmed = String(value || '').trim();
    if (!trimmed) return true;
    return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

export function validateR2ConfigForApply(cfg: R2StorageConfig): string[] {
    const issues: string[] = [];
    if (isPlaceholderValue(cfg.accountId) && isPlaceholderValue(cfg.endpoint)) {
        issues.push('R2_ACCOUNT_ID (ou R2_ENDPOINT) não está configurado ou contém valor placeholder.');
    }
    if (isPlaceholderValue(cfg.accessKeyId)) {
        issues.push('R2_ACCESS_KEY_ID está ausente ou ainda contém valor placeholder (ex: sua_r2_access_key_id).');
    }
    if (isPlaceholderValue(cfg.secretAccessKey)) {
        issues.push('R2_SECRET_ACCESS_KEY está ausente ou ainda contém valor placeholder (ex: sua_r2_secret_access_key).');
    }
    if (isPlaceholderValue(cfg.publicBaseUrl)) {
        issues.push('R2_PUBLIC_URL é obrigatório para migração de ativos públicos (ex: https://pub-xxxx.r2.dev).');
    } else {
        try {
            const parsed = new URL(cfg.publicBaseUrl);
            if (parsed.protocol !== 'https:') {
                issues.push('R2_PUBLIC_URL deve usar HTTPS.');
            }
        } catch {
            issues.push(`R2_PUBLIC_URL inválido: ${cfg.publicBaseUrl}`);
        }
    }
    if (!cfg.publicBucket || isPlaceholderValue(cfg.publicBucket)) {
        issues.push('R2_PUBLIC_BUCKET inválido ou ausente.');
    }
    if (!cfg.privateBucket || isPlaceholderValue(cfg.privateBucket)) {
        issues.push('R2_PRIVATE_BUCKET inválido ou ausente.');
    }
    return issues;
}

export function parseCliArgs(argv: string[]): MigrationCliOptions {
    let apply = false;
    let cleanupLocal = false;
    let includeOrphans = false;
    let skipPreflight = false;
    let help = false;
    let onlyTables: string[] | null = null;
    const extraRoots: string[] = [];
    let manifestPath: string | null = null;

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            help = true;
        } else if (arg === '--apply') {
            apply = true;
        } else if (arg === '--dry-run') {
            apply = false;
        } else if (arg === '--cleanup-local') {
            cleanupLocal = true;
        } else if (arg === '--include-orphans') {
            includeOrphans = true;
        } else if (arg === '--skip-preflight') {
            skipPreflight = true;
        } else if (arg.startsWith('--only=')) {
            const items = arg
                .slice('--only='.length)
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            onlyTables = items.length > 0 ? items : null;
        } else if (arg.startsWith('--roots=')) {
            const roots = arg
                .slice('--roots='.length)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            extraRoots.push(...roots);
        } else if (arg.startsWith('--manifest=')) {
            manifestPath = arg.slice('--manifest='.length).trim() || null;
        }
    }

    if (cleanupLocal && !apply) {
        throw new Error(
            'A flag --cleanup-local só pode ser usada em conjunto com --apply (nunca em modo --dry-run).',
        );
    }

    return {
        apply,
        dryRun: !apply,
        cleanupLocal,
        includeOrphans,
        skipPreflight,
        help,
        onlyTables,
        extraRoots,
        manifestPath,
    };
}

export function splitUrlFragment(raw: string): { base: string; fragment: string } {
    const hashIdx = raw.indexOf('#');
    if (hashIdx < 0) return { base: raw, fragment: '' };
    return {
        base: raw.slice(0, hashIdx),
        fragment: raw.slice(hashIdx),
    };
}

function isLocalOwnedHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return LOCAL_UPLOAD_HOST_ALLOWLIST.has(host) || host.endsWith('.torexjournal.com');
}

function sanitizeRelativeUploadPath(rawRel: string): string | null {
    const decoded = (() => {
        try {
            return decodeURIComponent(rawRel);
        } catch {
            return rawRel;
        }
    })();
    const normalized = decoded.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!normalized || normalized.includes('..') || /[\0\r\n]/.test(normalized)) {
        return null;
    }
    return normalized;
}

export function classifyMediaReference(
    rawInput: unknown,
    r2PublicBaseUrl: string,
): ClassifiedMediaRef {
    if (typeof rawInput !== 'string') return { kind: 'empty' };
    const trimmed = rawInput.trim();
    if (!trimmed) return { kind: 'empty' };

    const { base: withoutFragment, fragment } = splitUrlFragment(trimmed);
    const cleanPublicBase = String(r2PublicBaseUrl || '').trim().replace(/\/+$/, '');

    // 1. Inline data URI (base64 image/pdf)
    if (withoutFragment.toLowerCase().startsWith('data:')) {
        const match = withoutFragment.match(DATA_URI_RE);
        if (!match) {
            return { kind: 'external-or-other' };
        }
        const mimeType = match[1].toLowerCase();
        const ext =
            mimeType === 'image/png'
                ? 'png'
                : mimeType === 'image/webp'
                  ? 'webp'
                  : mimeType === 'image/gif'
                    ? 'gif'
                    : mimeType === 'application/pdf'
                      ? 'pdf'
                      : 'jpg';
        return {
            kind: 'data-uri',
            mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
            ext,
            base64Data: match[2].replace(/\s+/g, ''),
            fragment,
        };
    }

    // 2. Already pointing to the configured Cloudflare R2 public URL
    if (cleanPublicBase && withoutFragment.startsWith(`${cleanPublicBase}/`)) {
        const normalizedUrl = `${withoutFragment.split('?')[0]}${fragment}`;
        return {
            kind: 'already-r2-public',
            normalizedUrl,
            changed: normalizedUrl !== rawInput,
        };
    }

    // 3. Relative /api/media/private/...
    if (withoutFragment.startsWith('/api/media/private/')) {
        const pathOnly = withoutFragment.split('?')[0];
        const rawKey = sanitizeRelativeUploadPath(pathOnly.slice('/api/media/private/'.length));
        if (!rawKey) return { kind: 'external-or-other' };
        const normalizedUrl = `/api/media/private/${rawKey}${fragment}`;
        return {
            kind: 'private-gateway',
            key: rawKey,
            fragment,
            normalizedUrl,
            changed: normalizedUrl !== rawInput,
        };
    }

    // 4. Relative /uploads/..., /api/uploads/..., or uploads/...
    const lowerNoFrag = withoutFragment.toLowerCase();
    for (const prefix of ['/uploads/', '/api/uploads/', 'uploads/']) {
        if (lowerNoFrag.startsWith(prefix)) {
            const pathOnly = withoutFragment.split('?')[0];
            const rel = sanitizeRelativeUploadPath(pathOnly.slice(prefix.length));
            if (!rel) return { kind: 'external-or-other' };
            return {
                kind: 'local-upload',
                relativePath: rel,
                fragment,
            };
        }
    }

    // 5. Full http(s):// URL pointing to our own domain or localhost
    if (/^https?:\/\//i.test(withoutFragment)) {
        try {
            const parsed = new URL(withoutFragment);
            if (!isLocalOwnedHost(parsed.hostname)) {
                return { kind: 'external-or-other' };
            }
            const pathname = parsed.pathname || '';
            if (pathname.startsWith('/api/media/private/')) {
                const rawKey = sanitizeRelativeUploadPath(
                    pathname.slice('/api/media/private/'.length),
                );
                if (!rawKey) return { kind: 'external-or-other' };
                const normalizedUrl = `/api/media/private/${rawKey}${fragment}`;
                return {
                    kind: 'private-gateway',
                    key: rawKey,
                    fragment,
                    normalizedUrl,
                    changed: true,
                };
            }
            if (pathname.startsWith('/uploads/') || pathname.startsWith('/api/uploads/')) {
                const prefixLen = pathname.startsWith('/api/uploads/')
                    ? '/api/uploads/'.length
                    : '/uploads/'.length;
                const rel = sanitizeRelativeUploadPath(pathname.slice(prefixLen));
                if (!rel) return { kind: 'external-or-other' };
                return {
                    kind: 'local-upload',
                    relativePath: rel,
                    fragment,
                };
            }
        } catch {
            return { kind: 'external-or-other' };
        }
    }

    return { kind: 'external-or-other' };
}

/**
 * Inspects file magic bytes to detect true MIME/extension and block HTML/SVG XSS payloads.
 */
export function detectFormatFromMagicBytes(
    buffer: Buffer,
    fallbackExt?: string,
): DetectedFileFormat {
    if (!buffer || buffer.length === 0) {
        return {
            ext: 'png',
            contentType: 'application/octet-stream',
            detectedByMagic: false,
            rejectedReason: 'Arquivo vazio (0 bytes).',
        };
    }

    // Guard against HTML / SVG / Script masquerading as an image
    const headText = buffer
        .subarray(0, Math.min(buffer.length, 256))
        .toString('utf8')
        .trimStart()
        .toLowerCase();
    if (
        headText.startsWith('<!doctype html') ||
        headText.startsWith('<html') ||
        headText.startsWith('<svg') ||
        headText.startsWith('<script') ||
        (headText.startsWith('<?xml') && headText.includes('<svg'))
    ) {
        return {
            ext: 'bin',
            contentType: 'application/octet-stream',
            detectedByMagic: true,
            rejectedReason: 'Conteúdo HTML/SVG bloqueado por segurança (XSS).',
        };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return { ext: 'png', contentType: 'image/png', detectedByMagic: true };
    }

    // JPEG: FF D8 FF
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { ext: 'jpg', contentType: 'image/jpeg', detectedByMagic: true };
    }

    // WebP: RIFF....WEBP
    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return { ext: 'webp', contentType: 'image/webp', detectedByMagic: true };
    }

    // GIF: GIF87a / GIF89a
    if (buffer.length >= 6) {
        const gifSig = buffer.subarray(0, 6).toString('ascii');
        if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
            return { ext: 'gif', contentType: 'image/gif', detectedByMagic: true };
        }
    }

    // PDF: %PDF-
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
        return { ext: 'pdf', contentType: 'application/pdf', detectedByMagic: true };
    }

    // MP4 / MOV: ....ftyp
    if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
        if (brand.startsWith('qt')) {
            return { ext: 'mov', contentType: 'video/quicktime', detectedByMagic: true };
        }
        return { ext: 'mp4', contentType: 'video/mp4', detectedByMagic: true };
    }

    // WebM: 1A 45 DF A3
    if (
        buffer.length >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
    ) {
        return { ext: 'webm', contentType: 'video/webm', detectedByMagic: true };
    }

    // OGG: OggS
    if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') {
        return { ext: 'ogg', contentType: 'video/ogg', detectedByMagic: true };
    }

    const cleanFallback = normalizeSafeExtension(fallbackExt, 'png');
    return {
        ext: cleanFallback,
        contentType: resolveMimeForExtension(cleanFallback),
        detectedByMagic: false,
    };
}

export function discoverCandidateRoots(cwd: string, extraRoots: string[] = []): {
    uploadsDirs: string[];
    privateUploadsDirs: string[];
} {
    const rawUploadCandidates = [
        path.resolve(cwd, 'uploads'),
        path.resolve(cwd, '..', 'uploads'),
        ...extraRoots.map((r) => path.resolve(r)),
    ];
    const rawPrivateCandidates = [
        path.resolve(cwd, 'private-uploads'),
        path.resolve(cwd, '..', 'private-uploads'),
        ...extraRoots.map((r) => path.resolve(r, 'private-uploads')),
    ];

    const dedupeExisting = (list: string[]): string[] => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const p of list) {
            const key = process.platform === 'win32' ? p.toLowerCase() : p;
            if (seen.has(key)) continue;
            seen.add(key);
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                out.push(p);
            }
        }
        return out;
    };

    return {
        uploadsDirs: dedupeExisting(rawUploadCandidates),
        privateUploadsDirs: dedupeExisting(rawPrivateCandidates),
    };
}

export function resolveLocalFileInRoots(relativePath: string, rootDirs: string[]): string | null {
    const cleanRel = sanitizeRelativeUploadPath(relativePath);
    if (!cleanRel) return null;

    for (const rootDir of rootDirs) {
        const resolvedRoot = path.resolve(rootDir);
        const candidate = path.resolve(resolvedRoot, cleanRel);
        if (!candidate.startsWith(resolvedRoot + path.sep)) {
            continue;
        }
        try {
            const stat = fs.statSync(candidate);
            if (stat.isFile()) {
                return candidate;
            }
        } catch {
            // Try next candidate directory
        }
    }
    return null;
}

function walkFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const stack: string[] = [dir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile()) {
                results.push(fullPath);
            }
        }
    }
    return results.sort();
}

function sha256Buffer(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

function normalizePathKey(p: string): string {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function extractExtFromPath(relPath: string): string | undefined {
    const ext = path.extname(relPath).replace(/^\./, '').trim().toLowerCase();
    return ext || undefined;
}

function removeEmptyParentDirs(filePath: string, stopRoots: string[]): void {
    const stopSet = new Set(stopRoots.map((r) => normalizePathKey(r)));
    let current = path.dirname(path.resolve(filePath));
    while (!stopSet.has(normalizePathKey(current))) {
        try {
            const items = fs.readdirSync(current);
            if (items.length > 0) break;
            fs.rmdirSync(current);
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        } catch {
            break;
        }
    }
}

export interface MigratorDependencies {
    db: SqlExecutor;
    r2: R2MigrationClient;
    uploadsDirs: string[];
    privateUploadsDirs: string[];
    options: MigrationCliOptions;
    logger?: (line: string) => void;
}

interface TargetContext {
    table: string;
    rowId: string;
    column: string;
    visibility: MigrationVisibility;
    folder: PublicFolder | PrivateFolder;
    ownerUserId?: string | null;
}

export class LocalStorageToR2Migrator {
    private readonly db: SqlExecutor;
    private readonly r2: R2MigrationClient;
    private readonly uploadsDirs: string[];
    private readonly privateUploadsDirs: string[];
    private readonly options: MigrationCliOptions;
    private readonly log: (line: string) => void;

    private readonly dedupCache = new Map<
        string,
        { url: string; key: string; bucket: string; sha256: string; sizeBytes: number; contentType: string }
    >();
    private readonly referencedLocalPaths = new Set<string>();
    private readonly migratedLocalPaths = new Map<string, string>(); // normalizedKey -> actual path

    private readonly mappings: MigrationMappingEntry[] = [];
    private readonly missingFiles: MissingFileEntry[] = [];
    private readonly orphans: OrphanFileEntry[] = [];
    private readonly deletedLocalFiles: string[] = [];
    private readonly errors: Array<{ context: string; message: string }> = [];

    private readonly summary: MigrationSummary = {
        tablesScanned: 0,
        tablesSkippedMissing: 0,
        rowsScanned: 0,
        rowsUpdated: 0,
        refsInspected: 0,
        refsAlreadyOnR2: 0,
        refsExternalSkipped: 0,
        refsNormalizedOnly: 0,
        uploadedPublicToR2: 0,
        uploadedPrivateToR2: 0,
        privateLocalSyncedToR2: 0,
        dataUrisConverted: 0,
        deduplicatedReuses: 0,
        missingLocalFiles: 0,
        unsafeFilesSkipped: 0,
        orphansFound: 0,
        orphansMigrated: 0,
        bytesUploaded: 0,
        localFilesDeleted: 0,
        errorsCount: 0,
    };

    constructor(deps: MigratorDependencies) {
        this.db = deps.db;
        this.r2 = deps.r2;
        this.uploadsDirs = deps.uploadsDirs;
        this.privateUploadsDirs = deps.privateUploadsDirs;
        this.options = deps.options;
        this.log = deps.logger || ((msg) => console.log(msg));
    }

    private shouldRunTable(table: string): boolean {
        if (!this.options.onlyTables || this.options.onlyTables.length === 0) {
            return true;
        }
        return this.options.onlyTables.includes(table.toLowerCase());
    }

    private async tableExists(tableName: string): Promise<boolean> {
        try {
            const rows = await this.db.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`]);
            const first = Array.isArray(rows) ? rows[0] : null;
            return Boolean(first && first.reg);
        } catch {
            return false;
        }
    }

    private getPreviewPublicBaseUrl(): string {
        const cfg = this.r2.getConfig();
        return cfg.publicBaseUrl || 'https://<R2_PUBLIC_URL>';
    }

    private buildCanonicalKey(
        visibility: MigrationVisibility,
        folder: PublicFolder | PrivateFolder,
        ext: string,
        ownerUserId?: string | null,
    ): string {
        const safeExt = normalizeSafeExtension(ext, 'png');
        const filename = `${randomUUID()}.${safeExt}`;
        if (visibility === 'public') {
            return `${folder}/${filename}`;
        }
        if (!ownerUserId || !String(ownerUserId).trim()) {
            throw new Error(`ownerUserId é obrigatório para ativos privados (${folder}).`);
        }
        const ownerTag = this.r2.computeOwnerTag(String(ownerUserId).trim());
        return `private/${ownerTag}/${folder}/${filename}`;
    }

    private async migrateSingleReference(
        rawRef: string,
        ctx: TargetContext,
    ): Promise<{ value: string; changed: boolean }> {
        this.summary.refsInspected++;
        const cfg = this.r2.getConfig();
        const previewPublicBase = this.getPreviewPublicBaseUrl();
        const classified = classifyMediaReference(rawRef, cfg.publicBaseUrl);

        if (classified.kind === 'empty') {
            return { value: rawRef, changed: false };
        }

        if (classified.kind === 'external-or-other') {
            this.summary.refsExternalSkipped++;
            return { value: rawRef, changed: false };
        }

        // Case 1: Already on Cloudflare R2 public URL
        if (classified.kind === 'already-r2-public') {
            this.summary.refsAlreadyOnR2++;
            if (classified.changed) {
                this.summary.refsNormalizedOnly++;
                this.mappings.push({
                    table: ctx.table,
                    rowId: ctx.rowId,
                    column: ctx.column,
                    oldRef: rawRef,
                    newRef: classified.normalizedUrl,
                    action: this.options.apply ? 'normalized-url-only' : 'dry-run-would-normalize',
                    visibility: 'public',
                    bucket: cfg.publicBucket,
                    key: classified.normalizedUrl
                        .slice(cfg.publicBaseUrl.length + 1)
                        .split('#')[0],
                });
                return { value: classified.normalizedUrl, changed: true };
            }
            return { value: rawRef, changed: false };
        }

        // Case 2: Private gateway URL (`/api/media/private/<key>`)
        // Check whether the file is currently on local `./private-uploads/` and sync it to R2 preserving the exact key!
        if (classified.kind === 'private-gateway') {
            const safeKey = this.r2.sanitizeObjectKey(classified.key);
            if (!safeKey || !safeKey.startsWith('private/')) {
                this.summary.unsafeFilesSkipped++;
                return { value: rawRef, changed: false };
            }

            const localPrivatePath = resolveLocalFileInRoots(safeKey, this.privateUploadsDirs);
            if (localPrivatePath) {
                this.referencedLocalPaths.add(normalizePathKey(localPrivatePath));
                const buffer = await fs.promises.readFile(localPrivatePath);
                const format = detectFormatFromMagicBytes(buffer, extractExtFromPath(safeKey));
                if (format.rejectedReason) {
                    this.summary.unsafeFilesSkipped++;
                    this.errors.push({
                        context: `${ctx.table}[${ctx.rowId}].${ctx.column}`,
                        message: `${format.rejectedReason} (${localPrivatePath})`,
                    });
                    return { value: rawRef, changed: false };
                }

                const sha256 = sha256Buffer(buffer);
                if (this.options.apply) {
                    const exists = await this.r2.objectExistsInR2('private', safeKey);
                    if (!exists) {
                        await this.r2.uploadRawObjectToR2({
                            visibility: 'private',
                            key: safeKey,
                            buffer,
                            contentType: format.contentType,
                        });
                        this.summary.privateLocalSyncedToR2++;
                        this.summary.bytesUploaded += buffer.length;
                        this.mappings.push({
                            table: ctx.table,
                            rowId: ctx.rowId,
                            column: ctx.column,
                            oldRef: rawRef,
                            newRef: classified.normalizedUrl,
                            action: 'synced-private-local-to-r2',
                            visibility: 'private',
                            bucket: cfg.privateBucket,
                            key: safeKey,
                            localPath: localPrivatePath,
                            sha256,
                            sizeBytes: buffer.length,
                            contentType: format.contentType,
                        });
                    } else {
                        this.summary.refsAlreadyOnR2++;
                    }
                    this.migratedLocalPaths.set(normalizePathKey(localPrivatePath), localPrivatePath);
                } else {
                    this.summary.privateLocalSyncedToR2++;
                    this.summary.bytesUploaded += buffer.length;
                    this.mappings.push({
                        table: ctx.table,
                        rowId: ctx.rowId,
                        column: ctx.column,
                        oldRef: rawRef,
                        newRef: classified.normalizedUrl,
                        action: 'dry-run-would-sync-private',
                        visibility: 'private',
                        bucket: cfg.privateBucket,
                        key: safeKey,
                        localPath: localPrivatePath,
                        sha256,
                        sizeBytes: buffer.length,
                        contentType: format.contentType,
                    });
                }
            } else {
                this.summary.refsAlreadyOnR2++;
            }

            if (classified.changed) {
                this.summary.refsNormalizedOnly++;
                if (!localPrivatePath) {
                    this.mappings.push({
                        table: ctx.table,
                        rowId: ctx.rowId,
                        column: ctx.column,
                        oldRef: rawRef,
                        newRef: classified.normalizedUrl,
                        action: this.options.apply
                            ? 'normalized-url-only'
                            : 'dry-run-would-normalize',
                        visibility: 'private',
                        bucket: cfg.privateBucket,
                        key: safeKey,
                    });
                }
                return { value: classified.normalizedUrl, changed: true };
            }
            return { value: rawRef, changed: false };
        }

        // Case 3 & 4: Local upload file OR inline data: URI -> normalize & upload to R2!
        if (ctx.visibility === 'private' && (!ctx.ownerUserId || !String(ctx.ownerUserId).trim())) {
            this.missingFiles.push({
                table: ctx.table,
                rowId: ctx.rowId,
                column: ctx.column,
                ref: rawRef.slice(0, 120),
                reason: 'Proprietário (user_id) ausente para ativo privado; ignorado para evitar vazamento de isolamento.',
            });
            this.summary.missingLocalFiles++;
            return { value: rawRef, changed: false };
        }

        let buffer: Buffer;
        let fallbackExt: string | undefined;
        let localPath: string | undefined;
        let isDataUri = false;
        const fragment = classified.fragment;

        if (classified.kind === 'local-upload') {
            const foundPath = resolveLocalFileInRoots(classified.relativePath, this.uploadsDirs);
            if (!foundPath) {
                this.summary.missingLocalFiles++;
                this.missingFiles.push({
                    table: ctx.table,
                    rowId: ctx.rowId,
                    column: ctx.column,
                    ref: rawRef,
                    reason: `Arquivo local não encontrado nas pastas configuradas (${classified.relativePath}).`,
                });
                return { value: rawRef, changed: false };
            }
            this.referencedLocalPaths.add(normalizePathKey(foundPath));
            const stat = await fs.promises.stat(foundPath);
            if (stat.size > MAX_LOCAL_FILE_BYTES) {
                this.summary.unsafeFilesSkipped++;
                this.errors.push({
                    context: `${ctx.table}[${ctx.rowId}].${ctx.column}`,
                    message: `Arquivo excede limite máximo de ${MAX_LOCAL_FILE_BYTES} bytes (${foundPath}).`,
                });
                return { value: rawRef, changed: false };
            }
            buffer = await fs.promises.readFile(foundPath);
            fallbackExt = extractExtFromPath(foundPath);
            localPath = foundPath;
        } else {
            // data-uri
            isDataUri = true;
            buffer = Buffer.from(classified.base64Data, 'base64');
            if (buffer.length > MAX_INLINE_DATA_URI_BYTES) {
                this.summary.unsafeFilesSkipped++;
                this.errors.push({
                    context: `${ctx.table}[${ctx.rowId}].${ctx.column}`,
                    message: `Data URI excede limite de ${MAX_INLINE_DATA_URI_BYTES} bytes.`,
                });
                return { value: rawRef, changed: false };
            }
            fallbackExt = classified.ext;
        }

        const format = detectFormatFromMagicBytes(buffer, fallbackExt);
        if (format.rejectedReason) {
            this.summary.unsafeFilesSkipped++;
            this.errors.push({
                context: `${ctx.table}[${ctx.rowId}].${ctx.column}`,
                message: `${format.rejectedReason}${localPath ? ` (${localPath})` : ''}`,
            });
            return { value: rawRef, changed: false };
        }

        const sha256 = sha256Buffer(buffer);
        const ownerPartition =
            ctx.visibility === 'private' ? this.r2.computeOwnerTag(ctx.ownerUserId!) : 'public';
        const dedupKey = `${ctx.visibility}:${ownerPartition}:${ctx.folder}:${sha256}`;

        const cached = this.dedupCache.get(dedupKey);
        if (cached) {
            this.summary.deduplicatedReuses++;
            if (localPath && this.options.apply) {
                this.migratedLocalPaths.set(normalizePathKey(localPath), localPath);
            }
            const nextUrl = `${cached.url}${fragment}`;
            this.mappings.push({
                table: ctx.table,
                rowId: ctx.rowId,
                column: ctx.column,
                oldRef: isDataUri ? `${rawRef.slice(0, 64)}...[base64:${buffer.length}B]` : rawRef,
                newRef: nextUrl,
                action: 'deduplicated-reuse',
                visibility: ctx.visibility,
                bucket: cached.bucket,
                key: cached.key,
                localPath,
                sha256: cached.sha256,
                sizeBytes: cached.sizeBytes,
                contentType: cached.contentType,
            });
            return { value: nextUrl, changed: nextUrl !== rawRef };
        }

        const targetKey = this.buildCanonicalKey(
            ctx.visibility,
            ctx.folder,
            format.ext,
            ctx.ownerUserId,
        );
        const targetBucket = ctx.visibility === 'public' ? cfg.publicBucket : cfg.privateBucket;

        let canonicalBaseUrl: string;
        if (this.options.apply) {
            const uploaded = await this.r2.uploadRawObjectToR2({
                visibility: ctx.visibility,
                key: targetKey,
                buffer,
                contentType: format.contentType,
            });
            canonicalBaseUrl = uploaded.url;
            if (localPath) {
                this.migratedLocalPaths.set(normalizePathKey(localPath), localPath);
            }
        } else {
            canonicalBaseUrl =
                ctx.visibility === 'public'
                    ? `${previewPublicBase}/${targetKey}`
                    : `/api/media/private/${targetKey}`;
        }

        this.dedupCache.set(dedupKey, {
            url: canonicalBaseUrl,
            key: targetKey,
            bucket: targetBucket,
            sha256,
            sizeBytes: buffer.length,
            contentType: format.contentType,
        });

        if (ctx.visibility === 'public') {
            this.summary.uploadedPublicToR2++;
        } else {
            this.summary.uploadedPrivateToR2++;
        }
        if (isDataUri) {
            this.summary.dataUrisConverted++;
        }
        this.summary.bytesUploaded += buffer.length;

        const nextUrl = `${canonicalBaseUrl}${fragment}`;
        this.mappings.push({
            table: ctx.table,
            rowId: ctx.rowId,
            column: ctx.column,
            oldRef: isDataUri ? `${rawRef.slice(0, 64)}...[base64:${buffer.length}B]` : rawRef,
            newRef: nextUrl,
            action: this.options.apply
                ? isDataUri
                    ? 'uploaded-data-uri-to-r2'
                    : 'uploaded-local-to-r2'
                : 'dry-run-would-upload',
            visibility: ctx.visibility,
            bucket: targetBucket,
            key: targetKey,
            localPath,
            sha256,
            sizeBytes: buffer.length,
            contentType: format.contentType,
        });

        return { value: nextUrl, changed: nextUrl !== rawRef };
    }

    private async migrateStringArray(
        items: unknown,
        ctx: TargetContext,
    ): Promise<{ value: string[]; changed: boolean }> {
        if (!Array.isArray(items) || items.length === 0) {
            return { value: Array.isArray(items) ? items : [], changed: false };
        }
        let changed = false;
        const out: string[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (typeof item !== 'string') {
                out.push(item as any);
                continue;
            }
            const res = await this.migrateSingleReference(item, {
                ...ctx,
                column: `${ctx.column}[${i}]`,
            });
            out.push(res.value);
            if (res.changed) changed = true;
        }
        return { value: out, changed };
    }

    private async migrateScreenshotObjectsArray(
        items: unknown,
        ctx: TargetContext,
    ): Promise<{ value: any[]; changed: boolean }> {
        if (!Array.isArray(items) || items.length === 0) {
            return { value: Array.isArray(items) ? items : [], changed: false };
        }
        let changed = false;
        const out: any[] = [];
        const IMAGE_PROPS = ['dataUrl', 'url', 'imageUrl', 'src'];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (typeof item === 'string') {
                const res = await this.migrateSingleReference(item, {
                    ...ctx,
                    column: `${ctx.column}[${i}]`,
                });
                out.push(res.value);
                if (res.changed) changed = true;
                continue;
            }
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                const copy: Record<string, any> = { ...item };
                let objChanged = false;
                for (const prop of IMAGE_PROPS) {
                    if (typeof copy[prop] === 'string' && copy[prop].trim()) {
                        const res = await this.migrateSingleReference(copy[prop], {
                            ...ctx,
                            column: `${ctx.column}[${i}].${prop}`,
                        });
                        if (res.changed) {
                            copy[prop] = res.value;
                            objChanged = true;
                        }
                    }
                }
                out.push(objChanged ? copy : item);
                if (objChanged) changed = true;
                continue;
            }
            out.push(item);
        }

        return { value: out, changed };
    }

    private async migrateSimpleTextColumn(params: {
        table: string;
        pkColumn: string;
        targetColumn: string;
        visibility: MigrationVisibility;
        folder: PublicFolder | PrivateFolder;
        selectSql?: string;
    }): Promise<void> {
        if (!this.shouldRunTable(params.table)) return;
        if (!(await this.tableExists(params.table))) {
            this.summary.tablesSkippedMissing++;
            return;
        }
        this.summary.tablesScanned++;

        const sql =
            params.selectSql ||
            `SELECT "${params.pkColumn}" AS id, "${params.targetColumn}" AS val FROM "${params.table}" WHERE "${params.targetColumn}" IS NOT NULL AND TRIM("${params.targetColumn}") <> ''`;

        const rows: any[] = await this.db.query(sql);
        for (const row of rows) {
            this.summary.rowsScanned++;
            const rowId = String(row.id);
            const currentVal = String(row.val || '');
            const ownerUserId = row.owner_user_id ? String(row.owner_user_id) : null;

            try {
                const res = await this.migrateSingleReference(currentVal, {
                    table: params.table,
                    rowId,
                    column: params.targetColumn,
                    visibility: params.visibility,
                    folder: params.folder,
                    ownerUserId,
                });
                if (res.changed) {
                    if (this.options.apply) {
                        await this.db.query(
                            `UPDATE "${params.table}" SET "${params.targetColumn}" = $1 WHERE "${params.pkColumn}" = $2`,
                            [res.value, row.id],
                        );
                    }
                    this.summary.rowsUpdated++;
                }
            } catch (err: any) {
                this.errors.push({
                    context: `${params.table}[${rowId}].${params.targetColumn}`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    private async migrateNetworkVideoLessons(): Promise<void> {
        const table = 'network_video_lessons';
        if (!this.shouldRunTable(table)) return;
        if (!(await this.tableExists(table))) {
            this.summary.tablesSkippedMissing++;
            return;
        }
        this.summary.tablesScanned++;

        const rows: any[] = await this.db.query(
            `SELECT "id", "thumbnail_url", "embed_url" FROM "network_video_lessons" WHERE ("thumbnail_url" IS NOT NULL AND TRIM("thumbnail_url") <> '') OR ("embed_url" IS NOT NULL AND TRIM("embed_url") <> '')`,
        );

        for (const row of rows) {
            this.summary.rowsScanned++;
            const rowId = String(row.id);
            let nextThumb = row.thumbnail_url;
            let nextEmbed = row.embed_url;
            let rowChanged = false;

            try {
                if (typeof row.thumbnail_url === 'string' && row.thumbnail_url.trim()) {
                    const res = await this.migrateSingleReference(row.thumbnail_url, {
                        table,
                        rowId,
                        column: 'thumbnail_url',
                        visibility: 'public',
                        folder: 'network',
                    });
                    if (res.changed) {
                        nextThumb = res.value;
                        rowChanged = true;
                    }
                }
                if (typeof row.embed_url === 'string' && row.embed_url.trim()) {
                    const res = await this.migrateSingleReference(row.embed_url, {
                        table,
                        rowId,
                        column: 'embed_url',
                        visibility: 'public',
                        folder: 'network',
                    });
                    if (res.changed) {
                        nextEmbed = res.value;
                        rowChanged = true;
                    }
                }
                if (rowChanged) {
                    if (this.options.apply) {
                        await this.db.query(
                            `UPDATE "network_video_lessons" SET "thumbnail_url" = $1, "embed_url" = $2 WHERE "id" = $3`,
                            [nextThumb, nextEmbed, row.id],
                        );
                    }
                    this.summary.rowsUpdated++;
                }
            } catch (err: any) {
                this.errors.push({
                    context: `${table}[${rowId}]`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    private async migrateUserJsonImagesTable(
        table: 'daily_notes' | 'general_notes',
        folder: PrivateFolder,
    ): Promise<void> {
        if (!this.shouldRunTable(table)) return;
        if (!(await this.tableExists(table))) {
            this.summary.tablesSkippedMissing++;
            return;
        }
        this.summary.tablesScanned++;

        const rows: any[] = await this.db.query(
            `SELECT "id", "user_id", "images" FROM "${table}" WHERE jsonb_typeof("images") = 'array' AND jsonb_array_length("images") > 0`,
        );

        for (const row of rows) {
            this.summary.rowsScanned++;
            const rowId = String(row.id);
            const userId = row.user_id ? String(row.user_id) : null;
            try {
                const res = await this.migrateStringArray(row.images, {
                    table,
                    rowId,
                    column: 'images',
                    visibility: 'private',
                    folder,
                    ownerUserId: userId,
                });
                if (res.changed) {
                    if (this.options.apply) {
                        await this.db.query(
                            `UPDATE "${table}" SET "images" = $1::jsonb WHERE "id" = $2`,
                            [JSON.stringify(res.value), row.id],
                        );
                    }
                    this.summary.rowsUpdated++;
                }
            } catch (err: any) {
                this.errors.push({
                    context: `${table}[${rowId}].images`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    private async migrateTradeNotes(): Promise<void> {
        const table = 'trade_notes';
        if (!this.shouldRunTable(table)) return;
        if (!(await this.tableExists(table))) {
            this.summary.tablesSkippedMissing++;
            return;
        }
        this.summary.tablesScanned++;

        const rows: any[] = await this.db.query(
            `SELECT "id", "user_id", "screenshot_url", "screenshots" FROM "trade_notes" WHERE ("screenshot_url" IS NOT NULL AND TRIM("screenshot_url") <> '') OR (jsonb_typeof("screenshots") = 'array' AND jsonb_array_length("screenshots") > 0)`,
        );

        for (const row of rows) {
            this.summary.rowsScanned++;
            const rowId = String(row.id);
            const userId = row.user_id ? String(row.user_id) : null;
            let nextPrimary = row.screenshot_url;
            let nextList = row.screenshots;
            let changed = false;

            try {
                if (typeof row.screenshot_url === 'string' && row.screenshot_url.trim()) {
                    const res = await this.migrateSingleReference(row.screenshot_url, {
                        table,
                        rowId,
                        column: 'screenshot_url',
                        visibility: 'private',
                        folder: 'journal-screenshots',
                        ownerUserId: userId,
                    });
                    if (res.changed) {
                        nextPrimary = res.value;
                        changed = true;
                    }
                }
                if (Array.isArray(row.screenshots) && row.screenshots.length > 0) {
                    const res = await this.migrateStringArray(row.screenshots, {
                        table,
                        rowId,
                        column: 'screenshots',
                        visibility: 'private',
                        folder: 'journal-screenshots',
                        ownerUserId: userId,
                    });
                    if (res.changed) {
                        nextList = res.value;
                        changed = true;
                    }
                }
                if (changed) {
                    if (this.options.apply) {
                        await this.db.query(
                            `UPDATE "trade_notes" SET "screenshot_url" = $1, "screenshots" = $2::jsonb WHERE "id" = $3`,
                            [nextPrimary, JSON.stringify(nextList || []), row.id],
                        );
                    }
                    this.summary.rowsUpdated++;
                }
            } catch (err: any) {
                this.errors.push({
                    context: `${table}[${rowId}]`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    private async migrateBacktestSessionBlobs(): Promise<void> {
        const table = 'backtest_session_blobs';
        if (!this.shouldRunTable(table)) return;
        if (!(await this.tableExists(table))) {
            this.summary.tablesSkippedMissing++;
            return;
        }
        this.summary.tablesScanned++;

        const rows: any[] = await this.db.query(
            `SELECT "session_id", "user_id", "session_screenshots", "journal_images" FROM "backtest_session_blobs" WHERE (jsonb_typeof("session_screenshots") = 'array' AND jsonb_array_length("session_screenshots") > 0) OR (jsonb_typeof("journal_images") = 'array' AND jsonb_array_length("journal_images") > 0)`,
        );

        for (const row of rows) {
            this.summary.rowsScanned++;
            const rowId = String(row.session_id);
            const userId = row.user_id ? String(row.user_id) : null;
            let nextShots = row.session_screenshots;
            let nextJournal = row.journal_images;
            let changed = false;

            try {
                if (Array.isArray(row.session_screenshots) && row.session_screenshots.length > 0) {
                    const res = await this.migrateScreenshotObjectsArray(row.session_screenshots, {
                        table,
                        rowId,
                        column: 'session_screenshots',
                        visibility: 'private',
                        folder: 'backtest-screenshots',
                        ownerUserId: userId,
                    });
                    if (res.changed) {
                        nextShots = res.value;
                        changed = true;
                    }
                }
                if (Array.isArray(row.journal_images) && row.journal_images.length > 0) {
                    const res = await this.migrateStringArray(row.journal_images, {
                        table,
                        rowId,
                        column: 'journal_images',
                        visibility: 'private',
                        folder: 'backtest-screenshots',
                        ownerUserId: userId,
                    });
                    if (res.changed) {
                        nextJournal = res.value;
                        changed = true;
                    }
                }
                if (changed) {
                    if (this.options.apply) {
                        await this.db.query(
                            `UPDATE "backtest_session_blobs" SET "session_screenshots" = $1::jsonb, "journal_images" = $2::jsonb WHERE "session_id" = $3`,
                            [
                                JSON.stringify(nextShots || []),
                                JSON.stringify(nextJournal || []),
                                row.session_id,
                            ],
                        );
                    }
                    this.summary.rowsUpdated++;
                }
            } catch (err: any) {
                this.errors.push({
                    context: `${table}[${rowId}]`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    private async migrateBacktestConfigJsonTable(
        table: 'backtest_sessions' | 'backtest_hypotheses',
    ): Promise<void> {
        if (!this.shouldRunTable(table)) return;
        if (!(await this.tableExists(table))) {
            this.summary.tablesSkippedMissing++;
            return;
        }
        this.summary.tablesScanned++;

        const rows: any[] = await this.db.query(
            `SELECT "id", "user_id", "config" FROM "${table}" WHERE jsonb_typeof("config") = 'object' AND ("config" ? 'sessionScreenshots' OR "config" ? 'journalImages')`,
        );

        for (const row of rows) {
            this.summary.rowsScanned++;
            const rowId = String(row.id);
            const userId = row.user_id ? String(row.user_id) : null;
            if (!row.config || typeof row.config !== 'object') continue;

            const nextConfig = { ...row.config };
            let changed = false;

            try {
                if (
                    Array.isArray(nextConfig.sessionScreenshots) &&
                    nextConfig.sessionScreenshots.length > 0
                ) {
                    const res = await this.migrateScreenshotObjectsArray(
                        nextConfig.sessionScreenshots,
                        {
                            table,
                            rowId,
                            column: 'config.sessionScreenshots',
                            visibility: 'private',
                            folder: 'backtest-screenshots',
                            ownerUserId: userId,
                        },
                    );
                    if (res.changed) {
                        nextConfig.sessionScreenshots = res.value;
                        changed = true;
                    }
                }
                if (Array.isArray(nextConfig.journalImages) && nextConfig.journalImages.length > 0) {
                    const res = await this.migrateStringArray(nextConfig.journalImages, {
                        table,
                        rowId,
                        column: 'config.journalImages',
                        visibility: 'private',
                        folder: 'backtest-screenshots',
                        ownerUserId: userId,
                    });
                    if (res.changed) {
                        nextConfig.journalImages = res.value;
                        changed = true;
                    }
                }
                if (changed) {
                    if (this.options.apply) {
                        await this.db.query(
                            `UPDATE "${table}" SET "config" = $1::jsonb WHERE "id" = $2`,
                            [JSON.stringify(nextConfig), row.id],
                        );
                    }
                    this.summary.rowsUpdated++;
                }
            } catch (err: any) {
                this.errors.push({
                    context: `${table}[${rowId}].config`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    private async migrateBacktestStrategies(): Promise<void> {
        const table = 'backtest_strategies';
        if (!this.shouldRunTable(table)) return;
        if (!(await this.tableExists(table))) {
            this.summary.tablesSkippedMissing++;
            return;
        }
        this.summary.tablesScanned++;

        const rows: any[] = await this.db.query(
            `SELECT "id", "user_id", "journal_config" FROM "backtest_strategies" WHERE jsonb_typeof("journal_config") = 'object' AND "journal_config" ? 'journalImages'`,
        );

        for (const row of rows) {
            this.summary.rowsScanned++;
            const rowId = String(row.id);
            const userId = row.user_id ? String(row.user_id) : null;
            if (!row.journal_config || typeof row.journal_config !== 'object') continue;

            const nextCfg = { ...row.journal_config };
            try {
                if (Array.isArray(nextCfg.journalImages) && nextCfg.journalImages.length > 0) {
                    const res = await this.migrateStringArray(nextCfg.journalImages, {
                        table,
                        rowId,
                        column: 'journal_config.journalImages',
                        visibility: 'private',
                        folder: 'backtest-screenshots',
                        ownerUserId: userId,
                    });
                    if (res.changed) {
                        nextCfg.journalImages = res.value;
                        if (this.options.apply) {
                            await this.db.query(
                                `UPDATE "backtest_strategies" SET "journal_config" = $1::jsonb WHERE "id" = $2`,
                                [JSON.stringify(nextCfg), row.id],
                            );
                        }
                        this.summary.rowsUpdated++;
                    }
                }
            } catch (err: any) {
                this.errors.push({
                    context: `${table}[${rowId}].journal_config`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    private async scanAndOptionallyMigrateOrphans(): Promise<void> {
        const cfg = this.r2.getConfig();
        const scanGroup = async (
            dirs: string[],
            rootType: 'uploads' | 'private-uploads',
        ): Promise<void> => {
            for (const rootDir of dirs) {
                const files = walkFilesRecursive(rootDir);
                for (const filePath of files) {
                    const normKey = normalizePathKey(filePath);
                    if (this.referencedLocalPaths.has(normKey)) {
                        continue;
                    }
                    const stat = fs.statSync(filePath);
                    const relativePath = path
                        .relative(rootDir, filePath)
                        .replace(/\\/g, '/');

                    this.summary.orphansFound++;

                    if (!this.options.includeOrphans) {
                        this.orphans.push({
                            localPath: filePath,
                            relativePath,
                            rootType,
                            sizeBytes: stat.size,
                            action: 'reported-only',
                        });
                        continue;
                    }

                    // Security rule: orphans are NEVER placed in the public bucket —
                    // unknown files could be legacy mental logs or private screenshots.
                    const buffer = await fs.promises.readFile(filePath);
                    const format = detectFormatFromMagicBytes(
                        buffer,
                        extractExtFromPath(relativePath),
                    );
                    if (format.rejectedReason) {
                        this.summary.unsafeFilesSkipped++;
                        this.orphans.push({
                            localPath: filePath,
                            relativePath,
                            rootType,
                            sizeBytes: stat.size,
                            action: 'skipped-unsafe',
                            reason: format.rejectedReason,
                        });
                        continue;
                    }

                    let targetKey: string;
                    if (rootType === 'private-uploads' && relativePath.startsWith('private/')) {
                        const sanitized = this.r2.sanitizeObjectKey(relativePath);
                        if (!sanitized) {
                            this.orphans.push({
                                localPath: filePath,
                                relativePath,
                                rootType,
                                sizeBytes: stat.size,
                                action: 'skipped-unsafe',
                                reason: 'Chave privada inválida.',
                            });
                            continue;
                        }
                        targetKey = sanitized;
                    } else {
                        // Detect legacy `journal-screenshots/<userId>/...` or `backtest-screenshots/<userId>/...`
                        const legacyPrivateMatch = relativePath.match(
                            /^(journal-screenshots|backtest-screenshots)\/([^/]+)\/[^/]+$/i,
                        );
                        if (legacyPrivateMatch) {
                            const folder = legacyPrivateMatch[1].toLowerCase() as PrivateFolder;
                            const legacyUserId = legacyPrivateMatch[2];
                            const ownerTag = this.r2.computeOwnerTag(legacyUserId);
                            const hashPrefix = sha256Buffer(buffer).slice(0, 16);
                            targetKey = `private/${ownerTag}/${folder}/legacy-${hashPrefix}.${format.ext}`;
                        } else {
                            const safeSubpath = relativePath.replace(/[^a-zA-Z0-9._/-]/g, '_');
                            targetKey = `private/legacy-archive/${safeSubpath}`;
                        }
                    }

                    if (!this.options.apply) {
                        this.orphans.push({
                            localPath: filePath,
                            relativePath,
                            rootType,
                            sizeBytes: stat.size,
                            action: 'dry-run-would-migrate',
                            bucket: cfg.privateBucket,
                            key: targetKey,
                        });
                        continue;
                    }

                    try {
                        const alreadyExists = await this.r2.objectExistsInR2('private', targetKey);
                        if (alreadyExists) {
                            this.migratedLocalPaths.set(normKey, filePath);
                            this.orphans.push({
                                localPath: filePath,
                                relativePath,
                                rootType,
                                sizeBytes: stat.size,
                                action: 'already-in-r2',
                                bucket: cfg.privateBucket,
                                key: targetKey,
                            });
                        } else {
                            await this.r2.uploadRawObjectToR2({
                                visibility: 'private',
                                key: targetKey,
                                buffer,
                                contentType: format.contentType,
                            });
                            this.summary.orphansMigrated++;
                            this.summary.bytesUploaded += buffer.length;
                            this.migratedLocalPaths.set(normKey, filePath);
                            this.orphans.push({
                                localPath: filePath,
                                relativePath,
                                rootType,
                                sizeBytes: stat.size,
                                action: 'migrated-to-r2',
                                bucket: cfg.privateBucket,
                                key: targetKey,
                            });
                        }
                    } catch (err: any) {
                        this.errors.push({
                            context: `orphan:${filePath}`,
                            message: err?.message || String(err),
                        });
                    }
                }
            }
        };

        await scanGroup(this.uploadsDirs, 'uploads');
        await scanGroup(this.privateUploadsDirs, 'private-uploads');
    }

    private async cleanupMigratedLocalFiles(): Promise<void> {
        if (!this.options.apply || !this.options.cleanupLocal) return;
        if (this.errors.length > 0) {
            this.log(
                `[CLEANUP-SKIPPED] Limpeza local abortada porque ocorreram ${this.errors.length} erro(s) durante a migração. Nenhum arquivo local foi apagado.`,
            );
            return;
        }

        const allRoots = [...this.uploadsDirs, ...this.privateUploadsDirs];
        for (const actualPath of this.migratedLocalPaths.values()) {
            try {
                if (fs.existsSync(actualPath)) {
                    await fs.promises.unlink(actualPath);
                    this.deletedLocalFiles.push(actualPath);
                    this.summary.localFilesDeleted++;
                    removeEmptyParentDirs(actualPath, allRoots);
                }
            } catch (err: any) {
                this.errors.push({
                    context: `cleanup:${actualPath}`,
                    message: err?.message || String(err),
                });
            }
        }
    }

    async run(): Promise<MigrationManifest> {
        const startedAt = new Date().toISOString();
        const cfg = this.r2.getConfig();
        const sharedBucketWarning = Boolean(
            cfg.publicBucket && cfg.privateBucket && cfg.publicBucket === cfg.privateBucket,
        );

        // Preflight check before touching anything in --apply mode
        if (this.options.apply) {
            const configIssues = validateR2ConfigForApply(cfg);
            if (configIssues.length > 0) {
                throw new Error(
                    `Configuração Cloudflare R2 incompleta para --apply:\n - ${configIssues.join('\n - ')}`,
                );
            }
            if (!this.options.skipPreflight) {
                const check = await this.r2.verifyR2Connection();
                if (!check.ok) {
                    throw new Error(
                        `Falha no teste de conectividade R2 (HeadBucket): ` +
                            `public(${check.publicBucket.name})=${check.publicBucket.status} ${check.publicBucket.detail || ''} | ` +
                            `private(${check.privateBucket.name})=${check.privateBucket.status} ${check.privateBucket.detail || ''}`,
                    );
                }
            }
        }

        // 1. Public assets
        await this.migrateSimpleTextColumn({
            table: 'users',
            pkColumn: 'id',
            targetColumn: 'avatarUrl',
            visibility: 'public',
            folder: 'avatars',
        });
        await this.migrateSimpleTextColumn({
            table: 'leaderboard_ranks',
            pkColumn: 'id',
            targetColumn: 'avatarUrl',
            visibility: 'public',
            folder: 'avatars',
        });
        await this.migrateSimpleTextColumn({
            table: 'network_posts',
            pkColumn: 'id',
            targetColumn: 'imageUrl',
            visibility: 'public',
            folder: 'network',
        });
        await this.migrateNetworkVideoLessons();

        // 2. Private assets (owner-isolated with HMAC ownerTag)
        await this.migrateSimpleTextColumn({
            table: 'mental_logs',
            pkColumn: 'id',
            targetColumn: 'imageUrl',
            visibility: 'private',
            folder: 'mental-logs',
            selectSql: `
                SELECT m."id" AS id, m."imageUrl" AS val, a."user_id" AS owner_user_id
                FROM "mental_logs" m
                LEFT JOIN "accounts" a ON a."id" = m."account_id"
                WHERE m."imageUrl" IS NOT NULL AND TRIM(m."imageUrl") <> ''
            `,
        });
        await this.migrateUserJsonImagesTable('daily_notes', 'journal-screenshots');
        await this.migrateTradeNotes();
        await this.migrateUserJsonImagesTable('general_notes', 'journal-screenshots');
        await this.migrateBacktestSessionBlobs();
        await this.migrateBacktestConfigJsonTable('backtest_sessions');
        await this.migrateBacktestStrategies();
        await this.migrateBacktestConfigJsonTable('backtest_hypotheses');

        // 3. Orphan scan on disk (only when scanning full platform, not --only subset)
        if (!this.options.onlyTables) {
            await this.scanAndOptionallyMigrateOrphans();
        }

        // 4. Optional local cleanup (only if --apply --cleanup-local and 0 errors)
        await this.cleanupMigratedLocalFiles();

        this.summary.errorsCount = this.errors.length;

        return {
            version: '1.0',
            mode: this.options.apply ? 'apply' : 'dry-run',
            startedAt,
            finishedAt: new Date().toISOString(),
            searchRoots: {
                uploadsDirs: this.uploadsDirs,
                privateUploadsDirs: this.privateUploadsDirs,
            },
            r2Target: {
                accountId: cfg.accountId || '',
                endpoint: cfg.endpoint || '',
                publicBucket: cfg.publicBucket,
                privateBucket: cfg.privateBucket,
                publicBaseUrl: cfg.publicBaseUrl || '',
                sharedBucketWarning,
            },
            summary: { ...this.summary },
            mappings: this.mappings,
            missingFiles: this.missingFiles,
            orphans: this.orphans,
            deletedLocalFiles: this.deletedLocalFiles,
            errors: this.errors,
        };
    }
}

export function loadEnvFiles(cwd = process.cwd()): string[] {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require('dotenv');
    const candidates = [
        path.resolve(cwd, '.env'),
        path.resolve(__dirname, '..', '..', '.env'),
        path.resolve(cwd, '..', '.env'),
    ];
    const loaded: string[] = [];
    const seen = new Set<string>();
    for (const envPath of candidates) {
        const key = normalizePathKey(envPath);
        if (seen.has(key)) continue;
        seen.add(key);
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
            loaded.push(envPath);
        }
    }
    return loaded;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printHelp(): void {
    console.log(`
========================================================================
  TorexJournal — Migração e Normalização Local Storage -> Cloudflare R2
========================================================================

Uso:
  npm run storage:migrate-r2:dry             # Simulação segura (padrão)
  npm run storage:migrate-r2                 # Aplica uploads no R2 e atualiza o PostgreSQL
  npm run storage:migrate-r2 -- --cleanup-local
  npm run storage:migrate-r2 -- --include-orphans
  npm run storage:migrate-r2:dry -- --only=users,trade_notes,mental_logs

Flags disponíveis:
  --dry-run             Apenas audita e gera relatório JSON (padrão). Não altera R2, banco ou disco.
  --apply               Executa upload real no Cloudflare R2 e atualiza as URLs no PostgreSQL.
  --cleanup-local       Remove arquivos locais APENAS após upload confirmado e 0 erros (exige --apply).
  --include-orphans     Envia também arquivos locais sem referência no banco para o bucket privado (private/legacy-archive/...).
  --only=t1,t2          Limita a execução às tabelas indicadas.
                        Suportadas: ${KNOWN_TARGETS.join(', ')}
  --roots=dir1,dir2     Diretórios adicionais onde procurar arquivos locais de upload.
  --manifest=caminho    Caminho customizado para salvar o manifesto JSON de auditoria/rollback.
  --help, -h            Exibe esta ajuda.
`);
}

function printSummaryReport(manifest: MigrationManifest, manifestOutPath: string): void {
    const s = manifest.summary;
    console.log('\n========================================================================');
    console.log(
        `  Resumo da Migração Cloudflare R2 [${manifest.mode.toUpperCase()}]`,
    );
    console.log('========================================================================');
    console.log(`  Endpoint R2         : ${manifest.r2Target.endpoint || '(não configurado)'}`);
    console.log(`  Bucket Público      : ${manifest.r2Target.publicBucket} (${manifest.r2Target.publicBaseUrl || 'R2_PUBLIC_URL ausente'})`);
    console.log(`  Bucket Privado      : ${manifest.r2Target.privateBucket}`);
    if (manifest.r2Target.sharedBucketWarning) {
        console.log(
            `  [AVISO SEGURANÇA]   : R2_PUBLIC_BUCKET e R2_PRIVATE_BUCKET apontam para o mesmo bucket ('${manifest.r2Target.publicBucket}'). Recomendado usar um bucket privado separado sem acesso r2.dev.`,
        );
    }
    console.log(`  Pastas /uploads     : ${manifest.searchRoots.uploadsDirs.join(', ') || '(nenhuma)'}`);
    console.log(`  Pastas privadas     : ${manifest.searchRoots.privateUploadsDirs.join(', ') || '(nenhuma)'}`);
    console.log('------------------------------------------------------------------------');
    console.log(`  Tabelas verificadas : ${s.tablesScanned} (ignoradas/inexistentes: ${s.tablesSkippedMissing})`);
    console.log(`  Linhas analisadas   : ${s.rowsScanned} | Linhas ${manifest.mode === 'apply' ? 'atualizadas' : 'a atualizar'}: ${s.rowsUpdated}`);
    console.log(`  Referências totais  : ${s.refsInspected}`);
    console.log(`    - Já no R2        : ${s.refsAlreadyOnR2}`);
    console.log(`    - Externas/outras : ${s.refsExternalSkipped}`);
    console.log(`    - Públicos -> R2  : ${s.uploadedPublicToR2}`);
    console.log(`    - Privados -> R2  : ${s.uploadedPrivateToR2}`);
    console.log(`    - Private-disk->R2: ${s.privateLocalSyncedToR2}`);
    console.log(`    - Base64 -> R2    : ${s.dataUrisConverted}`);
    console.log(`    - Deduplicados    : ${s.deduplicatedReuses}`);
    console.log(`    - Só normalizados : ${s.refsNormalizedOnly}`);
    console.log(`    - Ausentes disco  : ${s.missingLocalFiles}`);
    console.log(`    - Bloqueados XSS  : ${s.unsafeFilesSkipped}`);
    console.log(`  Órfãos em disco     : ${s.orphansFound} (migrados: ${s.orphansMigrated})`);
    console.log(`  Volume transferido  : ${formatBytes(s.bytesUploaded)}`);
    console.log(`  Locais removidos    : ${s.localFilesDeleted}`);
    console.log(`  Erros               : ${s.errorsCount}`);
    console.log(`  Manifesto salvo em  : ${manifestOutPath}`);
    console.log('========================================================================\n');

    if (manifest.missingFiles.length > 0) {
        console.log('Arquivos referenciados no banco mas ausentes no disco (primeiros 10):');
        for (const miss of manifest.missingFiles.slice(0, 10)) {
            console.log(`  - ${miss.table}[${miss.rowId}].${miss.column}: ${miss.ref} (${miss.reason})`);
        }
    }
    if (manifest.errors.length > 0) {
        console.error('Erros registrados:');
        for (const err of manifest.errors.slice(0, 20)) {
            console.error(`  - [${err.context}] ${err.message}`);
        }
    }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
    const options = parseCliArgs(argv);
    if (options.help) {
        printHelp();
        return;
    }

    const loadedEnvs = loadEnvFiles(process.cwd());
    const configService = new ConfigService(process.env);
    const r2Service = new CloudflareR2StorageService(configService);
    const cfg = r2Service.getConfig();

    console.log(
        `[Torex R2 Migration] Modo: ${options.apply ? 'APPLY (PRODUÇÃO)' : 'DRY-RUN (SIMULAÇÃO SEGURA)'}`,
    );
    if (loadedEnvs.length > 0) {
        console.log(`[Torex R2 Migration] .env carregado de: ${loadedEnvs.join(', ')}`);
    }

    const configIssues = validateR2ConfigForApply(cfg);
    if (configIssues.length > 0) {
        if (options.apply) {
            throw new Error(
                `Abortando --apply: corrija o .env antes de migrar:\n - ${configIssues.join('\n - ')}`,
            );
        }
        console.warn('[Torex R2 Migration] Aviso (dry-run): configuração R2 ainda incompleta:');
        for (const issue of configIssues) {
            console.warn(`  - ${issue}`);
        }
    }

    const { uploadsDirs, privateUploadsDirs } = discoverCandidateRoots(
        process.cwd(),
        options.extraRoots,
    );

    const { AppDataSource } = await import('../data-source');
    console.log('[Torex R2 Migration] Conectando ao PostgreSQL...');
    await AppDataSource.initialize();

    try {
        const migrator = new LocalStorageToR2Migrator({
            db: AppDataSource,
            r2: r2Service,
            uploadsDirs,
            privateUploadsDirs,
            options,
        });

        const manifest = await migrator.run();

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultManifestPath = path.resolve(
            process.cwd(),
            'reports',
            'r2-migration',
            `r2-migration-${manifest.mode}-${stamp}.json`,
        );
        const manifestOutPath = options.manifestPath
            ? path.resolve(options.manifestPath)
            : defaultManifestPath;

        await fs.promises.mkdir(path.dirname(manifestOutPath), { recursive: true });
        await fs.promises.writeFile(manifestOutPath, JSON.stringify(manifest, null, 2), 'utf8');

        printSummaryReport(manifest, manifestOutPath);

        if (manifest.errors.length > 0) {
            process.exitCode = 1;
        }
    } finally {
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
        }
    }
}

if (typeof require !== 'undefined' && require.main === module) {
    main().catch((err) => {
        console.error('[Torex R2 Migration] Erro fatal:', err?.message || err);
        process.exit(1);
    });
}
