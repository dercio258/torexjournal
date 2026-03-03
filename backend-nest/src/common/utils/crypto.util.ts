import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export class CryptoUtil {
    private static readonly ALGORITHM = 'aes-256-gcm';
    private static readonly IV_LENGTH = 12;
    private static readonly TAG_LENGTH = 16;
    private static readonly KEY_LENGTH = 32;

    /**
     * Encrypts text using AES-256-GCM
     * @param text The text to encrypt
     * @param secret The encryption secret (must be 32 bytes or will be hashed)
     */
    static encrypt(text: string, secret: string): string {
        const iv = randomBytes(this.IV_LENGTH);
        const key = this.deriveKey(secret);
        const cipher = createCipheriv(this.ALGORITHM, key, iv);

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        // Format: iv:tag:encrypted (all in hex)
        return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    /**
     * Decrypts text using AES-256-GCM
     * @param encryptedData The encrypted string (iv:tag:encrypted format)
     * @param secret The encryption secret
     */
    static decrypt(encryptedData: string, secret: string): string {
        const [ivHex, tagHex, encryptedHex] = encryptedData.split(':');

        if (!ivHex || !tagHex || !encryptedHex) {
            throw new Error('Invalid encrypted data format');
        }

        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');
        const key = this.deriveKey(secret);

        const decipher = createDecipheriv(this.ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        return decipher.update(encrypted) + decipher.final('utf8');
    }

    private static deriveKey(secret: string): Buffer {
        // Simple derivation to ensure 32 bytes. In prod, use a more robust KDF if secret isn't already 32 bytes.
        return scryptSync(secret, 'salt-trading-cossa', this.KEY_LENGTH);
    }
}
