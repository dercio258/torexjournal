import {
    createCipheriv,
    createDecipheriv,
    createECDH,
    createPrivateKey,
    createPublicKey,
    createSign,
    createVerify,
    hkdfSync,
    randomBytes,
} from 'crypto';

export interface VapidKeyPair {
    publicKey: string;
    privateKey: string;
    subject: string;
    ephemeralDev: boolean;
}

export interface WebPushEncryptResult {
    body: Buffer;
    salt: Buffer;
    serverPublicKey: Buffer;
}

let cachedDevVapid: VapidKeyPair | null = null;

export function generateVapidKeyPair(subject = 'mailto:suporte@torexjournal.com'): VapidKeyPair {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const pub = ecdh.getPublicKey();
    const priv = ecdh.getPrivateKey();
    const paddedPriv = priv.length < 32 ? Buffer.concat([Buffer.alloc(32 - priv.length, 0), priv]) : priv;
    return {
        publicKey: pub.toString('base64url'),
        privateKey: paddedPriv.toString('base64url'),
        subject,
        ephemeralDev: false,
    };
}

export function resolveVapidKeysFromEnv(): VapidKeyPair | null {
    const rawPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const rawPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = (process.env.VAPID_SUBJECT || 'mailto:suporte@torexjournal.com').trim();
    const isProd = process.env.NODE_ENV === 'production';

    if (
        rawPub &&
        rawPriv &&
        !rawPub.startsWith('CHANGE_ME') &&
        !rawPriv.startsWith('CHANGE_ME')
    ) {
        return {
            publicKey: rawPub,
            privateKey: rawPriv,
            subject,
            ephemeralDev: false,
        };
    }

    if (isProd) {
        return null;
    }

    if (!cachedDevVapid) {
        const generated = generateVapidKeyPair(subject);
        cachedDevVapid = { ...generated, ephemeralDev: true };
    }
    return cachedDevVapid;
}

export function validatePushSubscriptionEndpoint(rawEndpoint: string): URL {
    const url = new URL(String(rawEndpoint || '').trim());
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost && process.env.NODE_ENV !== 'production')) {
        throw new Error('Endpoint de Web Push deve usar HTTPS.');
    }
    return url;
}

/**
 * Encrypts a UTF-8 Web Push payload according to RFC 8291 (aes128gcm).
 */
export function encryptWebPushAes128Gcm(params: {
    payload: string | Buffer;
    p256dh: string;
    auth: string;
}): WebPushEncryptResult {
    const uaPublic = Buffer.from(params.p256dh, 'base64url');
    const authSecret = Buffer.from(params.auth, 'base64url');

    if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
        throw new Error('Chave p256dh inválida (esperados 65 bytes P-256 uncompressed).');
    }
    if (authSecret.length < 12) {
        throw new Error('Segredo auth de Web Push inválido.');
    }

    const serverEcdh = createECDH('prime256v1');
    serverEcdh.generateKeys();
    const asPublic = serverEcdh.getPublicKey();
    const ecdhSecret = serverEcdh.computeSecret(uaPublic);

    const salt = randomBytes(16);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));

    const cek = Buffer.from(
        hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16),
    );
    const nonce = Buffer.from(
        hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12),
    );

    const payloadBuf = Buffer.isBuffer(params.payload)
        ? params.payload
        : Buffer.from(params.payload, 'utf8');
    // RFC 8291 §2: single-record padding ends with 0x02 delimiter byte
    const padded = Buffer.concat([payloadBuf, Buffer.from([0x02])]);

    const cipher = createCipheriv('aes-128-gcm', cek, nonce);
    const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // RFC 8188 header: salt(16) || rs(4 BE) || idlen(1) || keyid(65)
    const rsBuf = Buffer.alloc(4);
    rsBuf.writeUInt32BE(4096, 0);
    const idLenBuf = Buffer.from([asPublic.length]);
    const body = Buffer.concat([salt, rsBuf, idLenBuf, asPublic, ciphertext, authTag]);

    return { body, salt, serverPublicKey: asPublic };
}

/**
 * Decrypts RFC 8291 (aes128gcm) payload (used in automated verification tests).
 */
export function decryptWebPushAes128Gcm(params: {
    body: Buffer;
    uaPrivateKey: Buffer;
    uaPublicKey: Buffer;
    authSecret: Buffer;
}): Buffer {
    const salt = params.body.subarray(0, 16);
    const idLen = params.body[20];
    const asPublic = params.body.subarray(21, 21 + idLen);
    const encryptedWithTag = params.body.subarray(21 + idLen);
    const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);
    const authTag = encryptedWithTag.subarray(encryptedWithTag.length - 16);

    const clientEcdh = createECDH('prime256v1');
    clientEcdh.setPrivateKey(params.uaPrivateKey);
    const ecdhSecret = clientEcdh.computeSecret(asPublic);

    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), params.uaPublicKey, asPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, params.authSecret, keyInfo, 32));
    const cek = Buffer.from(
        hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16),
    );
    const nonce = Buffer.from(
        hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12),
    );

    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(authTag);
    const plaintextPadded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    let end = plaintextPadded.length;
    while (end > 0 && plaintextPadded[end - 1] === 0x00) end--;
    if (end > 0 && plaintextPadded[end - 1] === 0x02) end--;
    return plaintextPadded.subarray(0, end);
}

/**
 * Builds RFC 8292 VAPID ES256 Authorization header (`vapid t=..., k=...`).
 */
export function buildVapidAuthorizationHeader(params: {
    audienceOrigin: string;
    vapidPublicKey: string;
    vapidPrivateKey: string;
    subject: string;
    expirationEpochSec?: number;
}): string {
    const pubBuf = Buffer.from(params.vapidPublicKey, 'base64url');
    const privBuf = Buffer.from(params.vapidPrivateKey, 'base64url');

    if (pubBuf.length !== 65 || pubBuf[0] !== 0x04 || privBuf.length < 30) {
        throw new Error('Chaves VAPID inválidas para ES256.');
    }

    const paddedPriv =
        privBuf.length < 32 ? Buffer.concat([Buffer.alloc(32 - privBuf.length, 0), privBuf]) : privBuf.subarray(0, 32);

    const privateKeyObj = createPrivateKey({
        key: {
            kty: 'EC',
            crv: 'P-256',
            x: pubBuf.subarray(1, 33).toString('base64url'),
            y: pubBuf.subarray(33, 65).toString('base64url'),
            d: paddedPriv.toString('base64url'),
        },
        format: 'jwk',
    });

    const headerB64 = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
    const exp = params.expirationEpochSec ?? Math.floor(Date.now() / 1000) + 12 * 3600;
    const claimsB64 = Buffer.from(
        JSON.stringify({
            aud: params.audienceOrigin,
            exp,
            sub: params.subject,
        }),
    ).toString('base64url');

    const unsigned = `${headerB64}.${claimsB64}`;
    const signer = createSign('SHA256');
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign({ key: privateKeyObj, dsaEncoding: 'ieee-p1363' });

    const jwt = `${unsigned}.${signature.toString('base64url')}`;
    return `vapid t=${jwt}, k=${params.vapidPublicKey}`;
}

export function verifyVapidJwtForTest(jwt: string, vapidPublicKey: string): Record<string, any> | null {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const pubBuf = Buffer.from(vapidPublicKey, 'base64url');
    const verifier = createVerify('SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const publicKeyObj = createPublicKey({
        key: {
            kty: 'EC',
            crv: 'P-256',
            x: pubBuf.subarray(1, 33).toString('base64url'),
            y: pubBuf.subarray(33, 65).toString('base64url'),
        },
        format: 'jwk',
    });
    const ok = verifier.verify(
        { key: publicKeyObj, dsaEncoding: 'ieee-p1363' },
        Buffer.from(parts[2], 'base64url'),
    );
    if (!ok) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

export async function sendEncryptedWebPushRequest(params: {
    endpoint: string;
    p256dh: string;
    auth: string;
    payload: Record<string, any>;
    vapid: VapidKeyPair;
    ttlSeconds?: number;
}): Promise<{ ok: boolean; status: number; gone: boolean; error?: string }> {
    const endpointUrl = validatePushSubscriptionEndpoint(params.endpoint);
    const jsonPayload = JSON.stringify(params.payload);
    const { body } = encryptWebPushAes128Gcm({
        payload: jsonPayload,
        p256dh: params.p256dh,
        auth: params.auth,
    });

    const authHeader = buildVapidAuthorizationHeader({
        audienceOrigin: endpointUrl.origin,
        vapidPublicKey: params.vapid.publicKey,
        vapidPrivateKey: params.vapid.privateKey,
        subject: params.vapid.subject,
    });

    const response = await fetch(endpointUrl.toString(), {
        method: 'POST',
        headers: {
            Authorization: authHeader,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(params.ttlSeconds ?? 86400),
            Urgency: 'normal',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(10_000),
    });

    const gone = response.status === 404 || response.status === 410;
    if (response.ok || response.status === 201) {
        return { ok: true, status: response.status, gone: false };
    }
    const errText = await response.text().catch(() => '');
    return {
        ok: false,
        status: response.status,
        gone,
        error: errText.slice(0, 240) || `HTTP ${response.status}`,
    };
}
