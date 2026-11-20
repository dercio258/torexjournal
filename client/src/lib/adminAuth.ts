export function isAdminApiUrl(url?: string | null): boolean {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;

    let pathname = trimmed;
    try {
        if (/^https?:\/\//i.test(trimmed)) {
            pathname = new URL(trimmed).pathname;
        } else {
            pathname = trimmed.split('?')[0].split('#')[0];
        }
    } catch {
        pathname = trimmed.split('?')[0].split('#')[0];
    }

    const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return (
        normalized === '/admin' ||
        normalized.startsWith('/admin/') ||
        normalized === '/api/admin' ||
        normalized.startsWith('/api/admin/')
    );
}

function decodeBase64Url(segment: string): string {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    if (typeof atob === 'function') {
        return atob(padded);
    }
    return Buffer.from(padded, 'base64').toString('utf8');
}

export function isValidAdminToken(tokenOverride?: string | null): boolean {
    const usesStorage = tokenOverride === undefined;
    const token =
        tokenOverride !== undefined
            ? tokenOverride
            : typeof localStorage !== 'undefined'
              ? localStorage.getItem('adminToken')
              : null;

    if (!token || typeof token !== 'string') {
        return false;
    }

    try {
        const parts = token.split('.');
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
            if (usesStorage && typeof localStorage !== 'undefined') {
                localStorage.removeItem('adminToken');
            }
            return false;
        }

        const payload = JSON.parse(decodeBase64Url(parts[1]));
        if (!payload || typeof payload !== 'object') {
            if (usesStorage && typeof localStorage !== 'undefined') {
                localStorage.removeItem('adminToken');
            }
            return false;
        }

        if (payload.role !== 'admin' || payload.isAdmin !== true) {
            if (usesStorage && typeof localStorage !== 'undefined') {
                localStorage.removeItem('adminToken');
            }
            return false;
        }

        if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
            if (usesStorage && typeof localStorage !== 'undefined') {
                localStorage.removeItem('adminToken');
            }
            return false;
        }

        return true;
    } catch {
        if (usesStorage && typeof localStorage !== 'undefined') {
            localStorage.removeItem('adminToken');
        }
        return false;
    }
}
