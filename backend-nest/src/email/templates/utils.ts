/**
 * Institutional Email Utilities — Sanitization, URL Resolution & Formatting
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * Escapes untrusted strings before interpolation into HTML email templates.
 */
export function escapeHtml(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

/**
 * Resolves the canonical frontend base URL without trailing slashes.
 */
export function resolveFrontendUrl(overrideUrl?: string): string {
    const raw =
        overrideUrl ||
        process.env.FRONTEND_URL ||
        process.env.BASE_URL ||
        'https://torexjournal.com';
    const trimmed = raw.trim().replace(/\/+$/, '');
    // Guard against callers passing `${FRONTEND_URL}/dashboard` as a base URL
    return trimmed.replace(/\/dashboard$/i, '');
}

/**
 * Builds an absolute URL to a verified frontend route.
 * If `pathOrUrl` is already an absolute http(s) URL, normalizes duplicate `/dashboard/dashboard`.
 */
export function buildAppUrl(pathOrUrl: string, baseOverride?: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
        return pathOrUrl.replace(/\/dashboard\/dashboard(\b|\/|$)/i, '/dashboard$1');
    }
    const base = resolveFrontendUrl(baseOverride);
    const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${normalizedPath}`;
}

/**
 * Formats monetary values objectively with currency code and sign when requested.
 */
export function formatCurrency(
    amount: number | string,
    currency: string = 'USD',
    options: { showPlusSign?: boolean } = {},
): string {
    const numeric = typeof amount === 'number' ? amount : Number(String(amount).replace(/,/g, ''));
    const cleanCurrency = escapeHtml((currency || 'USD').toUpperCase().trim());

    if (Number.isNaN(numeric)) {
        return `${escapeHtml(String(amount))} ${cleanCurrency}`.trim();
    }

    const sign = numeric > 0 && options.showPlusSign ? '+' : numeric < 0 ? '-' : '';
    const absFormatted = Math.abs(numeric).toLocaleString('pt-PT', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    if (cleanCurrency === 'USD') {
        return `${sign}USD ${absFormatted}`;
    }
    if (cleanCurrency === 'EUR') {
        return `${sign}EUR ${absFormatted}`;
    }
    return `${sign}${absFormatted} ${cleanCurrency}`;
}

/**
 * Condenses verbose raw HTTP User-Agent strings into a clean, readable device summary.
 */
export function sanitizeUserAgent(rawUa?: string): string {
    if (!rawUa || !rawUa.trim()) return 'Navegador Web';
    const ua = rawUa.trim();
    if (ua.length <= 64 && !ua.includes('Mozilla/')) {
        return ua;
    }

    let browser = 'Navegador';
    if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Google Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Mozilla Firefox';
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Apple Safari';

    let os = '';
    if (/Windows NT 10|Windows NT 11/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    return os ? `${browser} (${os})` : browser;
}

/**
 * Formats a date/ISO string cleanly in pt-PT institutional format.
 */
export function formatInstitutionalDate(input?: string | Date): string {
    if (!input) return '-';
    if (typeof input === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(input.trim())) {
        return input.trim();
    }
    const parsed = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(parsed.getTime())) {
        return String(input);
    }
    return parsed.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

/**
 * Strips inline Markdown emphasis (`**bold**`) safely before escaping paragraphs
 * in legacy free-text notifications so literal asterisks never leak to users.
 */
export function renderCleanParagraphs(message: string): string {
    if (!message) return '';
    return message
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const strippedEmojiPointers = line.replace(/[👉👈]/g, '').trim();
            const escaped = escapeHtml(strippedEmojiPointers).replace(
                /\*\*(.+?)\*\*/g,
                '<strong>$1</strong>',
            );
            return `<p class="body-p">${escaped}</p>`;
        })
        .join('\n');
}

/**
 * Generates an accurate, clean plain-text version from rendered institutional HTML
 * for multipart/alternative MIME compliance and anti-spam deliverability.
 */
export function htmlToPlainText(html: string): string {
    if (!html) return '';
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<div class="preheader"[\s\S]*?<\/div>/gi, '')
        .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
            const cleanLabel = String(label).replace(/<[^>]+>/g, '').trim();
            if (!cleanLabel || cleanLabel === href || href.startsWith('mailto:')) {
                return cleanLabel || href;
            }
            return `${cleanLabel} (${href})`;
        })
        .replace(/<\/(p|div|h1|h2|h3|tr|li)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<td[^>]*>/gi, '  ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&bull;/gi, '•')
        .replace(/&copy;/gi, '(c)')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
