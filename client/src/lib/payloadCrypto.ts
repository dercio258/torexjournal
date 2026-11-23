interface ClientKemSession {
    privateKey: CryptoKey;
    publicKeyBytes: Uint8Array;
    publicKeyB64Url: string;
}

export interface EncryptedPayloadEnvelope {
    _enc: string;
    epk: string;
    iv: string;
    tag: string;
    ct: string;
}

let cachedSessionPromise: Promise<ClientKemSession | null> | null = null;

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(input: string): Uint8Array {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLen);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}

async function getOrCreateClientKemSession(): Promise<ClientKemSession | null> {
    if (cachedSessionPromise) return cachedSessionPromise;
    cachedSessionPromise = (async () => {
        try {
            const subtle = globalThis.crypto?.subtle;
            if (!subtle) return null;
            const pair = await subtle.generateKey(
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                ['deriveBits'],
            );
            const rawPub = await subtle.exportKey('raw', pair.publicKey);
            const publicKeyBytes = new Uint8Array(rawPub);
            if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
                return null;
            }
            return {
                privateKey: pair.privateKey,
                publicKeyBytes,
                publicKeyB64Url: bytesToBase64Url(publicKeyBytes),
            };
        } catch {
            return null;
        }
    })();
    return cachedSessionPromise;
}

export async function getClientKemPublicKeyHeader(): Promise<string | null> {
    const session = await getOrCreateClientKemSession();
    return session ? session.publicKeyB64Url : null;
}

export function isEncryptedEnvelope(val: unknown): val is EncryptedPayloadEnvelope {
    if (!val || typeof val !== 'object') return false;
    const obj = val as Record<string, unknown>;
    return (
        obj._enc === 'ecdh-p256-aes256gcm-v1' &&
        typeof obj.epk === 'string' &&
        typeof obj.iv === 'string' &&
        typeof obj.tag === 'string' &&
        typeof obj.ct === 'string'
    );
}

export async function decryptJsonEnvelope<T = any>(env: EncryptedPayloadEnvelope): Promise<T> {
    const session = await getOrCreateClientKemSession();
    const subtle = globalThis.crypto?.subtle;
    if (!session || !subtle) {
        throw new Error('Envelope decryption unavailable in current browser context.');
    }

    const epkBytes = base64UrlToBytes(env.epk);
    const ivBytes = base64UrlToBytes(env.iv);
    const tagBytes = base64UrlToBytes(env.tag);
    const ctBytes = base64UrlToBytes(env.ct);

    const epkBuffer = epkBytes.slice().buffer;
    const ivBuffer = ivBytes.slice().buffer;

    const serverPubKey = await subtle.importKey(
        'raw',
        epkBuffer,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
    );

    const sharedBits = await subtle.deriveBits(
        { name: 'ECDH', public: serverPubKey },
        session.privateKey,
        256,
    );

    const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const infoBytes = new TextEncoder().encode('torex-envelope-v1');
    const aesKey = await subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: ivBuffer,
            info: infoBytes.slice().buffer,
        },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
    );

    const aad = concatBytes(epkBytes, session.publicKeyBytes, ivBytes);
    const cipherWithTag = concatBytes(ctBytes, tagBytes);

    const plaintextBuf = await subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: ivBuffer,
            additionalData: aad.slice().buffer,
            tagLength: 128,
        },
        aesKey,
        cipherWithTag.slice().buffer,
    );

    const decoded = new TextDecoder().decode(plaintextBuf);
    return JSON.parse(decoded) as T;
}

export interface ServerKemPublicBundle {
    alg: string;
    kid: string;
    pub: string;
    expiresAt: string;
}

export interface EncryptedRequestEnvelope {
    _enc: 'ecdh-p256-aes256gcm-req-v1';
    kid: string;
    epk: string;
    iv: string;
    tag: string;
    ct: string;
}

/**
 * Encrypts a sensitive outgoing JSON request body (e.g. login, MT5 credentials, Deriv token)
 * using an ephemeral client ECDH P-256 keypair + server public key (`kid`) + HKDF-SHA256 + AES-256-GCM.
 */
export async function encryptRequestJsonEnvelope(
    payload: unknown,
    serverBundle: ServerKemPublicBundle,
): Promise<{ envelope: EncryptedRequestEnvelope; timestamp: string; nonce: string } | null> {
    try {
        const subtle = globalThis.crypto?.subtle;
        if (!subtle || !serverBundle?.pub || !serverBundle?.kid) return null;

        const serverPubBytes = base64UrlToBytes(serverBundle.pub);
        if (serverPubBytes.length !== 65 || serverPubBytes[0] !== 0x04) return null;

        const serverPubKey = await subtle.importKey(
            'raw',
            serverPubBytes.slice().buffer,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            [],
        );

        const ephemeralPair = await subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            ['deriveBits'],
        );
        const rawEpk = await subtle.exportKey('raw', ephemeralPair.publicKey);
        const clientEpkBytes = new Uint8Array(rawEpk);

        const sharedBits = await subtle.deriveBits(
            { name: 'ECDH', public: serverPubKey },
            ephemeralPair.privateKey,
            256,
        );

        const ivBytes = new Uint8Array(12);
        globalThis.crypto.getRandomValues(ivBytes);

        const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
        const infoBytes = new TextEncoder().encode('torex-req-envelope-v1');
        const aesKey = await subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: ivBytes.slice().buffer,
                info: infoBytes.slice().buffer,
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt'],
        );

        const aad = concatBytes(clientEpkBytes, serverPubBytes, ivBytes);
        const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));
        const cipherWithTagBuf = await subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: ivBytes.slice().buffer,
                additionalData: aad.slice().buffer,
                tagLength: 128,
            },
            aesKey,
            plaintextBytes.slice().buffer,
        );
        const cipherWithTag = new Uint8Array(cipherWithTagBuf);
        const ctBytes = cipherWithTag.slice(0, cipherWithTag.length - 16);
        const tagBytes = cipherWithTag.slice(cipherWithTag.length - 16);

        const nonceBytes = new Uint8Array(12);
        globalThis.crypto.getRandomValues(nonceBytes);

        return {
            envelope: {
                _enc: 'ecdh-p256-aes256gcm-req-v1',
                kid: serverBundle.kid,
                epk: bytesToBase64Url(clientEpkBytes),
                iv: bytesToBase64Url(ivBytes),
                tag: bytesToBase64Url(tagBytes),
                ct: bytesToBase64Url(ctBytes),
            },
            timestamp: String(Math.floor(Date.now() / 1000)),
            nonce: bytesToBase64Url(nonceBytes),
        };
    } catch {
        return null;
    }
}

export function maskEmailClient(email?: string | null): string {
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
