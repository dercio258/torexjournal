import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'crypto';

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
