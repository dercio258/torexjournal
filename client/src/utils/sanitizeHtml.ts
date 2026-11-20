import DOMPurify from 'dompurify';

const ALLOWED_TAGS = new Set([
    'p',
    'br',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'strike',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'span',
    'div',
    'img',
    'a',
]);

const DROP_WITH_CONTENT_TAGS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'svg',
    'math',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'meta',
    'link',
    'base',
]);

const SAFE_STYLE_PROPS = new Set([
    'color',
    'background-color',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration',
    'text-align',
    'line-height',
]);

export function escapeHtml(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    return String(raw)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeControlChars(input: string): string {
    return input.replace(/[\u0000-\u0020]+/g, '');
}

export function isSafeHref(rawUrl: string): boolean {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return false;
    const collapsed = normalizeControlChars(trimmed);
    if (/^(https?:|mailto:)/i.test(collapsed)) {
        return true;
    }
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        return true;
    }
    return false;
}

export function isSafeImgSrc(rawUrl: string): boolean {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return false;
    const collapsed = normalizeControlChars(trimmed);
    if (/^https?:\/\//i.test(collapsed)) {
        return true;
    }
    if (trimmed.startsWith('/uploads/')) {
        return true;
    }
    if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(collapsed)) {
        return true;
    }
    return false;
}

function sanitizeCssDeclarations(rawStyle: string): string {
    const lower = rawStyle.toLowerCase();
    if (
        lower.includes('expression(') ||
        lower.includes('url(') ||
        lower.includes('javascript:') ||
        lower.includes('-moz-binding') ||
        lower.includes('behavior:') ||
        lower.includes('@import')
    ) {
        return '';
    }
    const kept: string[] = [];
    for (const part of rawStyle.split(';')) {
        const colonIdx = part.indexOf(':');
        if (colonIdx <= 0) continue;
        const prop = part.slice(0, colonIdx).trim().toLowerCase();
        const val = part.slice(colonIdx + 1).trim();
        if (!prop || !val || !SAFE_STYLE_PROPS.has(prop)) continue;
        kept.push(`${prop}: ${val}`);
    }
    return kept.join('; ');
}

function sanitizeDomTree(root: Element): void {
    const children = Array.from(root.childNodes);
    for (const node of children) {
        if (node.nodeType === 8 /* COMMENT_NODE */) {
            node.parentNode?.removeChild(node);
            continue;
        }
        if (node.nodeType !== 1 /* ELEMENT_NODE */) {
            continue;
        }
        const el = node as Element;
        const tag = el.tagName.toLowerCase();

        if (DROP_WITH_CONTENT_TAGS.has(tag)) {
            el.parentNode?.removeChild(el);
            continue;
        }

        sanitizeDomTree(el);

        if (!ALLOWED_TAGS.has(tag)) {
            const parent = el.parentNode;
            if (parent) {
                while (el.firstChild) {
                    parent.insertBefore(el.firstChild, el);
                }
                parent.removeChild(el);
            }
            continue;
        }

        const attrs = Array.from(el.attributes);
        let hasHref = false;
        let hasTargetBlank = false;
        let hasSafeImgSrc = false;

        for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            const value = attr.value;

            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }

            if (name === 'style') {
                const cleanStyle = sanitizeCssDeclarations(value);
                if (cleanStyle) {
                    el.setAttribute('style', cleanStyle);
                } else {
                    el.removeAttribute(attr.name);
                }
                continue;
            }

            if (name === 'class' || name === 'dir' || name === 'title') {
                continue;
            }

            if (tag === 'a') {
                if (name === 'href') {
                    if (isSafeHref(value)) {
                        hasHref = true;
                        el.setAttribute('href', value.trim());
                    } else {
                        el.removeAttribute(attr.name);
                    }
                    continue;
                }
                if (name === 'target') {
                    if (value === '_blank' || value === '_self') {
                        el.setAttribute('target', value);
                        if (value === '_blank') hasTargetBlank = true;
                    } else {
                        el.removeAttribute(attr.name);
                    }
                    continue;
                }
                if (name === 'rel') {
                    continue;
                }
            }

            if (tag === 'img') {
                if (name === 'src') {
                    if (isSafeImgSrc(value)) {
                        hasSafeImgSrc = true;
                        el.setAttribute('src', value.trim());
                    } else {
                        el.removeAttribute(attr.name);
                    }
                    continue;
                }
                if (name === 'alt' || name === 'width' || name === 'height') {
                    continue;
                }
            }

            el.removeAttribute(attr.name);
        }

        if (tag === 'img' && !hasSafeImgSrc) {
            el.parentNode?.removeChild(el);
            continue;
        }

        if (tag === 'a' && hasTargetBlank && hasHref) {
            el.setAttribute('rel', 'noopener noreferrer');
        } else if (tag === 'a' && !hasHref) {
            el.removeAttribute('target');
            el.removeAttribute('rel');
        }
    }
}

function sanitizeAttrsFallback(tag: string, rawAttrs: string): { keepTag: boolean; attrs: string } {
    const attrRegex = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const kept: string[] = [];
    let hasSafeSrc = false;
    let hasHref = false;
    let hasTargetBlank = false;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(rawAttrs)) !== null) {
        const name = match[1].toLowerCase();
        const rawVal = match[2] ?? match[3] ?? match[4] ?? '';

        if (name.startsWith('on')) continue;

        if (name === 'style') {
            const cleanStyle = sanitizeCssDeclarations(rawVal);
            if (cleanStyle) {
                kept.push(`style="${escapeHtml(cleanStyle)}"`);
            }
            continue;
        }

        if (name === 'class' || name === 'dir' || name === 'title') {
            kept.push(`${name}="${escapeHtml(rawVal)}"`);
            continue;
        }

        if (tag === 'a') {
            if (name === 'href') {
                if (isSafeHref(rawVal)) {
                    hasHref = true;
                    kept.push(`href="${escapeHtml(rawVal.trim())}"`);
                }
                continue;
            }
            if (name === 'target' && (rawVal === '_blank' || rawVal === '_self')) {
                if (rawVal === '_blank') hasTargetBlank = true;
                kept.push(`target="${rawVal}"`);
                continue;
            }
        }

        if (tag === 'img') {
            if (name === 'src') {
                if (isSafeImgSrc(rawVal)) {
                    hasSafeSrc = true;
                    kept.push(`src="${escapeHtml(rawVal.trim())}"`);
                }
                continue;
            }
            if ((name === 'alt' || name === 'width' || name === 'height') && rawVal) {
                kept.push(`${name}="${escapeHtml(rawVal)}"`);
            }
        }
    }

    if (tag === 'img' && !hasSafeSrc) {
        return { keepTag: false, attrs: '' };
    }
    if (tag === 'a' && hasHref && hasTargetBlank) {
        kept.push('rel="noopener noreferrer"');
    }

    return { keepTag: true, attrs: kept.length > 0 ? ` ${kept.join(' ')}` : '' };
}

function sanitizeRichHtmlFallback(dirty: string): string {
    let cleaned = dirty.replace(/<!--[\s\S]*?-->/g, '');
    const dropBlockTags = Array.from(DROP_WITH_CONTENT_TAGS).join('|');
    const pairedBlockRe = new RegExp(
        `<\\s*(${dropBlockTags})(?:\\s[^>]*)?>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`,
        'gi',
    );
    let prev = '';
    while (cleaned !== prev) {
        prev = cleaned;
        cleaned = cleaned.replace(pairedBlockRe, '');
    }
    const selfClosingDropRe = new RegExp(`<\\s*\\/?\\s*(?:${dropBlockTags})(?:\\s[^>]*)?\\/?>`, 'gi');
    cleaned = cleaned.replace(selfClosingDropRe, '');

    return cleaned.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, (_full, slash: string, rawTag: string, rawAttrs: string) => {
        const tag = rawTag.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
            return '';
        }
        if (slash === '/') {
            if (tag === 'br' || tag === 'hr' || tag === 'img') return '';
            return `</${tag}>`;
        }
        const selfClose = tag === 'br' || tag === 'hr' || tag === 'img' ? '/' : '';
        const { keepTag, attrs } = sanitizeAttrsFallback(tag, rawAttrs || '');
        if (!keepTag) return '';
        return `<${tag}${attrs}${selfClose}>`;
    });
}

export function sanitizeRichHtml(dirty?: string | null): string {
    if (!dirty || typeof dirty !== 'string') return '';
    let sourceHtml = dirty;
    if (typeof window !== 'undefined' && typeof DOMPurify?.sanitize === 'function') {
        try {
            sourceHtml = DOMPurify.sanitize(dirty, {
                ALLOWED_TAGS: Array.from(ALLOWED_TAGS),
                ALLOWED_ATTR: [
                    'href',
                    'target',
                    'rel',
                    'src',
                    'alt',
                    'width',
                    'height',
                    'class',
                    'style',
                    'data-check',
                    'checked',
                ],
            });
        } catch {
            sourceHtml = dirty;
        }
    }
    if (typeof DOMParser !== 'undefined') {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(sourceHtml, 'text/html');
            if (doc?.body) {
                sanitizeDomTree(doc.body);
                return doc.body.innerHTML;
            }
        } catch {
            // Fall back to deterministic parser below
        }
    }
    return sanitizeRichHtmlFallback(sourceHtml);
}
