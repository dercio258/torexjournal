import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    createHash,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    KeyObject,
    sign as cryptoSign,
    verify as cryptoVerify,
} from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type SignaturePurpose =
    | 'performance_report'
    | 'audit_checkpoint'
    | 'ai_export'
    | 'document';

export interface DigitalSignatureEnvelope {
    alg: 'Ed25519';
    kid: string;
    issuer: string;
    purpose: SignaturePurpose;
    signedAt: string;
    contentHashSha256: string;
    signature: string;
    publicKeyFingerprint: string;
}

export interface SigningPublicKeyBundle {
    alg: 'Ed25519';
    kid: string;
    issuer: string;
    publicKeyPem: string;
    fingerprintSha256: string;
}

export interface SignatureVerificationResult {
    valid: boolean;
    reason?: string;
    kid?: string;
    purpose?: SignaturePurpose;
    signedAt?: string;
    contentHashSha256?: string;
    fingerprintSha256?: string;
    verifiedAt: string;
}

/**
 * Deterministic canonical JSON serializer: recursively sorts object keys and omits `_signature`
 * so signatures remain stable across JSON serialization boundaries.
 */
export function canonicalizeForSignature(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
        return JSON.stringify(Number.isFinite(value as number) || typeof value === 'boolean' ? value : null);
    }
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (value instanceof Date) {
        return JSON.stringify(value.toISOString());
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalizeForSignature(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj)
            .filter((k) => k !== '_signature' && obj[k] !== undefined)
            .sort();
        const pairs = keys.map(
            (k) => `${JSON.stringify(k)}:${canonicalizeForSignature(obj[k])}`,
        );
        return `{${pairs.join(',')}}`;
    }
    return JSON.stringify(String(value));
}

function normalizePemEnv(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.includes('-----BEGIN ')) {
        return trimmed.replace(/\\n/g, '\n');
    }
    // Support base64-encoded PEM in env variables
    try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
        if (decoded.includes('-----BEGIN ')) {
            return decoded;
        }
    } catch {
        // Not base64
    }
    return trimmed;
}

function computeKeyFingerprint(publicKeyPem: string): string {
    return createHash('sha256').update(publicKeyPem.trim(), 'utf8').digest('hex');
}

function buildSigningMessage(parts: {
    purpose: string;
    kid: string;
    signedAt: string;
    contentHashSha256: string;
}): Buffer {
    const canonical = `TOREX-SIG-V1|${parts.purpose}|${parts.kid}|${parts.signedAt}|${parts.contentHashSha256}`;
    return Buffer.from(canonical, 'utf8');
}

/**
 * Asymmetric Ed25519 digital signature service for non-repudiable Torex Journal artifacts:
 * - Operational & Performance Reports (verifiable by prop firms / mentors / investors)
 * - Admin Audit Log Hash-Chain Checkpoints
 * - Exported AI Training Datasets
 */
@Injectable()
export class DigitalSignatureService implements OnModuleInit {
    private readonly logger = new Logger(DigitalSignatureService.name);
    private privateKey!: KeyObject;
    private publicKey!: KeyObject;
    private publicKeyPem!: string;
    private fingerprintSha256!: string;
    private activeKid!: string;
    private readonly issuer = 'torexjournal.com';
    private readonly verificationKeys = new Map<string, { publicKey: KeyObject; fingerprint: string }>();

    constructor(private readonly configService?: ConfigService) {
        this.initializeKeys();
    }

    onModuleInit() {
        const isProd = (this.readEnv('NODE_ENV') || 'development') === 'production';
        if (isProd && !this.readEnv('SIGNING_PRIVATE_KEY_PEM')) {
            this.logger.warn(
                'SIGNING_PRIVATE_KEY_PEM não definido em produção — usando chave Ed25519 local persistida. Configure SIGNING_PRIVATE_KEY_PEM para consistência entre múltiplas instâncias.',
            );
        }
    }

    private readEnv(key: string): string {
        return (this.configService?.get<string>(key) ?? process.env[key] ?? '').trim();
    }

    private initializeKeys(): void {
        const envPem = normalizePemEnv(this.readEnv('SIGNING_PRIVATE_KEY_PEM'));
        let loadedPrivateKey: KeyObject | null = null;

        if (envPem) {
            try {
                loadedPrivateKey = createPrivateKey(envPem);
            } catch (err: any) {
                this.logger.error(
                    `SIGNING_PRIVATE_KEY_PEM inválido (${err?.message || err}). Gerando par Ed25519 de contingência.`,
                );
            }
        }

        if (!loadedPrivateKey && process.env.NODE_ENV !== 'test') {
            const keyDir = path.resolve(process.cwd(), '.torex-keys');
            const keyFile = path.join(keyDir, 'signing-ed25519.pem');
            try {
                if (fs.existsSync(keyFile)) {
                    loadedPrivateKey = createPrivateKey(fs.readFileSync(keyFile, 'utf8'));
                } else {
                    const pair = generateKeyPairSync('ed25519');
                    const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
                    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
                    fs.writeFileSync(keyFile, pem, { mode: 0o600 });
                    loadedPrivateKey = pair.privateKey;
                }
            } catch {
                // Fall back to ephemeral in-memory keypair if filesystem is read-only
            }
        }

        if (!loadedPrivateKey) {
            const pair = generateKeyPairSync('ed25519');
            loadedPrivateKey = pair.privateKey;
        }

        this.privateKey = loadedPrivateKey;
        this.publicKey = createPublicKey(loadedPrivateKey);
        this.publicKeyPem = this.publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString()
            .trim();
        this.fingerprintSha256 = computeKeyFingerprint(this.publicKeyPem);
        this.activeKid =
            this.readEnv('SIGNING_KEY_ID') || `ed25519-${this.fingerprintSha256.slice(0, 12)}`;

        this.verificationKeys.set(this.activeKid, {
            publicKey: this.publicKey,
            fingerprint: this.fingerprintSha256,
        });

        // Optional previous public keys for verification across key rotations
        const prevRaw = this.readEnv('SIGNING_PUBLIC_KEYS_PREVIOUS');
        if (prevRaw) {
            for (const entry of prevRaw.split('||')) {
                const pem = normalizePemEnv(entry);
                if (!pem) continue;
                try {
                    const pub = createPublicKey(pem);
                    const normalizedPem = pub
                        .export({ type: 'spki', format: 'pem' })
                        .toString()
                        .trim();
                    const fp = computeKeyFingerprint(normalizedPem);
                    this.verificationKeys.set(`ed25519-${fp.slice(0, 12)}`, {
                        publicKey: pub,
                        fingerprint: fp,
                    });
                } catch {
                    // Ignore malformed previous public key
                }
            }
        }
    }

    getPublicKeyBundle(): SigningPublicKeyBundle {
        return {
            alg: 'Ed25519',
            kid: this.activeKid,
            issuer: this.issuer,
            publicKeyPem: this.publicKeyPem,
            fingerprintSha256: this.fingerprintSha256,
        };
    }

    computeCanonicalContentHash(payload: unknown): string {
        const canonical = typeof payload === 'string' ? payload : canonicalizeForSignature(payload);
        return createHash('sha256').update(canonical, 'utf8').digest('hex');
    }

    signCanonicalPayload(
        payload: unknown,
        purpose: SignaturePurpose = 'document',
    ): DigitalSignatureEnvelope {
        const contentHashSha256 = this.computeCanonicalContentHash(payload);
        return this.signHash(contentHashSha256, purpose);
    }

    signHash(
        contentHashSha256: string,
        purpose: SignaturePurpose = 'document',
    ): DigitalSignatureEnvelope {
        const signedAt = new Date().toISOString();
        const message = buildSigningMessage({
            purpose,
            kid: this.activeKid,
            signedAt,
            contentHashSha256,
        });
        const signature = cryptoSign(null, message, this.privateKey).toString('base64url');
        return {
            alg: 'Ed25519',
            kid: this.activeKid,
            issuer: this.issuer,
            purpose,
            signedAt,
            contentHashSha256,
            signature,
            publicKeyFingerprint: this.fingerprintSha256,
        };
    }

    verifySignedEnvelope(input: {
        payload?: unknown;
        contentHashSha256?: string;
        envelope: Partial<DigitalSignatureEnvelope> | null | undefined;
    }): SignatureVerificationResult {
        const verifiedAt = new Date().toISOString();
        const env = input?.envelope;
        if (
            !env ||
            env.alg !== 'Ed25519' ||
            typeof env.kid !== 'string' ||
            typeof env.purpose !== 'string' ||
            typeof env.signedAt !== 'string' ||
            typeof env.contentHashSha256 !== 'string' ||
            typeof env.signature !== 'string'
        ) {
            return {
                valid: false,
                reason: 'ENVELOPE_MALFORMED',
                verifiedAt,
            };
        }

        const keyEntry = this.verificationKeys.get(env.kid);
        if (!keyEntry) {
            return {
                valid: false,
                reason: 'UNKNOWN_KEY_ID',
                kid: env.kid,
                verifiedAt,
            };
        }

        // Verify content hash if caller provided the payload or an external hash
        if (input.payload !== undefined) {
            const recomputedHash = this.computeCanonicalContentHash(input.payload);
            if (recomputedHash !== env.contentHashSha256) {
                return {
                    valid: false,
                    reason: 'CONTENT_HASH_MISMATCH',
                    kid: env.kid,
                    purpose: env.purpose as SignaturePurpose,
                    signedAt: env.signedAt,
                    contentHashSha256: env.contentHashSha256,
                    fingerprintSha256: keyEntry.fingerprint,
                    verifiedAt,
                };
            }
        } else if (
            input.contentHashSha256 &&
            input.contentHashSha256 !== env.contentHashSha256
        ) {
            return {
                valid: false,
                reason: 'CONTENT_HASH_MISMATCH',
                kid: env.kid,
                verifiedAt,
            };
        }

        try {
            const message = buildSigningMessage({
                purpose: env.purpose,
                kid: env.kid,
                signedAt: env.signedAt,
                contentHashSha256: env.contentHashSha256,
            });
            const sigBuf = Buffer.from(env.signature, 'base64url');
            const isValid = cryptoVerify(null, message, keyEntry.publicKey, sigBuf);

            return {
                valid: isValid,
                ...(isValid ? {} : { reason: 'SIGNATURE_INVALID' }),
                kid: env.kid,
                purpose: env.purpose as SignaturePurpose,
                signedAt: env.signedAt,
                contentHashSha256: env.contentHashSha256,
                fingerprintSha256: keyEntry.fingerprint,
                verifiedAt,
            };
        } catch {
            return {
                valid: false,
                reason: 'VERIFICATION_ERROR',
                kid: env.kid,
                verifiedAt,
            };
        }
    }
}
