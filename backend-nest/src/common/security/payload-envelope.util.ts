import {
    createCipheriv,
    createDecipheriv,
    createECDH,
    ECDH,
    hkdfSync,
    randomBytes,
} from 'crypto';

/**
 * Masks an email address while preserving recognizable hints (e.g. "de***9@gmail.com").
 */
export function maskEmailAddress(email?: string | null): string {
    const raw = String(email || '').trim();
    if (!raw) return '';
    const atIndex = raw.indexOf('@');
    if (atIndex <= 0) return '***';
    const local = raw.slice(0, atIndex);
    const domain = raw.slice(atIndex + 1);
    if (!domain) return '***';
    if (local.length <= 2) {
        return `${local[0] || '*'}***@${domain}`;
    }
    return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

/**
 * Masks a phone / WhatsApp number keeping country prefix (if "+") and last 4 digits.
 */
export function maskPhoneNumber(phone?: string | null): string | null {
    const trimmed = String(phone || '').trim();
    if (!trimmed) return null;
    if (trimmed.length <= 4) return '••••';
    if (trimmed.startsWith('+')) {
        const spaceIdx = trimmed.indexOf(' ');
        const prefix = spaceIdx > 1 && spaceIdx <= 6 ? trimmed.slice(0, spaceIdx) : trimmed.slice(0, 4);
        return `${prefix} •••• ${trimmed.slice(-4)}`;
    }
    return `•••• ${trimmed.slice(-4)}`;
}

/**
 * Masks a credential / EA token keeping only its last 4 characters.
 */
export function maskSecretToken(token?: string | null): string {
    const trimmed = String(token || '').trim();
    if (!trimmed) return '';
    if (trimmed.length <= 4) return '••••••••••••••••••••';
    return `••••••••••••••••••••${trimmed.slice(-4)}`;
}

/**
 * Encrypts a JSON response string using an ephemeral ECDH (P-256) keypair +
 * HKDF-SHA256 + AES-256-GCM bound to AAD = epk || clientPub || iv.
 * Returns null if clientPubB64Url is invalid so callers can fail gracefully.
 */
export function encryptJsonEnvelopeForClient(
    jsonPayload: string,
    clientPubB64Url: string,
): string | null {
    try {
        if (typeof jsonPayload !== 'string' || typeof clientPubB64Url !== 'string') {
            return null;
        }
        const clientPubBuf = Buffer.from(clientPubB64Url.trim(), 'base64url');
        if (clientPubBuf.length !== 65 || clientPubBuf[0] !== 0x04) {
            return null;
        }

        const ecdh = createECDH('prime256v1');
        const serverPubBuf = ecdh.generateKeys(); // 65-byte uncompressed P-256 point
        const sharedSecret = ecdh.computeSecret(clientPubBuf); // 32 bytes
        const iv = randomBytes(12);
        const aesKey = Buffer.from(
            hkdfSync('sha256', sharedSecret, iv, Buffer.from('torex-envelope-v1', 'utf8'), 32),
        );
        const aad = Buffer.concat([serverPubBuf, clientPubBuf, iv]);
        const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
        cipher.setAAD(aad);
        const ct = Buffer.concat([cipher.update(jsonPayload, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return JSON.stringify({
            _enc: 'ecdh-p256-aes256gcm-v1',
            epk: serverPubBuf.toString('base64url'),
            iv: iv.toString('base64url'),
            tag: tag.toString('base64url'),
            ct: ct.toString('base64url'),
        });
    } catch {
        return null;
    }
}

// =============================================================================
// Bidirectional Request Payload Encryption (Client -> Server ECDH P-256)
// =============================================================================

export interface EncryptedRequestEnvelope {
    _enc: 'ecdh-p256-aes256gcm-req-v1';
    kid: string;
    epk: string;
    iv: string;
    tag: string;
    ct: string;
}

interface ServerKemEntry {
    kid: string;
    ecdh: ECDH;
    publicKeyBuf: Buffer;
    publicKeyB64Url: string;
    createdAt: number;
    expiresAt: number;
}

const SERVER_KEM_ROTATE_MS = 12 * 60 * 60 * 1000; // Rotate active key every 12h
const SERVER_KEM_GRACE_MS = 2 * 60 * 60 * 1000;   // Keep previous key valid for 2h

let activeServerKem: ServerKemEntry | null = null;
let previousServerKem: ServerKemEntry | null = null;

function createServerKemEntry(): ServerKemEntry {
    const ecdh = createECDH('prime256v1');
    const publicKeyBuf = ecdh.generateKeys();
    const now = Date.now();
    return {
        kid: `sk_${randomBytes(6).toString('hex')}`,
        ecdh,
        publicKeyBuf,
        publicKeyB64Url: publicKeyBuf.toString('base64url'),
        createdAt: now,
        expiresAt: now + SERVER_KEM_ROTATE_MS,
    };
}

function ensureActiveServerKem(): ServerKemEntry {
    const now = Date.now();
    if (!activeServerKem) {
        activeServerKem = createServerKemEntry();
        return activeServerKem;
    }
    if (now >= activeServerKem.expiresAt) {
        previousServerKem = {
            ...activeServerKem,
            expiresAt: now + SERVER_KEM_GRACE_MS,
        };
        activeServerKem = createServerKemEntry();
    }
    return activeServerKem;
}

export function getServerKemPublicBundle() {
    const active = ensureActiveServerKem();
    return {
        alg: 'ecdh-p256-aes256gcm-req-v1',
        kid: active.kid,
        pub: active.publicKeyB64Url,
        expiresAt: new Date(active.expiresAt).toISOString(),
    };
}

export function isEncryptedRequestEnvelope(body: unknown): body is EncryptedRequestEnvelope {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const obj = body as Record<string, unknown>;
    return (
        obj._enc === 'ecdh-p256-aes256gcm-req-v1' &&
        typeof obj.kid === 'string' &&
        typeof obj.epk === 'string' &&
        typeof obj.iv === 'string' &&
        typeof obj.tag === 'string' &&
        typeof obj.ct === 'string'
    );
}

/**
 * Decrypts a client-encrypted sensitive JSON request body using the server's
 * matching ECDH P-256 key (`kid`). Bound to AAD = clientEpk || serverPub || iv.
 */
export function decryptRequestEnvelopeFromClient(
    env: EncryptedRequestEnvelope,
): Record<string, any> | null {
    try {
        const active = ensureActiveServerKem();
        const now = Date.now();
        let entry: ServerKemEntry | null = null;
        if (active.kid === env.kid) {
            entry = active;
        } else if (
            previousServerKem &&
            previousServerKem.kid === env.kid &&
            previousServerKem.expiresAt > now
        ) {
            entry = previousServerKem;
        }
        if (!entry) return null;

        const clientEpkBuf = Buffer.from(env.epk.trim(), 'base64url');
        const ivBuf = Buffer.from(env.iv.trim(), 'base64url');
        const tagBuf = Buffer.from(env.tag.trim(), 'base64url');
        const ctBuf = Buffer.from(env.ct.trim(), 'base64url');

        if (clientEpkBuf.length !== 65 || clientEpkBuf[0] !== 0x04) return null;
        if (ivBuf.length !== 12 || tagBuf.length !== 16) return null;

        const sharedSecret = entry.ecdh.computeSecret(clientEpkBuf);
        const aesKey = Buffer.from(
            hkdfSync(
                'sha256',
                sharedSecret,
                ivBuf,
                Buffer.from('torex-req-envelope-v1', 'utf8'),
                32,
            ),
        );
        const aad = Buffer.concat([clientEpkBuf, entry.publicKeyBuf, ivBuf]);
        const decipher = createDecipheriv('aes-256-gcm', aesKey, ivBuf);
        decipher.setAAD(aad);
        decipher.setAuthTag(tagBuf);
        const plain = Buffer.concat([decipher.update(ctBuf), decipher.final()]).toString('utf8');
        const parsed = JSON.parse(plain);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}
