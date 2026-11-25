import {
    createCipheriv,
    createDecipheriv,
    hkdfSync,
    randomBytes,
    scryptSync,
} from 'crypto';

export interface CryptoKeyring {
    activeKid: string;
    keys: Record<string, string>;
}

export interface CryptoEncryptOptions {
    kid?: string;
    aad?: string;
}

export interface CryptoDecryptOptions {
    aad?: string;
}

const HKDF_INFO_PREFIX = 'torex-at-rest-v3:';

export class CryptoUtil {
    private static readonly ALGORITHM = 'aes-256-gcm';
    private static readonly IV_LENGTH = 12;
    private static readonly SALT_LENGTH = 16;
    private static readonly KEY_LENGTH = 32;
    private static readonly LEGACY_SALT = 'salt-trading-cossa';

    private static deriveV3Key(secret: string, salt: Buffer, kid: string): Buffer {
        const derived = hkdfSync(
            'sha256',
            Buffer.from(secret, 'utf8'),
            salt,
            Buffer.from(`${HKDF_INFO_PREFIX}${kid}`, 'utf8'),
            this.KEY_LENGTH,
        );
        return Buffer.from(derived);
    }

    /**
     * Encrypts text using non-blocking HKDF-SHA256 + AES-256-GCM (v3) with key version (`kid`)
     * and optional Additional Authenticated Data (`aad`) binding ciphertext to tenant/entity.
     * Format (v3): v3:<kid>:<saltB64Url>:<ivB64Url>:<tagB64Url>:<ciphertextB64Url>
     */
    static encrypt(
        text: string,
        secretOrKeyring: string | CryptoKeyring,
        options?: CryptoEncryptOptions,
    ): string {
        const kid =
            typeof secretOrKeyring === 'string'
                ? (options?.kid || 'k1').replace(/[^a-zA-Z0-9_-]/g, '') || 'k1'
                : secretOrKeyring.activeKid;
        const secret =
            typeof secretOrKeyring === 'string'
                ? secretOrKeyring
                : secretOrKeyring.keys[secretOrKeyring.activeKid];

        if (!secret) {
            throw new Error('Encryption key material is missing');
        }

        const salt = randomBytes(this.SALT_LENGTH);
        const iv = randomBytes(this.IV_LENGTH);
        const key = this.deriveV3Key(secret, salt, kid);
        const cipher = createCipheriv(this.ALGORITHM, key, iv);
        if (options?.aad) {
            cipher.setAAD(Buffer.from(options.aad, 'utf8'));
        }

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return [
            'v3',
            kid,
            salt.toString('base64url'),
            iv.toString('base64url'),
            tag.toString('base64url'),
            encrypted.toString('base64url'),
        ].join(':');
    }

    /**
     * Decrypts AES-256-GCM payloads seamlessly across:
     * - v3 (HKDF-SHA256 + kid + optional AAD)
     * - v2 (legacy per-message scryptSync)
     * - v1 / 3-part legacy format
     * Supports single secret string or multi-key CryptoKeyring for zero-downtime rotation.
     */
    static decrypt(
        encryptedData: string,
        secretOrKeyring: string | CryptoKeyring,
        options?: CryptoDecryptOptions,
    ): string {
        const parts = String(encryptedData || '').split(':');

        const candidateSecrets: string[] =
            typeof secretOrKeyring === 'string'
                ? [secretOrKeyring]
                : Object.values(secretOrKeyring.keys).filter(Boolean);

        if (candidateSecrets.length === 0) {
            throw new Error('Decryption key material is missing');
        }

        // Format v3: v3:<kid>:<salt>:<iv>:<tag>:<ct>
        if (parts[0] === 'v3' && parts.length === 6) {
            const [, kid, saltB64, ivB64, tagB64, ctB64] = parts;
            const salt = Buffer.from(saltB64, 'base64url');
            const iv = Buffer.from(ivB64, 'base64url');
            const tag = Buffer.from(tagB64, 'base64url');
            const encrypted = Buffer.from(ctB64, 'base64url');

            const orderedSecrets =
                typeof secretOrKeyring !== 'string' && secretOrKeyring.keys[kid]
                    ? [
                          secretOrKeyring.keys[kid],
                          ...candidateSecrets.filter((s) => s !== secretOrKeyring.keys[kid]),
                      ]
                    : candidateSecrets;

            let lastErr: unknown = null;
            for (const secret of orderedSecrets) {
                try {
                    const key = this.deriveV3Key(secret, salt, kid);
                    const decipher = createDecipheriv(this.ALGORITHM, key, iv);
                    if (options?.aad) {
                        decipher.setAAD(Buffer.from(options.aad, 'utf8'));
                    }
                    decipher.setAuthTag(tag);
                    return Buffer.concat([
                        decipher.update(encrypted),
                        decipher.final(),
                    ]).toString('utf8');
                } catch (err) {
                    lastErr = err;
                }
            }
            throw lastErr instanceof Error ? lastErr : new Error('Decryption failed');
        }

        // Format v2 (legacy scryptSync): v2:<saltHex>:<ivHex>:<tagHex>:<ctHex>
        if (parts[0] === 'v2' && parts.length === 5) {
            const [, saltHex, ivHex, tagHex, encryptedHex] = parts;
            const salt = Buffer.from(saltHex, 'hex');
            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');

            let lastErr: unknown = null;
            for (const secret of candidateSecrets) {
                try {
                    const key = scryptSync(secret, salt, this.KEY_LENGTH);
                    const decipher = createDecipheriv(this.ALGORITHM, key, iv);
                    decipher.setAuthTag(tag);
                    return Buffer.concat([
                        decipher.update(encrypted),
                        decipher.final(),
                    ]).toString('utf8');
                } catch (err) {
                    lastErr = err;
                }
            }
            throw lastErr instanceof Error ? lastErr : new Error('Decryption failed');
        }

        // Legacy 3-part format: <ivHex>:<tagHex>:<ctHex>
        if (parts.length === 3) {
            const [ivHex, tagHex, encryptedHex] = parts;
            if (!ivHex || !tagHex || !encryptedHex) {
                throw new Error('Invalid encrypted data format');
            }
            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');

            let lastErr: unknown = null;
            for (const secret of candidateSecrets) {
                try {
                    const key = scryptSync(secret, this.LEGACY_SALT, this.KEY_LENGTH);
                    const decipher = createDecipheriv(this.ALGORITHM, key, iv);
                    decipher.setAuthTag(tag);
                    return Buffer.concat([
                        decipher.update(encrypted),
                        decipher.final(),
                    ]).toString('utf8');
                } catch (err) {
                    lastErr = err;
                }
            }
            throw lastErr instanceof Error ? lastErr : new Error('Decryption failed');
        }

        throw new Error('Invalid encrypted data format');
    }

    /** Returns true if a stored ciphertext is not yet on v3 or activeKid (for lazy re-encryption). */
    static needsReencryption(encryptedData: string, activeKid = 'k1'): boolean {
        if (!encryptedData) return false;
        const parts = encryptedData.split(':');
        return parts[0] !== 'v3' || parts[1] !== activeKid;
    }
}
