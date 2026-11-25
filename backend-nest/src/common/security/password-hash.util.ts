import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcryptjs';

const SCRYPT_PREFIX = '$scrypt$v1$';
const SCRYPT_N = 16384; // 2^14 cost factor (~16MB memory-hard, fast enough for interactive logins)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptAsync(
    password: string,
    salt: Buffer,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey as Buffer);
        });
    });
}

/**
 * Hashes passwords with Node's native memory-hard scrypt KDF (`$scrypt$v1$N$r$p$salt$hash`),
 * avoiding native C++ node-gyp build issues while upgrading beyond legacy 72-byte bcrypt limits.
 */
export async function hashPasswordSecure(plainPassword: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(plainPassword, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 64 * 1024 * 1024,
    });
    return `${SCRYPT_PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

/**
 * Verifies a plaintext password against either the new `$scrypt$v1$...` format
 * or legacy `$2a$` / `$2b$` bcrypt hashes.
 */
export async function verifyPasswordSecure(
    plainPassword: string,
    storedHash: string | null | undefined,
): Promise<boolean> {
    if (!plainPassword || !storedHash || typeof storedHash !== 'string') {
        return false;
    }

    if (storedHash.startsWith(SCRYPT_PREFIX)) {
        const parts = storedHash.slice(SCRYPT_PREFIX.length).split('$');
        if (parts.length !== 5) return false;
        const [nStr, rStr, pStr, saltB64, hashB64] = parts;
        const N = Number(nStr);
        const r = Number(rStr);
        const p = Number(pStr);
        if (
            !Number.isInteger(N) ||
            !Number.isInteger(r) ||
            !Number.isInteger(p) ||
            N < 1024 ||
            N > 131072 ||
            r < 1 ||
            r > 32 ||
            p < 1 ||
            p > 16
        ) {
            return false;
        }
        try {
            const salt = Buffer.from(saltB64, 'base64url');
            const expected = Buffer.from(hashB64, 'base64url');
            if (salt.length < 8 || expected.length < 32) return false;
            const derived = await scryptAsync(plainPassword, salt, expected.length, {
                N,
                r,
                p,
                maxmem: 128 * 1024 * 1024,
            });
            return derived.length === expected.length && timingSafeEqual(derived, expected);
        } catch {
            return false;
        }
    }

    // Legacy bcrypt fallback ($2a$, $2b$, $2y$)
    try {
        return await bcrypt.compare(plainPassword, storedHash);
    } catch {
        return false;
    }
}

/**
 * Returns true when an existing password hash uses legacy bcrypt and should be
 * transparently rehashed to memory-hard `$scrypt$v1$` on next successful login.
 */
export function needsPasswordRehash(storedHash: string | null | undefined): boolean {
    if (!storedHash || typeof storedHash !== 'string') return false;
    return !storedHash.startsWith(SCRYPT_PREFIX);
}
