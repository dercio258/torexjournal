import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { getServerKemPublicBundle } from './payload-envelope.util';
import { TurnstileService } from './turnstile.service';
import { CloudflareR2StorageService } from './cloudflare-r2-storage.service';
import {
    DigitalSignatureEnvelope,
    DigitalSignatureService,
} from './digital-signature.service';

export class VerifySignatureDto {
    @IsOptional()
    payload?: unknown;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    contentHashSha256?: string;

    @IsObject()
    signatureEnvelope: Partial<DigitalSignatureEnvelope>;
}

@Controller('security')
export class SecurityController {
    constructor(
        private readonly turnstileService: TurnstileService,
        private readonly r2Storage: CloudflareR2StorageService,
        private readonly digitalSignature: DigitalSignatureService,
    ) {}

    @Get('kem-key')
    @Throttle({ default: { limit: 60, ttl: 60000 } })
    @Header('Cache-Control', 'private, max-age=300')
    getKemPublicKey() {
        return getServerKemPublicBundle();
    }

    /**
     * Public, non-secret client security configuration (Cloudflare Turnstile site key,
     * active signing algorithm/key ID, storage mode). Safe for unauthenticated browsers.
     */
    @Get('public-config')
    @Throttle({ default: { limit: 90, ttl: 60000 } })
    @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
    getPublicSecurityConfig() {
        const turnstile = this.turnstileService.getPublicConfig();
        const signing = this.digitalSignature.getPublicKeyBundle();
        const storage = this.r2Storage.getStatus();
        return {
            turnstileEnabled: turnstile.enabled,
            turnstileSiteKey: turnstile.siteKey,
            signingAlg: signing.alg,
            signingKeyId: signing.kid,
            signingFingerprintSha256: signing.fingerprintSha256,
            storageProvider: storage.provider,
        };
    }

    /**
     * Publishes the active Ed25519 public key so external verifiers (prop firms, mentors,
     * auditors, or the web client) can independently verify Torex Journal digital signatures.
     */
    @Get('signing-key')
    @Throttle({ default: { limit: 60, ttl: 60000 } })
    @Header('Cache-Control', 'public, max-age=300')
    getSigningPublicKey() {
        return this.digitalSignature.getPublicKeyBundle();
    }

    /**
     * Cryptographically verifies any Torex Journal signed envelope (performance report,
     * admin audit checkpoint, or AI dataset export).
     */
    @Post('verify-signature')
    @Throttle({ default: { limit: 30, ttl: 60000 } })
    verifySignature(@Body() body: VerifySignatureDto) {
        return this.digitalSignature.verifySignedEnvelope({
            payload: body?.payload,
            contentHashSha256: body?.contentHashSha256,
            envelope: body?.signatureEnvelope,
        });
    }
}
