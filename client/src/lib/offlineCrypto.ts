/**
 * Client-side AES-256-GCM encryption wrapper for sensitive IndexedDB offline records.
 * Uses a per-browser-session random key held in sessionStorage (cleared on logout or tab close)
 * bound with AAD = "torex-idb-v1:<userScope>" so records cannot be read across sessions/users.
 */

const SESSION_KEY_STORAGE = 'torex_idb_sk_v1';
const OFFLINE_ENC_TAG = 'torex-idb-aes256gcm-v1';

interface EncryptedOfflineBlob {
    __torexEnc: typeof OFFLINE_ENC_TAG;
    iv: string;
    ct: string;
}

const keyCache = new Map<string, Promise<CryptoKey | null>>();

function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

function getOrCreateSessionSecretBytes(): Uint8Array | null {
    if (typeof window === 'undefined' || !window.crypto?.getRandomValues) {
        return null;
    }
    try {
        const existing = sessionStorage.getItem(SESSION_KEY_STORAGE);
        if (existing) {
            const bytes = base64ToBytes(existing);
            if (bytes.length === 32) return bytes;
        }
        const fresh = new Uint8Array(32);
        window.crypto.getRandomValues(fresh);
        sessionStorage.setItem(SESSION_KEY_STORAGE, bytesToBase64(fresh));
        return fresh;
    } catch {
        return null;
    }
}

export function clearOfflineSessionKey(): void {
    keyCache.clear();
    try {
        sessionStorage.removeItem(SESSION_KEY_STORAGE);
    } catch {
        // ignore storage errors
    }
}

async function getAesKeyForScope(userScope: string): Promise<CryptoKey | null> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;

    const scopeKey = String(userScope || 'anon');
    const cached = keyCache.get(scopeKey);
    if (cached) return cached;

    const promise = (async () => {
        try {
            const rawSecret = getOrCreateSessionSecretBytes();
            if (!rawSecret) return null;
            const hkdfKey = await subtle.importKey(
                'raw',
                rawSecret.slice().buffer,
                'HKDF',
                false,
                ['deriveKey'],
            );
            const salt = new TextEncoder().encode(`torex-idb-salt:${scopeKey}`);
            const info = new TextEncoder().encode('torex-idb-aes256gcm-v1');
            return await subtle.deriveKey(
                {
                    name: 'HKDF',
                    hash: 'SHA-256',
                    salt: salt.slice().buffer,
                    info: info.slice().buffer,
                },
                hkdfKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt'],
            );
        } catch {
            return null;
        }
    })();

    keyCache.set(scopeKey, promise);
    return promise;
}

export function isEncryptedOfflineBlob(val: unknown): val is EncryptedOfflineBlob {
    if (!val || typeof val !== 'object') return false;
    const obj = val as Record<string, unknown>;
    return (
        obj.__torexEnc === OFFLINE_ENC_TAG &&
        typeof obj.iv === 'string' &&
        typeof obj.ct === 'string'
    );
}

export async function encryptOfflineValue(userScope: string, value: unknown): Promise<any> {
    if (value === undefined || value === null) return value;
    const subtle = globalThis.crypto?.subtle;
    const key = await getAesKeyForScope(userScope);
    if (!subtle || !key) return value;

    try {
        const iv = new Uint8Array(12);
        globalThis.crypto.getRandomValues(iv);
        const encoded = new TextEncoder().encode(JSON.stringify(value));
        const aad = new TextEncoder().encode(`torex-idb-v1:${userScope}`);
        const ctBuf = await subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv.slice().buffer,
                additionalData: aad.slice().buffer,
                tagLength: 128,
            },
            key,
            encoded.slice().buffer,
        );
        const blob: EncryptedOfflineBlob = {
            __torexEnc: OFFLINE_ENC_TAG,
            iv: bytesToBase64(iv),
            ct: bytesToBase64(new Uint8Array(ctBuf)),
        };
        return blob;
    } catch {
        return value;
    }
}

export async function decryptOfflineValue<T = any>(
    userScope: string,
    stored: unknown,
): Promise<T | null> {
    if (stored === undefined || stored === null) return null;
    if (!isEncryptedOfflineBlob(stored)) {
        // Transparent fallback for legacy unencrypted records
        return stored as T;
    }

    const subtle = globalThis.crypto?.subtle;
    const key = await getAesKeyForScope(userScope);
    if (!subtle || !key) return null;

    try {
        const iv = base64ToBytes(stored.iv);
        const ct = base64ToBytes(stored.ct);
        const aad = new TextEncoder().encode(`torex-idb-v1:${userScope}`);
        const plainBuf = await subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv.slice().buffer,
                additionalData: aad.slice().buffer,
                tagLength: 128,
            },
            key,
            ct.slice().buffer,
        );
        const decoded = new TextDecoder().decode(plainBuf);
        return JSON.parse(decoded) as T;
    } catch {
        // Session key rotated or wiped -> treat stale encrypted record as expired cache miss
        return null;
    }
}
