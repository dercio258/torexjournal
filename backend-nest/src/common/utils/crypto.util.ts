import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export class CryptoUtil {
    private static readonly ALGORITHM = 'aes-256-gcm';
    private static readonly IV_LENGTH = 12;
    private static readonly SALT_LENGTH = 16;
    private static readonly KEY_LENGTH = 32;
    private static readonly LEGACY_SALT = 'salt-trading-cossa';

    /**
     * Encrypts text using AES-256-GCM with a per-payload random salt.
     * Format (v2): v2:saltHex:ivHex:tagHex:encryptedHex
     */
    static encrypt(text: string, secret: string): string {
        const salt = randomBytes(this.SALT_LENGTH);
        const iv = randomBytes(this.IV_LENGTH);
        const key = scryptSync(secret, salt, this.KEY_LENGTH);
        const cipher = createCipheriv(this.ALGORITHM, key, iv);

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return `v2:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    /**
     * Decrypts AES-256-GCM payloads (supports both v2 per-message salt and legacy 3-part format).
     */
    static decrypt(encryptedData: string, secret: string): string {
        const parts = encryptedData.split(':');

        if (parts[0] === 'v2' && parts.length === 5) {
            const [, saltHex, ivHex, tagHex, encryptedHex] = parts;
            const salt = Buffer.from(saltHex, 'hex');
            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');
            const key = scryptSync(secret, salt, this.KEY_LENGTH);

            const decipher = createDecipheriv(this.ALGORITHM, key, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
        }

        if (parts.length === 3) {
            const [ivHex, tagHex, encryptedHex] = parts;
            if (!ivHex || !tagHex || !encryptedHex) {
                throw new Error('Invalid encrypted data format');
            }

            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');
            const key = scryptSync(secret, this.LEGACY_SALT, this.KEY_LENGTH);

            const decipher = createDecipheriv(this.ALGORITHM, key, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
        }

        throw new Error('Invalid encrypted data format');
    }
}
