/**
 * Server-side XSS, URL, and CSV Formula Injection sanitizers.
 * Applied to user-generated rich text (journal, notes, community posts/comments),
 * uploaded/referenced image URLs, and spreadsheet export cells.
 */

const DANGEROUS_BLOCK_TAGS_RE =
    /<\s*(script|iframe|object|embed|applet|svg|math|style|link|meta|base|form|input|button|textarea|select|option|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

const DANGEROUS_SINGLE_TAGS_RE =
    /<\s*\/?\s*(script|iframe|object|embed|applet|svg|math|style|link|meta|base|form|input|button|textarea|select|option|noscript)\b[^>]*\/?\s*>/gi;

const EVENT_HANDLER_ATTR_RE =
    /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const DANGEROUS_URI_ATTR_RE =
    /\s+(href|src|xlink:href|formaction|action|poster|background)\s*=\s*(?:"\s*(?:javascript|vbscript|data\s*:\s*(?!image\/(?:png|jpeg|jpg|webp|gif)))[^"]*"|'\s*(?:javascript|vbscript|data\s*:\s*(?!image\/(?:png|jpeg|jpg|webp|gif)))[^']*'|[^\s>]*(?:javascript:|vbscript:))/gi;

const STYLE_EXPRESSION_RE =
    /\s+style\s*=\s*(?:"[^"]*(?:expression\s*\(|url\s*\(\s*['"]?\s*javascript:|behavior\s*:|-moz-binding)[^"]*"|'[^']*(?:expression\s*\(|url\s*\(\s*['"]?\s*javascript:|behavior\s*:|-moz-binding)[^']*')/gi;

/**
 * Sanitizes rich HTML / Markdown content (Journal, Notes, Community Posts) against Stored XSS
 * while keeping benign formatting markup intact.
 */
export function sanitizeRichHtml(input: unknown, maxLength = 50_000): string {
    if (typeof input !== 'string') return '';
    let out = input.replace(/\0/g, '');
    if (out.length > maxLength) {
        out = out.slice(0, maxLength);
    }

    // Repeated passes prevent nested tag reconstruction attacks like <scr<script>ipt>
    for (let i = 0; i < 3; i++) {
        const prev = out;
        out = out
            .replace(DANGEROUS_BLOCK_TAGS_RE, '')
            .replace(DANGEROUS_SINGLE_TAGS_RE, '')
            .replace(EVENT_HANDLER_ATTR_RE, '')
            .replace(DANGEROUS_URI_ATTR_RE, '')
            .replace(STYLE_EXPRESSION_RE, '');
        if (out === prev) break;
    }

    return out;
}

/**
 * Strips all HTML tags and control characters for plain-text titles, comments, and chat messages.
 */
export function sanitizePlainText(input: unknown, maxLength = 4_000): string {
    if (typeof input !== 'string') return '';
    return sanitizeRichHtml(input, maxLength * 2)
        .replace(/<[^>]+>/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim()
        .slice(0, maxLength);
}

/**
 * Validates that a user-supplied imageUrl refers exclusively to an internal upload path
 * or the canonical torexjournal.com origin (prevents SSRF, external tracking pixels, and XSS URIs).
 */
export function sanitizeInternalImageUrl(input: unknown): string | undefined {
    if (typeof input !== 'string') return undefined;
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > 512) return undefined;
    if (/[\r\n\0\s<>"]/.test(trimmed)) return undefined;

    if (trimmed.startsWith('/uploads/')) {
        if (trimmed.includes('..') || trimmed.includes('\\')) return undefined;
        return /^\/uploads\/[a-zA-Z0-9._/-]+$/.test(trimmed) ? trimmed : undefined;
    }

    if (trimmed.startsWith('/api/media/private/')) {
        if (trimmed.includes('..') || trimmed.includes('\\')) return undefined;
        const [pathPart] = trimmed.split('?');
        return /^\/api\/media\/private\/[a-zA-Z0-9._/-]+$/.test(pathPart) ? trimmed : undefined;
    }

    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:') return undefined;
        const host = parsed.hostname.toLowerCase();
        const r2PublicBase = (process.env.R2_PUBLIC_URL || '').trim();
        let allowedR2Host = '';
        if (r2PublicBase) {
            try {
                allowedR2Host = new URL(r2PublicBase).hostname.toLowerCase();
            } catch {
                allowedR2Host = '';
            }
        }
        if (
            host === 'torexjournal.com' ||
            host.endsWith('.torexjournal.com') ||
            host.endsWith('.r2.dev') ||
            (allowedR2Host && host === allowedR2Host)
        ) {
            if (parsed.pathname.includes('..')) return undefined;
            return parsed.toString();
        }
    } catch {
        return undefined;
    }

    return undefined;
}

/**
 * Neutralizes Spreadsheet/CSV Formula Injection (DDE / Excel =, +, -, @, tab, CR prefixes).
 */
export function sanitizeCsvCell(value: unknown): string {
    const str = value === null || value === undefined ? '' : String(value);
    if (!str) return '';
    if (/^[=+\-@\t\r]/.test(str)) {
        return `'${str}`;
    }
    return str;
}

/**
 * Recursively sanitizes rich text keys inside arbitrary note/journal objects without mutating structure.
 */
export function sanitizeJournalPayload<T extends Record<string, any>>(payload: T): T {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }
    const RICH_KEYS = new Set([
        'content',
        'notes',
        'note',
        'html',
        'body',
        'description',
        'reflection',
        'summary',
        'mistakes',
        'lessons',
        'journalNotes',
        'rulesDescription',
        'marketAnalysis',
        'psychologyNotes',
    ]);
    const PLAIN_KEYS = new Set([
        'title',
        'name',
        'journalTitle',
        'strategy',
        'setup',
        'session',
        'mood',
        'emotion',
    ]);

    const out: Record<string, any> = { ...payload };
    for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'string') {
            if (RICH_KEYS.has(k)) {
                out[k] = sanitizeRichHtml(v);
            } else if (PLAIN_KEYS.has(k)) {
                out[k] = sanitizePlainText(v, 300);
            }
        }
    }
    return out as T;
}
