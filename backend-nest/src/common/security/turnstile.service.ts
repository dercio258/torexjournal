import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { RedisSecurityService } from './redis-security.service';

export interface TurnstilePublicConfig {
    enabled: boolean;
    siteKey: string | null;
}

export interface TurnstileVerifyResult {
    verified: boolean;
    bypassed?: boolean;
    hostname?: string;
    action?: string;
    challengeTs?: string;
    errorCodes?: string[];
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5_000;
const TURNSTILE_TOKEN_REPLAY_TTL_MS = 5 * 60 * 1000; // 5 minutes (Turnstile tokens expire after 300s)

@Injectable()
export class TurnstileService {
    private readonly logger = new Logger(TurnstileService.name);

    constructor(
        private readonly configService: ConfigService,
        @Optional() private readonly redisSecurity?: RedisSecurityService,
    ) {}

    private readEnv(key: string): string {
        return (this.configService?.get<string>(key) ?? process.env[key] ?? '').trim();
    }

    isEnabled(): boolean {
        const explicit = this.readEnv('TURNSTILE_ENABLED').toLowerCase();
        if (explicit === 'false' || explicit === '0' || explicit === 'off') {
            return false;
        }
        const secretKey = this.readEnv('TURNSTILE_SECRET_KEY');
        return secretKey.length > 0;
    }

    getPublicConfig(): TurnstilePublicConfig {
        const enabled = this.isEnabled();
        const siteKey = this.readEnv('TURNSTILE_SITE_KEY') || null;
        return {
            enabled: enabled && Boolean(siteKey),
            siteKey: enabled ? siteKey : null,
        };
    }

    /**
     * Verifies a Cloudflare Turnstile token against Cloudflare's Siteverify API.
     * - Automatically bypassed if TURNSTILE_SECRET_KEY is not yet configured (dev/pre-provisioning).
     * - Enforces single-use token anti-replay via Redis/in-memory store.
     * - Never invoke this on authenticated workspace routes or offline sync replay.
     */
    async verifyOrThrow(
        token: string | undefined | null,
        remoteIp?: string,
        expectedAction?: string,
    ): Promise<TurnstileVerifyResult> {
        if (!this.isEnabled()) {
            return { verified: true, bypassed: true };
        }

        const cleanToken = typeof token === 'string' ? token.trim() : '';
        const siteKey = this.readEnv('TURNSTILE_SITE_KEY');
        const explicitEnabled = this.readEnv('TURNSTILE_ENABLED').toLowerCase() === 'true';

        // If TURNSTILE_SECRET_KEY is configured without TURNSTILE_SITE_KEY, getPublicConfig()
        // tells the frontend `turnstileEnabled: false`, so browsers will not render a widget
        // or send a token. Avoid locking out login flows due to partial env provisioning.
        if (!cleanToken && !siteKey && !explicitEnabled) {
            this.logger.warn(
                `Turnstile bypassed (action=${expectedAction || 'any'}): TURNSTILE_SECRET_KEY is set without TURNSTILE_SITE_KEY.`,
            );
            return { verified: true, bypassed: true };
        }

        if (!cleanToken || cleanToken.length < 10 || cleanToken.length > 4096) {
            throw new BadRequestException(
                'Verificação de segurança anti-bot obrigatória. Complete o desafio Cloudflare e tente novamente.',
            );
        }

        // Single-use replay protection: reject duplicate submission of an already-verified Turnstile token
        const tokenHash = createHash('sha256').update(cleanToken, 'utf8').digest('hex');
        if (this.redisSecurity) {
            const fresh = await this.redisSecurity.setIfAbsent(
                `turnstile_tok:${tokenHash}`,
                '1',
                TURNSTILE_TOKEN_REPLAY_TTL_MS,
            );
            if (!fresh) {
                throw new BadRequestException(
                    'O desafio de segurança já foi utilizado ou expirou. Atualize e tente novamente.',
                );
            }
        }

        const secretKey = this.readEnv('TURNSTILE_SECRET_KEY');
        const idempotencyKey = randomUUID();
        const formBody = new URLSearchParams();
        formBody.set('secret', secretKey);
        formBody.set('response', cleanToken);
        formBody.set('idempotency_key', idempotencyKey);
        if (remoteIp && remoteIp !== 'unknown_ip') {
            formBody.set('remoteip', remoteIp);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

        try {
            const response = await fetch(TURNSTILE_VERIFY_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formBody.toString(),
                signal: controller.signal,
            });

            if (!response.ok) {
                this.logger.warn(
                    `Cloudflare Turnstile siteverify HTTP ${response.status} (action=${expectedAction || 'any'})`,
                );
                throw new BadRequestException(
                    'Não foi possível validar a verificação anti-bot neste momento. Tente novamente em instantes.',
                );
            }

            const data = (await response.json()) as {
                success?: boolean;
                hostname?: string;
                action?: string;
                challenge_ts?: string;
                'error-codes'?: string[];
            };

            if (!data?.success) {
                const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];
                this.logger.warn(
                    `Turnstile verification failed (action=${expectedAction || 'any'}, codes=${codes.join(',')})`,
                );
                throw new BadRequestException(
                    'Verificação de segurança inválida ou expirada. Complete o desafio novamente.',
                );
            }

            // Optional strict hostname validation in production
            const allowedHostnamesRaw = this.readEnv('TURNSTILE_ALLOWED_HOSTNAMES');
            if (allowedHostnamesRaw && data.hostname) {
                const allowed = allowedHostnamesRaw
                    .split(',')
                    .map((h) => h.trim().toLowerCase())
                    .filter(Boolean);
                if (allowed.length > 0 && !allowed.includes(data.hostname.toLowerCase())) {
                    this.logger.warn(`Turnstile hostname mismatch: received=${data.hostname}`);
                    throw new BadRequestException(
                        'Origem da verificação de segurança não autorizada.',
                    );
                }
            }

            if (
                expectedAction &&
                data.action &&
                data.action.toLowerCase() !== expectedAction.toLowerCase()
            ) {
                this.logger.warn(
                    `Turnstile action mismatch: expected=${expectedAction}, got=${data.action}`,
                );
                throw new BadRequestException(
                    'Verificação de segurança incompatível com esta ação. Tente novamente.',
                );
            }

            return {
                verified: true,
                hostname: data.hostname,
                action: data.action,
                challengeTs: data.challenge_ts,
            };
        } catch (err: any) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            this.logger.warn(
                `Turnstile siteverify network error (${err?.name || 'Error'}): ${err?.message || 'timeout'}`,
            );
            throw new BadRequestException(
                'Não foi possível contactar o serviço de verificação de segurança. Verifique sua ligação e tente novamente.',
            );
        } finally {
            clearTimeout(timer);
        }
    }
}
