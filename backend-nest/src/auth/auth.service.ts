import {
    Injectable,
    Logger,
    UnauthorizedException,
    ConflictException,
    NotFoundException,
    HttpException,
    HttpStatus,
    Inject,
    BadRequestException,
    Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CryptoUtil } from '../common/utils/crypto.util';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import {
    hashPasswordSecure,
    needsPasswordRehash,
    verifyPasswordSecure,
} from '../common/security/password-hash.util';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity } from '../account/account.entity';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EmailProducerService } from '../email/email-producer.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateName, EmailTemplatePayloadMap, resolveFrontendUrl } from '../email/templates';
import { PlanPermissionService } from '../payment/plan-permission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from './audit-log.service';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as qrcode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { SessionEntity } from './session.entity';
import { RedisSecurityService } from '../common/security/redis-security.service';
import {
    buildSessionCacheKey,
    getJwtSecret,
    getPasswordResetSecret,
    getTwoFactorEncryptionKeyring,
    getTwoFactorJwtSecret,
    timingSafeEqualStr,
} from '../common/security/security.config';
import {
    resolveCountryFromHeadersOrTimezone,
    validateAndNormalizeContact,
} from './phone-prefix.util';
import { resolveAcquisitionFields, sanitizeAttributionPayload } from '../users/users.service';
import { ReferralService } from '../users/referral.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { RegisterInitiateDto } from './dto/auth.dto';
import {
    assertAllowedRegistrationEmail,
    assertStrongPassword,
} from './registration-security.util';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        @InjectRepository(AccountEntity)
        private accountRepository: Repository<AccountEntity>,
        @InjectRepository(SessionEntity)
        private sessionRepository: Repository<SessionEntity>,
        private emailProducer: EmailProducerService,
        @Inject(CACHE_MANAGER) private cacheManager: any,
        private planPermissionService: PlanPermissionService,
        private notificationsService: NotificationsService,
        private auditLogService: AuditLogService,
        private configService: ConfigService,
        private redisSecurity: RedisSecurityService,
        @Optional() private analyticsService?: AnalyticsService,
        @Optional() private referralService?: ReferralService,
        @Optional() private eventEmitter?: EventEmitter2,
        @Optional() private emailService?: EmailService,
    ) {}

    private isUserEmailVerified(user: any): boolean {
        if (!user) return false;
        return Boolean(
            user.emailVerifiedAt ||
                user.googleId ||
                user.githubId ||
                user.isTwoFactorConfirmed,
        );
    }

    private async dispatchEmailWithFallback<K extends EmailTemplateName>(
        to: string,
        template: K,
        data: EmailTemplatePayloadMap[K],
        options: { jobId?: string } = {},
    ): Promise<boolean> {
        const queued = await this.emailProducer
            .enqueue(to, template, data, options)
            .catch(() => false);
        if (queued) {
            return true;
        }
        if (this.emailService) {
            try {
                const sent = await this.emailService.sendTemplatedEmail(to, template, data, {
                    throwOnError: false,
                });
                if (sent) return true;
            } catch (err: any) {
                this.logger.warn(
                    `Direct fallback email failed (${template} -> ${to}): ${err?.message || err}`,
                );
            }
        }
        return false;
    }

    private extractReferralCodeFromInput(
        explicitCode?: unknown,
        attributionData?: any,
    ): string | undefined {
        const candidates = [
            explicitCode,
            attributionData?.referralCode,
            attributionData?.ref,
        ];
        for (const c of candidates) {
            if (typeof c === 'string' && c.trim()) {
                return c.trim();
            }
        }
        return undefined;
    }

    private async issueEmailVerificationSession(
        user: { id: string; email: string; name?: string | null },
        options: { forceResend?: boolean; cooldownMs?: number } = {},
    ): Promise<{
        verificationToken: string;
        emailMasked: string;
        expiresInSeconds: number;
        codeSent: boolean;
    }> {
        const userId = String(user.id);
        const normalizedEmail = this.normalizeEmail(user.email);
        const acctVerifyKey = `acct_verify:${userId}`;
        const cooldownKey = `email_verify_cooldown:${userId}`;
        const emailMasked = this.maskEmailForVerification(normalizedEmail);

        const inCooldown = await this.redisSecurity.getValue(cooldownKey);
        if (options.forceResend && inCooldown) {
            throw new HttpException(
                'Aguarde 60 segundos antes de reenviar o código.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        if (!options.forceResend && inCooldown) {
            const existingRaw = await this.redisSecurity.getValue(acctVerifyKey);
            if (existingRaw) {
                try {
                    const existing = JSON.parse(existingRaw);
                    if (existing?.verificationId && existing?.codeHash) {
                        const verificationToken = this.jwtService.sign(
                            {
                                verificationId: String(existing.verificationId),
                                userId,
                                email: normalizedEmail,
                                purpose: 'account_verify',
                            },
                            { secret: getTwoFactorJwtSecret(this.configService), expiresIn: '24h' },
                        );
                        return {
                            verificationToken,
                            emailMasked,
                            expiresInSeconds: 900,
                            codeSent: false,
                        };
                    }
                } catch {
                    // Fall through to issue a fresh OTP if cached record is malformed
                }
            }
        }

        const otp = this.generateOtp();
        const verificationId = crypto.randomUUID();
        await this.redisSecurity.setValue(
            acctVerifyKey,
            JSON.stringify({
                verificationId,
                userId,
                email: normalizedEmail,
                codeHash: this.sha256(otp),
                createdAt: Date.now(),
            }),
            15 * 60 * 1000,
        );
        await this.redisSecurity.deleteKey(`reg_verify_fail:${userId}`);
        await this.redisSecurity.setValue(cooldownKey, '1', options.cooldownMs ?? 45 * 1000);

        const codeSent = await this.dispatchEmailWithFallback(normalizedEmail, 'OTP_CODE', {
            otp,
            userName: user.name || undefined,
            expiresInMinutes: 15,
            purpose: 'REGISTRATION',
        });

        const verificationToken = this.jwtService.sign(
            { verificationId, userId, email: normalizedEmail, purpose: 'account_verify' },
            { secret: getTwoFactorJwtSecret(this.configService), expiresIn: '24h' },
        );

        return {
            verificationToken,
            emailMasked,
            expiresInSeconds: 900,
            codeSent,
        };
    }

    private async completeVerifiedSignupSideEffects(
        user: any,
        options: {
            explicitReferralCode?: string;
            attributionData?: any;
            visitorId?: string | null;
            method?: string;
        } = {},
    ) {
        const existingAccount = await this.accountRepository.findOne({
            where: { userId: user.id },
        });
        if (!existingAccount) {
            await this.createDefaultAccount(user.id);
        }

        const attr = options.attributionData ?? user.attributionData;
        const visId = options.visitorId ?? user.visitorId;
        if (visId) {
            void this.analyticsService?.identifyVisitor(user.id, visId, attr);
        }
        void this.analyticsService?.recordAuthOrBillingConversion({
            eventName: 'signup',
            userId: user.id,
            email: user.email,
            visitorId: visId,
            attributionData: attr,
            metadata: { method: options.method || 'email_otp_two_step' },
        });

        await this.auditLogService.log(user.id, 'USER_REGISTERED', { email: user.email });

        const pendingRef = await this.redisSecurity.consumeOnce(`reg_pending_ref:${user.id}`);
        const refCode =
            pendingRef ||
            this.extractReferralCodeFromInput(options.explicitReferralCode, attr);
        if (refCode) {
            await this.referralService
                ?.processVerifiedSignup(user.id, String(refCode))
                .catch(() => {});
        }
        await this.referralService?.ensureReferralCode(user.id).catch(() => {});

        await this.dispatchEmailWithFallback(
            user.email,
            'WELCOME_EMAIL',
            { userName: user.name || undefined },
            { jobId: `welcome:${user.id}` },
        );
    }

    private sha256(value: string): string {
        return crypto.createHash('sha256').update(value).digest('hex');
    }

    private normalizeEmail(email: string): string {
        return (email || '').trim().toLowerCase();
    }

    private generateOtp(): string {
        return crypto.randomInt(100000, 1000000).toString();
    }

    private buildPasswordRecoveryUrl(email: string, token: string, sig: string): string {
        const frontendBase = resolveFrontendUrl(this.configService.get<string>('FRONTEND_URL'));
        return `${frontendBase}/forgot-password?recover=true&email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&sig=${sig}`;
    }

    async validateUser(email: string, pass: string): Promise<any> {
        const user = await this.usersService.findOneByEmail(this.normalizeEmail(email));
        if (user && user.passwordHash && (await verifyPasswordSecure(pass, user.passwordHash))) {
            const { passwordHash, ...result } = user;
            return result;
        }
        return null;
    }

    async authenticateAndLogin(email: string, pass: string, ip?: string, userAgent?: string) {
        const normalizedEmail = this.normalizeEmail(email);
        if (!normalizedEmail || !pass) {
            throw new BadRequestException('E-mail e senha são obrigatórios');
        }

        const user = await this.usersService.findOneByEmail(normalizedEmail);
        if (user && user.isBlocked) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.FORBIDDEN,
                    message:
                        'Esta conta foi bloqueada devido a 9 tentativas falhas de login. Por favor, utilize o link de recuperação enviado ao seu e-mail para redefinir sua senha.',
                    error: 'Blocked Account',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        const lockoutKey = `login_lockout:${normalizedEmail}`;
        const lockoutType = await this.redisSecurity.getValue(lockoutKey);
        if (lockoutType) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message:
                        'Múltiplas tentativas falhas. Acesso temporariamente bloqueado. Por favor, aguarde.',
                    error: 'Too Many Requests',
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const isPasswordCorrect =
            user && user.passwordHash && (await verifyPasswordSecure(pass, user.passwordHash));

        // Transparent lazy upgrade from legacy bcrypt to memory-hard $scrypt$v1$
        if (isPasswordCorrect && user && needsPasswordRehash(user.passwordHash)) {
            try {
                user.passwordHash = await hashPasswordSecure(pass);
                await this.usersService.update(user);
            } catch {
                // Non-blocking transparent hash upgrade
            }
        }

        if (!isPasswordCorrect) {
            const failureKey = `login_failures:${normalizedEmail}`;
            const { count: failures } = await this.redisSecurity.incrementWithWindow(failureKey, 86400000);

            if (failures >= 9) {
                if (user) {
                    user.isBlocked = true;
                    await this.usersService.update(user);

                    const recoveryCode = this.generateOtp();
                    const resetId = crypto.randomUUID();
                    const rawPayload = JSON.stringify({
                        email: user.email,
                        code: recoveryCode,
                        resetId,
                        timestamp: Date.now(),
                    });
                    const secret = getPasswordResetSecret(this.configService);
                    const token = CryptoUtil.encrypt(rawPayload, secret);
                    const sig = crypto.createHmac('sha256', secret).update(token).digest('hex');

                    await this.redisSecurity.setValue(
                        `pwd_reset:${normalizedEmail}`,
                        JSON.stringify({ codeHash: this.sha256(recoveryCode), resetId }),
                        15 * 60 * 1000,
                    );

                    await this.emailProducer.enqueue(user.email, 'ACCOUNT_LOCKED', {
                        userName: user.name || undefined,
                        code: recoveryCode,
                        unlockUrl: this.buildPasswordRecoveryUrl(user.email, token, sig),
                        failedAttempts: 9,
                        expiresInMinutes: 15,
                    });
                }
                await this.redisSecurity.deleteKey(failureKey);
                throw new HttpException(
                    {
                        statusCode: HttpStatus.FORBIDDEN,
                        message:
                            'Sua conta foi bloqueada devido a 9 tentativas falhas de login. Um código de recuperação foi enviado para seu e-mail.',
                        error: 'Account Blocked',
                    },
                    HttpStatus.FORBIDDEN,
                );
            } else if (failures === 6) {
                await this.redisSecurity.setValue(lockoutKey, '6_attempts', 300000);
                throw new HttpException(
                    {
                        statusCode: HttpStatus.TOO_MANY_REQUESTS,
                        message:
                            'Credenciais inválidas. Cooldown de 5 minutos ativado devido a 6 tentativas falhas.',
                        error: 'Too Many Requests',
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            } else if (failures === 3) {
                await this.redisSecurity.setValue(lockoutKey, '3_attempts', 15000);
                throw new HttpException(
                    {
                        statusCode: HttpStatus.TOO_MANY_REQUESTS,
                        message:
                            'Credenciais inválidas. Cooldown de 15 segundos ativado devido a 3 tentativas falhas.',
                        error: 'Too Many Requests',
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            } else {
                throw new UnauthorizedException(
                    `Credenciais inválidas. Tentativa ${failures} de 9.`,
                );
            }
        }

        await this.redisSecurity.deleteKey(`login_failures:${normalizedEmail}`);
        await this.redisSecurity.deleteKey(lockoutKey);

        const { passwordHash, ...result } = user;
        return this.login(result, ip, userAgent);
    }

    async login(user: any, ip?: string, userAgent?: string) {
        if (!this.isUserEmailVerified(user)) {
            const verifySession = await this.issueEmailVerificationSession(user);
            await this.auditLogService.log(
                user.id,
                'LOGIN_EMAIL_VERIFICATION_REQUIRED',
                { email: user.email, codeSent: verifySession.codeSent, ip, userAgent },
                ip,
                userAgent,
            );
            return {
                success: true,
                requiresEmailVerification: true,
                verificationToken: verifySession.verificationToken,
                emailMasked: verifySession.emailMasked,
                expiresInSeconds: verifySession.expiresInSeconds,
                codeSent: verifySession.codeSent,
                message: verifySession.codeSent
                    ? 'Seu e-mail ainda não foi verificado. Enviámos um código de verificação para o seu e-mail.'
                    : 'Seu e-mail ainda não foi verificado. Utilize o código de verificação enviado recentemente.',
            };
        }

        let updated = false;
        if (!user.emailVerifiedAt) {
            user.emailVerifiedAt = user.createdAt || new Date();
            updated = true;
        }
        if (!user.apiToken) {
            user.apiToken = crypto.randomUUID().toUpperCase();
            updated = true;
        }

        const existingAccount = await this.accountRepository.findOne({
            where: { userId: user.id },
        });
        if (!existingAccount) {
            await this.createDefaultAccount(user.id);
        }

        if (updated) {
            await this.usersService.update(user);
        }

        // --- 2FA INTERCEPTION ---
        if (user.twoFactorEnabled) {
            return this.buildTwoFactorChallenge(user, ip, userAgent);
        }

        return this.generateAuthResponse(user, ip, userAgent, false);
    }

    private async buildTwoFactorChallenge(
        user: any,
        ip?: string,
        userAgent?: string,
    ): Promise<{
        success: boolean;
        twoFactorRequired: boolean;
        twoFactorType: 'TOTP' | 'EMAIL';
        twoFactorToken: string;
        message?: string;
    }> {
        const isTotp = Boolean(user.isTwoFactorConfirmed);
        const twoFactorType: 'TOTP' | 'EMAIL' = isTotp ? 'TOTP' : 'EMAIL';
        const requestLimitKey = `2fa_code_request_limit:${user.id}`;

        await this.auditLogService.log(
            user.id,
            isTotp ? 'LOGIN_2FA_REQUIRED' : 'LOGIN_2FA_REQUIRED_EMAIL',
            { ip, userAgent },
            ip,
            userAgent,
        );

        const temporaryToken = this.jwtService.sign(
            { id: user.id, email: user.email, isTwoFactorPending: true },
            { secret: getTwoFactorJwtSecret(this.configService), expiresIn: '5m' },
        );

        const isLimitActive = await this.redisSecurity.getValue(requestLimitKey);
        if (isLimitActive) {
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorType,
                twoFactorToken: temporaryToken,
                message:
                    'Um código de verificação já foi enviado recentemente. Use o código ativo ou aguarde 5 minutos.',
            };
        }

        const otp = this.generateOtp();
        await this.redisSecurity.setValue(`2FA:${user.id}`, otp, 300000); // 5 mins
        await this.redisSecurity.setValue(requestLimitKey, '1', 300000);

        if (user.email) {
            await this.emailProducer.enqueue(user.email, 'OTP_CODE', {
                otp,
                userName: user.name || undefined,
                expiresInMinutes: 5,
                purpose: 'TWO_FACTOR',
            });
        }

        return {
            success: true,
            twoFactorRequired: true,
            twoFactorType,
            twoFactorToken: temporaryToken,
        };
    }

    private issueRefreshToken(ttlDays: number = 30): string {
        const expiresAtMs = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
        const entropy = crypto.randomBytes(24).toString('hex');
        return `rt2.${expiresAtMs.toString(36)}.${entropy}`;
    }

    private isRefreshTokenExpired(refreshToken: string): boolean {
        if (!refreshToken || !refreshToken.startsWith('rt2.')) {
            return false;
        }
        const parts = refreshToken.split('.');
        if (parts.length !== 3) return true;
        const expiresAtMs = parseInt(parts[1], 36);
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return true;
        return Date.now() > expiresAtMs;
    }

    private async generateAuthResponse(
        user: any,
        ip?: string,
        userAgent?: string,
        isTwoFactorVerified = false,
        options: { skipLoginAlert?: boolean } = {},
    ) {
        const jti = crypto.randomUUID();
        const payload = { email: user.email, id: user.id, jti, isTwoFactorVerified };
        const accessToken = this.jwtService.sign(payload);
        const refreshToken = this.issueRefreshToken(30);

        await this.usersService.updateRefreshToken(user.id, refreshToken);

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await this.sessionRepository.save({
            userId: user.id,
            token: accessToken,
            userAgent,
            ipAddress: ip,
            expiresAt,
            isActive: true,
        });

        await this.cacheManager.set(buildSessionCacheKey(accessToken), 'active', 24 * 60 * 60 * 1000);

        await this.auditLogService.log(
            user.id,
            'LOGIN_SUCCESS',
            { ip, userAgent },
            ip,
            userAgent,
        );

        void this.usersService.recordUserActivity(user.id, {
            actionType: 'login',
            label: options.skipLoginAlert ? 'Acessou após cadastro' : 'Entrou na plataforma',
            pagePath: '/dashboard',
            isLogin: true,
        });

        // Dispatch Login Alert via Redis (skipped on JWT refresh / registration, deduplicated per IP for 6h)
        if (!options.skipLoginAlert && user.email) {
            void this.analyticsService?.recordAuthOrBillingConversion({
                eventName: 'login',
                userId: user.id,
                email: user.email,
                visitorId: user.visitorId,
                attributionData: user.attributionData,
                metadata: { ip: ip || null },
            });
            const cleanIp = ip || 'Não identificado';
            const dedupKey = `login_alert_dedup:${user.id}:${cleanIp}`;
            const recentlyAlerted = await this.cacheManager.get(dedupKey).catch(() => null);
            if (!recentlyAlerted) {
                await this.cacheManager.set(dedupKey, true, 6 * 60 * 60 * 1000).catch(() => {});
                await this.emailProducer.enqueue(user.email, 'LOGIN_ALERT', {
                    userName: user.name || undefined,
                    ip: cleanIp,
                    device: userAgent || 'Navegador Web',
                    time: new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' }),
                });
            }
        }

        const planTier = await this.planPermissionService.getUserPlan(user.id);

        return {
            success: true,
            message: 'Login successful',
            token: accessToken,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                emailVerified: true,
                api_token: user.apiToken,
                tier: planTier,
                onboardingCompleted: user.onboardingCompleted,
            },
        };
    }

    private async revokeJwtJtiIfPresent(token?: string | null): Promise<void> {
        if (!token) return;
        try {
            const decoded: any = this.jwtService.decode(token);
            if (decoded?.jti) {
                const expMs = typeof decoded.exp === 'number' ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000;
                const ttlMs = Math.max(60_000, expMs - Date.now());
                await this.redisSecurity.setValue(`jwt_revoked:${decoded.jti}`, '1', ttlMs);
            }
        } catch {
            // ignore malformed token decode
        }
    }

    private async revokeAllUserSessions(userId: string, reason: string): Promise<void> {
        const activeSessions = await this.sessionRepository.find({
            where: { userId, isActive: true },
            select: ['id', 'token'],
        });
        if (activeSessions.length > 0) {
            await this.sessionRepository.update({ userId, isActive: true }, { isActive: false });
            await Promise.all(
                activeSessions.flatMap((s) => [
                    this.cacheManager.del(buildSessionCacheKey(s.token)).catch(() => {}),
                    this.cacheManager.del(`user_session:${s.token}`).catch(() => {}),
                    this.revokeJwtJtiIfPresent(s.token),
                ]),
            );
        }
        await this.usersService.updateRefreshToken(userId, null);
        this.eventEmitter?.emit('security.revoke_user', { userId, reason });
    }

    async logout(token: string, userId?: string) {
        let resolvedUserId = userId;
        if (token) {
            if (!resolvedUserId) {
                const session = await this.sessionRepository.findOne({
                    where: { token },
                    select: ['id', 'userId'],
                });
                resolvedUserId = session?.userId;
            }
            await this.sessionRepository.update({ token }, { isActive: false });
            await Promise.all([
                this.cacheManager.del(buildSessionCacheKey(token)).catch(() => {}),
                this.cacheManager.del(`user_session:${token}`).catch(() => {}),
                this.revokeJwtJtiIfPresent(token),
            ]);
        }
        if (resolvedUserId) {
            await this.usersService.updateRefreshToken(resolvedUserId, null);
            this.eventEmitter?.emit('security.revoke_user', {
                userId: resolvedUserId,
                reason: 'logout',
            });
        }
    }

    async refresh(refreshToken: string, ip?: string, userAgent?: string) {
        if (!refreshToken) {
            throw new UnauthorizedException('Token de atualização ausente');
        }
        if (this.isRefreshTokenExpired(refreshToken)) {
            throw new UnauthorizedException('Token de atualização expirado. Faça login novamente.');
        }

        const rtHash = this.sha256(refreshToken);
        const usedOwnerId = await this.redisSecurity.getValue(`rt_used:${rtHash}`);
        if (usedOwnerId) {
            // Refresh token replay/reuse detected: immediately revoke ALL sessions for this user!
            await this.revokeAllUserSessions(usedOwnerId, 'refresh_token_reuse');
            await this.auditLogService.log(
                usedOwnerId,
                'REFRESH_TOKEN_REUSE_DETECTED',
                { tokenHashPrefix: rtHash.slice(0, 12), ip, userAgent },
                ip,
                userAgent,
            );
            throw new UnauthorizedException(
                'Sessão encerrada por segurança. Por favor, inicie sessão novamente.',
            );
        }

        const user = await this.usersService.findOneByRefreshToken(refreshToken);
        if (!user) {
            await this.auditLogService.log(
                null,
                'REFRESH_TOKEN_INVALID',
                { tokenHashPrefix: rtHash.slice(0, 12), ip, userAgent },
                ip,
                userAgent,
            );
            throw new UnauthorizedException('Token de atualização inválido');
        }

        if (user.isBlocked) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.FORBIDDEN,
                    message: 'Acesso bloqueado. Por favor, recupere sua conta.',
                    error: 'Blocked Account',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        if (!this.isUserEmailVerified(user)) {
            throw new UnauthorizedException(
                'Verifique o seu e-mail antes de continuar.',
            );
        }

        // Mark rotated refresh token as consumed for 7 days to detect replay/theft
        await this.redisSecurity.setValue(`rt_used:${rtHash}`, user.id, 7 * 24 * 60 * 60 * 1000);

        await this.auditLogService.log(
            user.id,
            'REFRESH_TOKEN_SUCCESS',
            { ip, userAgent },
            ip,
            userAgent,
        );
        return this.generateAuthResponse(
            user,
            ip,
            userAgent,
            Boolean(user.twoFactorEnabled),
            { skipLoginAlert: true },
        );
    }

    async sendOtp(email: string) {
        const normalizedEmail = this.normalizeEmail(email);
        await assertAllowedRegistrationEmail(normalizedEmail);
        const existingUser = await this.usersService.findOneByEmail(normalizedEmail);
        if (existingUser && this.isUserEmailVerified(existingUser)) {
            throw new ConflictException('Email already registered');
        }

        const cooldownKey = `otp_send_cooldown:${normalizedEmail}`;
        const inCooldown = await this.redisSecurity.getValue(cooldownKey);
        if (inCooldown) {
            throw new HttpException(
                'Aguarde 60 segundos antes de solicitar um novo código de verificação.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const otp = this.generateOtp();
        await this.redisSecurity.setValue(`OTP:${normalizedEmail}`, otp, 600000); // 10 minutes
        await this.redisSecurity.setValue(cooldownKey, '1', 60000);
        await this.redisSecurity.deleteKey(`otp_reg_fail:${normalizedEmail}`);

        await this.dispatchEmailWithFallback(normalizedEmail, 'OTP_CODE', {
            otp,
            expiresInMinutes: 10,
            purpose: 'REGISTRATION',
        });

        return { success: true, message: 'OTP sent successfully' };
    }

    async forgotPassword(email: string) {
        const normalizedEmail = this.normalizeEmail(email);
        const user = await this.usersService.findOneByEmail(normalizedEmail);

        // Uniform response prevents user/email enumeration
        const genericResponse = {
            success: true,
            message: 'Se o e-mail estiver registado, enviaremos um código de recuperação.',
        };

        if (!user) {
            return genericResponse;
        }

        const requestLimitKey = `forgot_password_request_limit:${normalizedEmail}`;
        const isLimited = await this.redisSecurity.getValue(requestLimitKey);
        if (isLimited) {
            throw new HttpException(
                'Um código de verificação já foi enviado recentemente. Por favor, aguarde 5 minutos antes de solicitar um novo.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const code = this.generateOtp();
        const resetId = crypto.randomUUID();
        const rawPayload = JSON.stringify({
            email: normalizedEmail,
            code,
            resetId,
            timestamp: Date.now(),
        });
        const secret = getPasswordResetSecret(this.configService);
        const token = CryptoUtil.encrypt(rawPayload, secret);
        const sig = crypto.createHmac('sha256', secret).update(token).digest('hex');

        await this.redisSecurity.setValue(
            `pwd_reset:${normalizedEmail}`,
            JSON.stringify({ codeHash: this.sha256(code), resetId }),
            15 * 60 * 1000,
        );
        await this.redisSecurity.deleteKey(`forgot_password_attempts:${normalizedEmail}`);
        await this.redisSecurity.setValue(requestLimitKey, '1', 300000); // 5 mins

        await this.emailProducer.enqueue(user.email, 'PASSWORD_RECOVERY', {
            userName: user.name || undefined,
            code,
            resetUrl: this.buildPasswordRecoveryUrl(user.email, token, sig),
            expiresInMinutes: 15,
        });

        return genericResponse;
    }

    async resetPassword(body: any) {
        const email = this.normalizeEmail(body?.email);
        const code = typeof body?.code === 'string' ? body.code.trim() : '';
        const token = typeof body?.token === 'string' ? body.token.trim() : '';
        const sig = typeof body?.sig === 'string' ? body.sig.trim() : '';
        const newPassword = body?.newPassword;

        if (!email || !code || !newPassword) {
            throw new BadRequestException('Parâmetros de redefinição inválidos');
        }

        assertStrongPassword(newPassword, { email });

        const attemptKey = `forgot_password_attempts:${email}`;
        const currentAttempts = Number((await this.redisSecurity.getValue(attemptKey)) || '0');
        if (currentAttempts >= 6) {
            throw new HttpException(
                'Excedeu o limite de 6 tentativas de verificação. Por favor, solicite um novo código após 5 minutos.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const secret = getPasswordResetSecret(this.configService);
        let verifiedResetId: string | null = null;

        if (token && sig) {
            const expectedSig = crypto.createHmac('sha256', secret).update(token).digest('hex');
            if (!timingSafeEqualStr(sig, expectedSig)) {
                throw new BadRequestException('Assinatura do token inválida');
            }

            let payload: any;
            try {
                const decrypted = CryptoUtil.decrypt(token, secret);
                payload = JSON.parse(decrypted);
            } catch {
                throw new BadRequestException('Token de recuperação inválido ou corrompido');
            }

            if (this.normalizeEmail(payload.email) !== email) {
                throw new BadRequestException('O e-mail informado não corresponde ao token de redefinição');
            }

            if (!payload.timestamp || Date.now() - payload.timestamp > 15 * 60 * 1000) {
                throw new BadRequestException('Token de recuperação expirado');
            }

            const usedKey = payload.resetId ? `pwd_reset_used:${payload.resetId}` : null;
            if (usedKey && (await this.redisSecurity.getValue(usedKey))) {
                throw new BadRequestException('Este link de recuperação já foi utilizado');
            }

            if (!timingSafeEqualStr(String(payload.code || ''), code)) {
                const { count: attempts } = await this.redisSecurity.incrementWithWindow(attemptKey, 300000);
                if (attempts >= 6) {
                    await this.redisSecurity.setValue(`forgot_password_request_limit:${email}`, '1', 300000);
                    throw new HttpException(
                        'Código incorreto. Limite de 6 tentativas excedido. Você deve aguardar 5 minutos para solicitar um novo código.',
                        HttpStatus.TOO_MANY_REQUESTS,
                    );
                }
                throw new BadRequestException(`Código de recuperação inválido. Tentativa ${attempts} de 6.`);
            }

            verifiedResetId = payload.resetId || null;
        } else {
            const storedRaw = await this.redisSecurity.getValue(`pwd_reset:${email}`);
            if (!storedRaw) {
                throw new BadRequestException('Código de recuperação inválido ou expirado');
            }

            let stored: { codeHash: string; resetId: string };
            try {
                stored = JSON.parse(storedRaw);
            } catch {
                throw new BadRequestException('Código de recuperação inválido ou expirado');
            }

            if (!timingSafeEqualStr(stored.codeHash, this.sha256(code))) {
                const { count: attempts } = await this.redisSecurity.incrementWithWindow(attemptKey, 300000);
                if (attempts >= 6) {
                    await this.redisSecurity.deleteKey(`pwd_reset:${email}`);
                    await this.redisSecurity.setValue(`forgot_password_request_limit:${email}`, '1', 300000);
                    throw new HttpException(
                        'Código incorreto. Limite de 6 tentativas excedido. Você deve aguardar 5 minutos para solicitar um novo código.',
                        HttpStatus.TOO_MANY_REQUESTS,
                    );
                }
                throw new BadRequestException(`Código de recuperação inválido. Tentativa ${attempts} de 6.`);
            }

            const existingForCode = await this.usersService.findOneByEmail(email);
            if (existingForCode) {
                assertStrongPassword(
                    newPassword,
                    {
                        name: existingForCode.name,
                        email,
                        contact: existingForCode.whatsapp,
                    },
                    existingForCode.preferredLocale === 'en' ? 'en' : 'pt',
                );
            }

            const consumed = await this.redisSecurity.consumeOnce(`pwd_reset:${email}`);
            if (!consumed) {
                throw new BadRequestException('Código de recuperação já utilizado ou expirado');
            }
            verifiedResetId = stored.resetId;
        }

        const user = await this.usersService.findOneByEmail(email);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }

        assertStrongPassword(
            newPassword,
            {
                name: user.name,
                email,
                contact: user.whatsapp,
            },
            user.preferredLocale === 'en' ? 'en' : 'pt',
        );

        if (verifiedResetId) {
            const firstUse = await this.redisSecurity.setIfAbsent(
                `pwd_reset_used:${verifiedResetId}`,
                '1',
                15 * 60 * 1000,
            );
            if (!firstUse) {
                throw new BadRequestException('Este código de recuperação já foi utilizado');
            }
        }
        await this.redisSecurity.deleteKey(`pwd_reset:${email}`);

        user.passwordHash = await hashPasswordSecure(newPassword);
        user.isBlocked = false;
        if (!user.emailVerifiedAt) {
            user.emailVerifiedAt = new Date();
        }
        user.refreshToken = null as any;
        await this.usersService.update(user);
        await this.usersService.invalidateAuthGuardCache(user.id);

        // Revoke all active user sessions + JTI + live sockets so stolen JWTs cannot persist across password resets
        await this.revokeAllUserSessions(user.id, 'password_reset');

        await this.redisSecurity.deleteKey(attemptKey);
        await this.redisSecurity.deleteKey(`login_failures:${email}`);
        await this.redisSecurity.deleteKey(`login_lockout:${email}`);
        await this.redisSecurity.deleteKey(`forgot_password_request_limit:${email}`);

        return {
            success: true,
            message: 'Senha redefinida com sucesso. Sua conta foi desbloqueada.',
        };
    }

    private maskEmailForVerification(email: string): string {
        const [local = '', domain = ''] = String(email || '').split('@');
        if (!domain) return email;
        const prefix = local.slice(0, Math.min(2, local.length));
        return `${prefix}${'*'.repeat(Math.max(2, local.length - prefix.length))}@${domain}`;
    }

    getGeoHint(headers: Record<string, any> | undefined, timezone?: string) {
        return resolveCountryFromHeadersOrTimezone(headers, timezone);
    }

    async initiateRegistration(data: RegisterInitiateDto, ip?: string, userAgent?: string) {
        const email = this.normalizeEmail(data?.email);
        const preferredLocale = data?.preferredLocale === 'en' ? 'en' : 'pt';
        if (!email) {
            throw new BadRequestException(
                preferredLocale === 'en' ? 'Enter a valid email address.' : 'Informe um e-mail válido.',
            );
        }

        await assertAllowedRegistrationEmail(email, { locale: preferredLocale });

        const contactValidation = validateAndNormalizeContact(data?.contact, data?.countryIso2);
        if (!contactValidation.valid) {
            throw new BadRequestException(
                contactValidation.reason || 'Informe um contacto válido com prefixo internacional.',
            );
        }

        assertStrongPassword(
            data?.password,
            {
                name: data?.name,
                email,
                contact: contactValidation.normalized || data?.contact,
            },
            preferredLocale,
        );

        const existingUser = await this.usersService.findOneByEmail(email);
        if (existingUser && this.isUserEmailVerified(existingUser)) {
            throw new ConflictException('Email already registered');
        }

        const passwordHash = await hashPasswordSecure(data.password);
        const timezone =
            typeof data.timezone === 'string' && data.timezone.trim()
                ? data.timezone.trim().slice(0, 64)
                : undefined;
        const cleanName = String(data.name || '').trim().slice(0, 120);
        const rawVisitorId = data.visitorId ? String(data.visitorId).slice(0, 120) : undefined;
        const attributionData = sanitizeAttributionPayload(data.attributionData);
        const resolvedAcq = resolveAcquisitionFields(
            attributionData || data.attributionData,
            rawVisitorId,
        );
        const explicitRefCode = this.extractReferralCodeFromInput(
            data.referralCode,
            data.attributionData,
        );

        let user: any;
        if (existingUser) {
            existingUser.name = cleanName || existingUser.name;
            existingUser.passwordHash = passwordHash;
            existingUser.whatsapp = contactValidation.normalized;
            existingUser.preferredLocale = preferredLocale;
            if (timezone) existingUser.timezone = timezone;
            if (!existingUser.apiToken) {
                existingUser.apiToken = crypto.randomUUID().toUpperCase();
            }
            if (!existingUser.attributionData && attributionData) {
                existingUser.attributionData = attributionData;
            }
            if (!existingUser.visitorId && resolvedAcq.visitorId) {
                existingUser.visitorId = resolvedAcq.visitorId;
            }
            if ((!existingUser.acquisitionSource || existingUser.acquisitionSource === 'direct') && resolvedAcq.acquisitionSource) {
                existingUser.acquisitionSource = resolvedAcq.acquisitionSource;
            }
            if (!existingUser.acquisitionMedium && resolvedAcq.acquisitionMedium) {
                existingUser.acquisitionMedium = resolvedAcq.acquisitionMedium;
            }
            if (!existingUser.acquisitionCampaign && resolvedAcq.acquisitionCampaign) {
                existingUser.acquisitionCampaign = resolvedAcq.acquisitionCampaign;
            }
            if (!existingUser.acquisitionContent && resolvedAcq.acquisitionContent) {
                existingUser.acquisitionContent = resolvedAcq.acquisitionContent;
            }
            if (!existingUser.acquisitionTerm && resolvedAcq.acquisitionTerm) {
                existingUser.acquisitionTerm = resolvedAcq.acquisitionTerm;
            }
            if (!existingUser.landingPath && resolvedAcq.landingPath) {
                existingUser.landingPath = resolvedAcq.landingPath;
            }
            if (!existingUser.referrer && resolvedAcq.referrer) {
                existingUser.referrer = resolvedAcq.referrer;
            }
            existingUser.emailVerifiedAt = null;
            existingUser.lastActiveAt = new Date();
            existingUser.lastActionType = 'register_initiated';
            existingUser.lastActionLabel = 'Reiniciou registo (aguarda verificação de e-mail)';
            existingUser.lastActionPath = '/register';
            user = await this.usersService.update(existingUser);
        } else {
            const createPayload = {
                name: cleanName,
                email,
                passwordHash,
                whatsapp: contactValidation.normalized,
                apiToken: crypto.randomUUID().toUpperCase(),
                preferredLocale,
                timezone,
                attributionData,
                visitorId: resolvedAcq.visitorId,
                acquisitionSource: resolvedAcq.acquisitionSource,
                acquisitionMedium: resolvedAcq.acquisitionMedium,
                acquisitionCampaign: resolvedAcq.acquisitionCampaign,
                acquisitionContent: resolvedAcq.acquisitionContent,
                acquisitionTerm: resolvedAcq.acquisitionTerm,
                landingPath: resolvedAcq.landingPath,
                referrer: resolvedAcq.referrer,
                emailVerifiedAt: null,
                lastLoginAt: null,
                lastActiveAt: new Date(),
                lastActionType: 'register_initiated',
                lastActionLabel: 'Iniciou registo (aguarda verificação de e-mail)',
                lastActionPath: '/register',
            };
            try {
                user = await this.usersService.create(createPayload);
            } catch (err: any) {
                if (err?.code === '23505') {
                    const raced = await this.usersService.findOneByEmail(email);
                    if (raced && !this.isUserEmailVerified(raced)) {
                        user = raced;
                    } else {
                        throw new ConflictException('Email already registered');
                    }
                } else {
                    throw err;
                }
            }
        }

        if (explicitRefCode) {
            await this.redisSecurity
                .setValue(`reg_pending_ref:${user.id}`, explicitRefCode, 30 * 24 * 60 * 60 * 1000)
                .catch(() => {});
        }

        const verifySession = await this.issueEmailVerificationSession(user, {
            cooldownMs: 45 * 1000,
        });

        await this.auditLogService.log(
            user.id,
            'REGISTRATION_INITIATED',
            {
                email,
                countryIso2: contactValidation.countryIso2,
                codeSent: verifySession.codeSent,
                ip,
                userAgent,
            },
            ip,
            userAgent,
        );

        return {
            success: true,
            verificationToken: verifySession.verificationToken,
            emailMasked: verifySession.emailMasked,
            expiresInSeconds: verifySession.expiresInSeconds,
            codeSent: verifySession.codeSent,
            message: verifySession.codeSent
                ? 'Código de verificação enviado para o seu e-mail.'
                : 'Código de verificação já enviado recentemente. Introduza-o na página de verificação.',
        };
    }

    async verifyRegistration(
        verificationToken: string,
        otp: string,
        ip?: string,
        userAgent?: string,
    ) {
        if (!verificationToken || !otp) {
            throw new BadRequestException('Token e código de verificação são obrigatórios.');
        }

        let payload: any;
        try {
            payload = this.jwtService.verify(verificationToken, {
                secret: getTwoFactorJwtSecret(this.configService),
            });
        } catch {
            throw new UnauthorizedException('Sessão de verificação expirada ou inválida.');
        }

        const isUserBackedPurpose =
            payload?.purpose === 'account_verify' || payload?.purpose === 'reg_verify';
        if (!payload?.verificationId || !isUserBackedPurpose) {
            throw new UnauthorizedException('Token de verificação de conta inválido.');
        }

        const normalizedOtp = String(otp || '').trim();

        // User-backed verification (supports both initial signup and first-login verification)
        if (payload.userId) {
            const userId = String(payload.userId);
            const user = await this.usersService.findOneById(userId);
            if (!user) {
                throw new NotFoundException('Conta não encontrada. Por favor, registe-se novamente.');
            }
            if (this.isUserEmailVerified(user)) {
                return {
                    success: true,
                    alreadyVerified: true,
                    message: 'Esta conta já foi verificada. Faça login para continuar.',
                };
            }

            const failKey = `reg_verify_fail:${userId}`;
            const acctVerifyKey = `acct_verify:${userId}`;
            const currentFails = Number((await this.redisSecurity.getValue(failKey)) || '0');
            if (currentFails >= 5) {
                await this.redisSecurity.deleteKey(acctVerifyKey);
                throw new HttpException(
                    'Código invalidado por excesso de tentativas. Clique em Reenviar código para receber um novo.',
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }

            const rawPending = await this.redisSecurity.getValue(acctVerifyKey);
            if (!rawPending) {
                throw new BadRequestException(
                    'Código de verificação expirado. Clique em Reenviar código para receber um novo.',
                );
            }

            let pending: any;
            try {
                pending = JSON.parse(rawPending);
            } catch {
                throw new BadRequestException(
                    'Dados de verificação corrompidos. Clique em Reenviar código para gerar um novo.',
                );
            }

            if (!pending.codeHash || !timingSafeEqualStr(pending.codeHash, this.sha256(normalizedOtp))) {
                const { count } = await this.redisSecurity.incrementWithWindow(failKey, 900_000);
                if (count >= 5) {
                    await this.redisSecurity.deleteKey(acctVerifyKey);
                    throw new HttpException(
                        'Código incorreto e invalidado por excesso de tentativas. Clique em Reenviar código para receber um novo.',
                        HttpStatus.TOO_MANY_REQUESTS,
                    );
                }
                throw new BadRequestException(
                    `Código de verificação inválido. Tentativa ${count} de 5.`,
                );
            }

            const consumed = await this.redisSecurity.consumeOnce(acctVerifyKey);
            if (!consumed) {
                const refreshedUser = await this.usersService.findOneById(userId);
                if (refreshedUser && this.isUserEmailVerified(refreshedUser)) {
                    return {
                        success: true,
                        alreadyVerified: true,
                        message: 'Esta conta já foi verificada. Faça login para continuar.',
                    };
                }
                throw new BadRequestException(
                    'Código já utilizado ou expirado. Clique em Reenviar código.',
                );
            }

            await this.redisSecurity.deleteKey(failKey);
            await this.redisSecurity.deleteKey(`email_verify_cooldown:${userId}`);

            user.emailVerifiedAt = new Date();
            user.lastLoginAt = new Date();
            user.lastActiveAt = new Date();
            user.lastActionType = 'signup';
            user.lastActionLabel = 'Verificou conta (/verify-account)';
            user.lastActionPath = '/verify-account';
            const savedUser = await this.usersService.update(user);

            await this.completeVerifiedSignupSideEffects(savedUser, {
                method: 'email_otp_two_step',
            });

            if (savedUser.twoFactorEnabled) {
                return this.buildTwoFactorChallenge(savedUser, ip, userAgent);
            }

            const authResponse = await this.generateAuthResponse(savedUser, ip, userAgent, false, {
                skipLoginAlert: true,
            });
            return {
                ...authResponse,
                message: 'Conta verificada com sucesso',
            };
        }

        // Legacy Redis-only reg_pending fallback for in-flight tokens issued before upgrade
        const verificationId = String(payload.verificationId);
        const failKey = `reg_verify_fail:${verificationId}`;
        const currentFails = Number((await this.redisSecurity.getValue(failKey)) || '0');
        if (currentFails >= 5) {
            await this.redisSecurity.deleteKey(`reg_pending:${verificationId}`);
            throw new HttpException(
                'Código invalidado por excesso de tentativas. Clique em Reenviar código ou registe-se novamente.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const rawPending = await this.redisSecurity.getValue(`reg_pending:${verificationId}`);
        if (!rawPending) {
            throw new BadRequestException('Sessão de verificação expirada. Inicie sessão ou registe-se novamente.');
        }

        let pending: any;
        try {
            pending = JSON.parse(rawPending);
        } catch {
            throw new BadRequestException('Dados de verificação corrompidos. Registe-se novamente.');
        }

        if (!pending.codeHash || !timingSafeEqualStr(pending.codeHash, this.sha256(normalizedOtp))) {
            const { count } = await this.redisSecurity.incrementWithWindow(failKey, 900_000);
            if (count >= 5) {
                await this.redisSecurity.deleteKey(`reg_pending:${verificationId}`);
            }
            throw new BadRequestException('Código de verificação inválido.');
        }

        const consumed = await this.redisSecurity.consumeOnce(`reg_pending:${verificationId}`);
        if (!consumed) {
            throw new BadRequestException('Código já utilizado ou sessão expirada.');
        }
        await this.redisSecurity.deleteKey(failKey);
        await this.redisSecurity.deleteKey(`reg_resend_cooldown:${verificationId}`);

        const normalizedEmail = this.normalizeEmail(pending.email);
        const existingUser = await this.usersService.findOneByEmail(normalizedEmail);
        if (existingUser && this.isUserEmailVerified(existingUser)) {
            throw new ConflictException('Email already registered');
        }

        const attributionData = sanitizeAttributionPayload(pending.attributionData);
        const resolvedAcq = resolveAcquisitionFields(
            attributionData || pending.attributionData,
            pending.visitorId,
        );

        let newUser: any;
        if (existingUser) {
            existingUser.name = pending.name || existingUser.name;
            existingUser.passwordHash = pending.passwordHash;
            existingUser.whatsapp = pending.whatsapp || existingUser.whatsapp;
            existingUser.preferredLocale = pending.preferredLocale === 'en' ? 'en' : 'pt';
            existingUser.timezone = pending.timezone || existingUser.timezone;
            existingUser.emailVerifiedAt = new Date();
            existingUser.lastLoginAt = new Date();
            existingUser.lastActiveAt = new Date();
            existingUser.lastActionType = 'signup';
            existingUser.lastActionLabel = 'Criou e verificou conta (/verify-account)';
            existingUser.lastActionPath = '/verify-account';
            newUser = await this.usersService.update(existingUser);
        } else {
            try {
                newUser = await this.usersService.create({
                    name: pending.name,
                    email: normalizedEmail,
                    passwordHash: pending.passwordHash,
                    whatsapp: pending.whatsapp,
                    apiToken: crypto.randomUUID().toUpperCase(),
                    preferredLocale: pending.preferredLocale === 'en' ? 'en' : 'pt',
                    timezone: pending.timezone,
                    attributionData,
                    visitorId: resolvedAcq.visitorId,
                    acquisitionSource: resolvedAcq.acquisitionSource,
                    acquisitionMedium: resolvedAcq.acquisitionMedium,
                    acquisitionCampaign: resolvedAcq.acquisitionCampaign,
                    acquisitionContent: resolvedAcq.acquisitionContent,
                    acquisitionTerm: resolvedAcq.acquisitionTerm,
                    landingPath: resolvedAcq.landingPath,
                    referrer: resolvedAcq.referrer,
                    emailVerifiedAt: new Date(),
                    lastLoginAt: new Date(),
                    lastActiveAt: new Date(),
                    lastActionType: 'signup',
                    lastActionLabel: 'Criou e verificou conta (/verify-account)',
                    lastActionPath: '/verify-account',
                });
            } catch (err: any) {
                if (err?.code === '23505') {
                    throw new ConflictException('Email already registered');
                }
                throw err;
            }
        }

        const legacyRefCode = this.extractReferralCodeFromInput(
            pending.referralCode,
            pending.attributionData,
        );
        await this.completeVerifiedSignupSideEffects(newUser, {
            explicitReferralCode: legacyRefCode,
            attributionData,
            visitorId: resolvedAcq.visitorId,
            method: 'email_otp_two_step',
        });

        const authResponse = await this.generateAuthResponse(newUser, ip, userAgent, false, {
            skipLoginAlert: true,
        });
        return {
            ...authResponse,
            message: 'Conta verificada e criada com sucesso',
        };
    }

    async resendRegistrationOtp(verificationToken: string) {
        if (!verificationToken) {
            throw new BadRequestException('Sessão de verificação inválida.');
        }

        let payload: any;
        try {
            payload = this.jwtService.verify(verificationToken, {
                secret: getTwoFactorJwtSecret(this.configService),
            });
        } catch {
            throw new UnauthorizedException('Sessão de verificação expirada. Inicie sessão para receber um novo código.');
        }

        const isUserBackedPurpose =
            payload?.purpose === 'account_verify' || payload?.purpose === 'reg_verify';
        if (!payload?.verificationId || !isUserBackedPurpose) {
            throw new UnauthorizedException('Token de verificação inválido.');
        }

        if (payload.userId) {
            const user = await this.usersService.findOneById(String(payload.userId));
            if (!user) {
                throw new NotFoundException('Conta não encontrada. Registe-se novamente.');
            }
            if (this.isUserEmailVerified(user)) {
                return {
                    success: true,
                    alreadyVerified: true,
                    message: 'Esta conta já foi verificada. Faça login para entrar.',
                };
            }

            const verifySession = await this.issueEmailVerificationSession(user, {
                forceResend: true,
                cooldownMs: 55 * 1000,
            });
            return {
                success: true,
                verificationToken: verifySession.verificationToken,
                emailMasked: verifySession.emailMasked,
                expiresInSeconds: verifySession.expiresInSeconds,
                codeSent: verifySession.codeSent,
                message: 'Novo código de verificação enviado para o seu e-mail.',
            };
        }

        const verificationId = String(payload.verificationId);
        const cooldownKey = `reg_resend_cooldown:${verificationId}`;
        if (await this.redisSecurity.getValue(cooldownKey)) {
            throw new HttpException(
                'Aguarde 60 segundos antes de reenviar o código.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const rawPending = await this.redisSecurity.getValue(`reg_pending:${verificationId}`);
        if (!rawPending) {
            throw new BadRequestException('Sessão de verificação expirada. Inicie sessão ou registe-se novamente.');
        }

        let pending: any;
        try {
            pending = JSON.parse(rawPending);
        } catch {
            throw new BadRequestException('Dados de verificação corrompidos.');
        }

        const newOtp = this.generateOtp();
        pending.codeHash = this.sha256(newOtp);

        await this.redisSecurity.setValue(
            `reg_pending:${verificationId}`,
            JSON.stringify(pending),
            15 * 60 * 1000,
        );
        await this.redisSecurity.setValue(cooldownKey, '1', 55 * 1000);
        await this.redisSecurity.deleteKey(`reg_verify_fail:${verificationId}`);

        await this.dispatchEmailWithFallback(pending.email, 'OTP_CODE', {
            otp: newOtp,
            userName: pending.name || undefined,
            expiresInMinutes: 15,
            purpose: 'REGISTRATION',
        });

        return {
            success: true,
            message: 'Novo código de verificação enviado para o seu e-mail.',
        };
    }

    async register(data: any, ip?: string, userAgent?: string) {
        const email = this.normalizeEmail(data?.email);
        const preferredLocale = data?.preferredLocale === 'en' ? 'en' : 'pt';
        const otp = typeof data?.otp === 'string' ? data.otp.trim() : '';
        if (!email || !otp) {
            throw new BadRequestException('OTP is required');
        }

        await assertAllowedRegistrationEmail(email, { locale: preferredLocale });
        assertStrongPassword(
            data?.password,
            {
                name: data?.name,
                email,
                contact: data?.contact || data?.whatsapp,
            },
            preferredLocale,
        );

        const failKey = `otp_reg_fail:${email}`;
        const currentFails = Number((await this.redisSecurity.getValue(failKey)) || '0');
        if (currentFails >= 5) {
            await this.redisSecurity.deleteKey(`OTP:${email}`);
            throw new HttpException(
                'Código invalidado por excesso de tentativas. Solicite um novo código.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const storedOtp = await this.redisSecurity.getValue(`OTP:${email}`);
        if (!storedOtp || !timingSafeEqualStr(storedOtp, otp)) {
            const { count } = await this.redisSecurity.incrementWithWindow(failKey, 600000);
            if (count >= 5) {
                await this.redisSecurity.deleteKey(`OTP:${email}`);
            }
            throw new BadRequestException('Invalid or expired OTP');
        }

        const existingUser = await this.usersService.findOneByEmail(email);
        if (existingUser && this.isUserEmailVerified(existingUser)) {
            throw new ConflictException('Email already registered');
        }

        // Consume OTP atomically to prevent concurrent duplicate registration with the same code
        const consumed = await this.redisSecurity.consumeOnce(`OTP:${email}`);
        if (!consumed) {
            throw new BadRequestException('Invalid or expired OTP');
        }
        await this.redisSecurity.deleteKey(failKey);

        const passwordHash = await hashPasswordSecure(data.password);

        const timezone =
            typeof data.timezone === 'string' && data.timezone.trim()
                ? data.timezone.trim().slice(0, 64)
                : undefined;
        const attributionData = sanitizeAttributionPayload(data.attributionData);
        const resolvedAcq = resolveAcquisitionFields(attributionData || data.attributionData, data.visitorId);

        const rawContact = data.contact || data.whatsapp;
        let normalizedContact = rawContact;
        if (rawContact) {
            const contactRes = validateAndNormalizeContact(rawContact, data.countryIso2);
            if (!contactRes.valid) {
                throw new BadRequestException(contactRes.reason || 'Contacto inválido.');
            }
            normalizedContact = contactRes.normalized;
        }

        let newUser: any;
        if (existingUser) {
            existingUser.name = data.name || existingUser.name;
            existingUser.passwordHash = passwordHash;
            existingUser.whatsapp = normalizedContact || existingUser.whatsapp;
            existingUser.preferredLocale = preferredLocale;
            existingUser.timezone = timezone || existingUser.timezone;
            existingUser.emailVerifiedAt = new Date();
            existingUser.lastLoginAt = new Date();
            existingUser.lastActiveAt = new Date();
            existingUser.lastActionType = 'signup';
            existingUser.lastActionLabel = 'Criou conta e verificou e-mail (OTP)';
            existingUser.lastActionPath = '/register';
            newUser = await this.usersService.update(existingUser);
        } else {
            try {
                newUser = await this.usersService.create({
                    name: data.name,
                    email,
                    passwordHash: passwordHash,
                    whatsapp: normalizedContact,
                    apiToken: crypto.randomUUID().toUpperCase(),
                    preferredLocale,
                    timezone,
                    attributionData,
                    visitorId: resolvedAcq.visitorId,
                    acquisitionSource: resolvedAcq.acquisitionSource,
                    acquisitionMedium: resolvedAcq.acquisitionMedium,
                    acquisitionCampaign: resolvedAcq.acquisitionCampaign,
                    acquisitionContent: resolvedAcq.acquisitionContent,
                    acquisitionTerm: resolvedAcq.acquisitionTerm,
                    landingPath: resolvedAcq.landingPath,
                    referrer: resolvedAcq.referrer,
                    emailVerifiedAt: new Date(),
                    lastLoginAt: new Date(),
                    lastActiveAt: new Date(),
                    lastActionType: 'signup',
                    lastActionLabel: 'Criou conta e verificou e-mail (OTP)',
                    lastActionPath: '/register',
                });
            } catch (err: any) {
                if (err?.code === '23505') {
                    throw new ConflictException('Email already registered');
                }
                throw err;
            }
        }

        const legacyRefCode = this.extractReferralCodeFromInput(
            (data as any).referralCode,
            data.attributionData,
        );
        await this.completeVerifiedSignupSideEffects(newUser, {
            explicitReferralCode: legacyRefCode,
            attributionData,
            visitorId: resolvedAcq.visitorId,
            method: 'email_otp',
        });

        const authResponse = await this.generateAuthResponse(newUser, ip, userAgent, false, {
            skipLoginAlert: true,
        });
        return {
            ...authResponse,
            message: 'User registered successfully',
        };
    }

    async regenerateToken(userId: string) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new UnauthorizedException();

        const newToken = crypto.randomUUID().toUpperCase();
        user.apiToken = newToken;
        await this.usersService.update(user);

        const account = await this.accountRepository.findOne({ where: { userId } });
        if (account) {
            account.appToken = newToken;
            await this.accountRepository.save(account);
        } else {
            await this.createDefaultAccount(userId, newToken);
        }

        return {
            success: true,
            message: 'Token regenerated successfully',
            api_token: user.apiToken,
        };
    }

    async createOAuthExchangeCode(payload: {
        token?: string | null;
        twoFactorRequired?: boolean;
        twoFactorType?: string | null;
        twoFactorToken?: string | null;
        requiresContact?: boolean;
    }): Promise<string> {
        const code = crypto.randomBytes(24).toString('base64url');
        await this.redisSecurity.setValue(`oauth_code:${code}`, JSON.stringify(payload), 60_000);
        return code;
    }

    async exchangeOAuthCode(code: string) {
        const raw = await this.redisSecurity.consumeOnce(`oauth_code:${code}`);
        if (!raw) {
            throw new UnauthorizedException('Código OAuth inválido ou expirado');
        }
        try {
            return JSON.parse(raw);
        } catch {
            throw new UnauthorizedException('Código OAuth corrompido');
        }
    }

    async validateGoogleUser(profile: any, ip?: string, userAgent?: string) {
        if (!profile?.email || profile?.emailVerified !== true) {
            throw new UnauthorizedException('O e-mail da conta Google não está verificado.');
        }

        const normalizedEmail = this.normalizeEmail(profile.email);
        let user = await this.usersService.findOneByGoogleId(profile.googleId);
        let isNewUser = false;

        if (!user) {
            user = await this.usersService.findOneByEmail(normalizedEmail);
            if (user) {
                user.googleId = profile.googleId;
                if (!user.emailVerifiedAt) {
                    user.emailVerifiedAt = new Date();
                }
                await this.usersService.update(user);
            } else {
                isNewUser = true;
                user = await this.usersService.create({
                    email: normalizedEmail,
                    name: profile.name,
                    googleId: profile.googleId,
                    avatarUrl: profile.avatarUrl,
                    apiToken: crypto.randomUUID().toUpperCase(),
                    emailVerifiedAt: new Date(),
                    lastLoginAt: new Date(),
                    lastActiveAt: new Date(),
                    lastActionType: 'signup',
                    lastActionLabel: 'Criou conta via Google',
                    lastActionPath: '/register',
                });
                await this.createDefaultAccount(user.id);
                await this.emailProducer.enqueue(
                    user.email,
                    'WELCOME_EMAIL',
                    { userName: user.name || undefined },
                    { jobId: `welcome:${user.id}` },
                );
                void this.analyticsService?.recordAuthOrBillingConversion({
                    eventName: 'signup',
                    userId: user.id,
                    email: user.email,
                    metadata: { method: 'google' },
                });
            }
        }

        if (user.isBlocked) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.FORBIDDEN,
                    message:
                        'Esta conta foi bloqueada devido a tentativas falhas de login. Por favor, redefina sua senha.',
                    error: 'Blocked Account',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        if (user.twoFactorEnabled) {
            const challenge = await this.buildTwoFactorChallenge(user, ip, userAgent);
            return {
                ...challenge,
                token: null,
                user: null,
                requiresContact: false,
            };
        }

        const authResponse = await this.generateAuthResponse(user, ip, userAgent, false, {
            skipLoginAlert: isNewUser,
        });
        return {
            ...authResponse,
            requiresContact: !user.whatsapp,
        };
    }

    async validateGithubUser(profile: any, ip?: string, userAgent?: string) {
        if (!profile?.email || profile?.emailVerified !== true) {
            throw new UnauthorizedException('O e-mail da conta GitHub não está verificado.');
        }

        const normalizedEmail = this.normalizeEmail(profile.email);
        let user = await this.usersService.findOneByGithubId(profile.githubId);
        let isNewUser = false;

        if (!user) {
            user = await this.usersService.findOneByEmail(normalizedEmail);
            if (user) {
                user.githubId = profile.githubId;
                if (!user.emailVerifiedAt) {
                    user.emailVerifiedAt = new Date();
                }
                await this.usersService.update(user);
            } else {
                isNewUser = true;
                user = await this.usersService.create({
                    email: normalizedEmail,
                    name: profile.name,
                    githubId: profile.githubId,
                    avatarUrl: profile.avatarUrl,
                    apiToken: crypto.randomUUID().toUpperCase(),
                    emailVerifiedAt: new Date(),
                    lastLoginAt: new Date(),
                    lastActiveAt: new Date(),
                    lastActionType: 'signup',
                    lastActionLabel: 'Criou conta via GitHub',
                    lastActionPath: '/register',
                });
                await this.createDefaultAccount(user.id);
                await this.emailProducer.enqueue(
                    user.email,
                    'WELCOME_EMAIL',
                    { userName: user.name || undefined },
                    { jobId: `welcome:${user.id}` },
                );
                void this.analyticsService?.recordAuthOrBillingConversion({
                    eventName: 'signup',
                    userId: user.id,
                    email: user.email,
                    metadata: { method: 'github' },
                });
            }
        }

        if (user.isBlocked) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.FORBIDDEN,
                    message:
                        'Esta conta foi bloqueada devido a tentativas falhas de login. Por favor, redefina sua senha.',
                    error: 'Blocked Account',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        if (user.twoFactorEnabled) {
            const challenge = await this.buildTwoFactorChallenge(user, ip, userAgent);
            return {
                ...challenge,
                token: null,
                user: null,
                requiresContact: false,
            };
        }

        const authResponse = await this.generateAuthResponse(user, ip, userAgent, false, {
            skipLoginAlert: isNewUser,
        });
        return {
            ...authResponse,
            requiresContact: !user.whatsapp,
        };
    }

    async getAppToken(userId: string, accountId?: string) {
        let account: AccountEntity | null = null;
        if (accountId && accountId !== 'all') {
            account = await this.accountRepository.findOne({ where: { id: accountId, userId } });
        }
        if (!account) {
            account = await this.accountRepository.findOne({
                where: { userId, isArchived: false, isPrimary: true },
            });
        }
        if (!account) {
            account = await this.accountRepository.findOne({
                where: { userId, isArchived: false },
            });
        }
        if (!account) {
            account = await this.createDefaultAccount(userId);
        }

        if (!account.appToken) {
            account.appToken = crypto.randomUUID().replace(/-/g, '').toUpperCase();
            await this.accountRepository.save(account);
        }

        return { token: account.appToken, accountId: account.id, accountName: account.name };
    }

    private encryptTwoFactorSecret(secret: string, userId?: string): string {
        const keyring = getTwoFactorEncryptionKeyring(this.configService);
        return CryptoUtil.encrypt(secret, keyring, {
            aad: userId ? `totp:${userId}` : undefined,
        });
    }

    private decryptTwoFactorSecret(storedSecret: string, userId?: string): string {
        if (!storedSecret) return storedSecret;
        if (storedSecret.includes(':')) {
            const keyring = getTwoFactorEncryptionKeyring(this.configService);
            try {
                return CryptoUtil.decrypt(storedSecret, keyring, {
                    aad: userId ? `totp:${userId}` : undefined,
                });
            } catch {
                // Fallback for v3/v2 ciphertexts encrypted prior to AAD binding
                return CryptoUtil.decrypt(storedSecret, keyring);
            }
        }
        return storedSecret;
    }

    async setupTwoFactor(userId: string) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new NotFoundException('Usuário não encontrado');

        const secret = generateSecret();
        const otpauthUrl = generateURI({
            label: user.email,
            issuer: 'Torex Journal',
            secret,
        });
        const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

        user.twoFactorSecret = this.encryptTwoFactorSecret(secret, userId);
        user.isTwoFactorConfirmed = false;
        await this.usersService.update(user);

        return {
            secret,
            qrCodeDataUrl,
        };
    }

    async verifyTwoFactorSetup(userId: string, token: string) {
        const user = await this.usersService.findOneById(userId);
        if (!user || !user.twoFactorSecret) {
            throw new BadRequestException('Setup de 2FA não iniciado');
        }

        const decryptedSecret = this.decryptTwoFactorSecret(user.twoFactorSecret, userId);
        const isValid = verifySync({
            token,
            secret: decryptedSecret,
        }).valid;

        if (!isValid) {
            throw new BadRequestException('Código 2FA inválido');
        }

        // Upgrade legacy plaintext or v2 secrets transparently to v3 HKDF+AAD
        if (!user.twoFactorSecret.includes(':') || CryptoUtil.needsReencryption(user.twoFactorSecret, 'totp_v1')) {
            user.twoFactorSecret = this.encryptTwoFactorSecret(decryptedSecret, userId);
        }
        user.isTwoFactorConfirmed = true;
        user.twoFactorEnabled = true;
        await this.usersService.update(user);
        await this.usersService.invalidateAuthGuardCache(userId);

        await this.auditLogService.log(userId, '2FA_SETUP_SUCCESS', { type: 'TOTP' });

        return { success: true };
    }

    async verify2fa(twoFactorToken: string, otp: string, ip?: string, userAgent?: string) {
        if (!twoFactorToken) {
            throw new BadRequestException('Token de 2FA é obrigatório');
        }

        let payload: any;
        try {
            payload = this.jwtService.verify(twoFactorToken, {
                secret: getTwoFactorJwtSecret(this.configService),
            });
        } catch (e) {
            throw new UnauthorizedException('Token de verificação 2FA expirado ou inválido');
        }

        if (!payload || !payload.id || !payload.isTwoFactorPending) {
            throw new UnauthorizedException('Token de verificação 2FA inválido');
        }

        const userId = payload.id;

        const lockoutKey = `2fa_lockout:${userId}`;
        const isLockedOut = await this.redisSecurity.getValue(lockoutKey);
        if (isLockedOut) {
            throw new HttpException(
                'Limite de tentativas de 2FA excedido. Verificação bloqueada temporariamente.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const user = await this.usersService.findOneById(userId);
        if (!user) throw new BadRequestException('Usuário não encontrado');

        if (user.isBlocked) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.FORBIDDEN,
                    message: 'Acesso bloqueado. Por favor, recupere sua conta.',
                    error: 'Blocked Account',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        const normalizedOtp = String(otp || '').trim();
        const storedOtp = await this.redisSecurity.getValue(`2FA:${userId}`);
        let isCachedOtpValid = Boolean(storedOtp && timingSafeEqualStr(storedOtp, normalizedOtp));
        if (isCachedOtpValid) {
            const consumed = await this.redisSecurity.consumeOnce(`2FA:${userId}`);
            isCachedOtpValid = Boolean(consumed && timingSafeEqualStr(consumed, normalizedOtp));
        }

        let isTotpValid = false;
        if (!isCachedOtpValid && user.isTwoFactorConfirmed && user.twoFactorSecret) {
            const decryptedSecret = this.decryptTwoFactorSecret(user.twoFactorSecret, userId);
            isTotpValid = verifySync({
                token: normalizedOtp,
                secret: decryptedSecret,
            }).valid;
        }

        if (isCachedOtpValid || isTotpValid) {
            await this.redisSecurity.deleteKey(`2FA:${userId}`);
            await this.redisSecurity.deleteKey(`2fa_failures:${userId}`);
            await this.redisSecurity.deleteKey(lockoutKey);
            await this.redisSecurity.deleteKey(`2fa_multiplier:${userId}`);
            await this.redisSecurity.deleteKey(`2fa_code_request_limit:${userId}`);

            await this.auditLogService.log(
                userId,
                '2FA_VERIFICATION_SUCCESS',
                { type: isCachedOtpValid ? 'BACKUP_OTP' : 'TOTP', ip, userAgent },
                ip,
                userAgent,
            );
            return this.generateAuthResponse(user, ip, userAgent, true);
        }

        const failuresKey = `2fa_failures:${userId}`;
        const { count: failures } = await this.redisSecurity.incrementWithWindow(failuresKey, 300000);

        if (failures >= 6) {
            const multiplierKey = `2fa_multiplier:${userId}`;
            const rawM = await this.redisSecurity.getValue(multiplierKey);
            const m = Math.max(1, Math.min(Number(rawM || '1') || 1, 64));
            const lockoutTimeMs = 5 * m * 60 * 1000;

            await this.redisSecurity.setValue(lockoutKey, '1', lockoutTimeMs);
            await this.redisSecurity.setValue(multiplierKey, String(m * 2), 86400000);
            await this.redisSecurity.deleteKey(failuresKey);

            await this.auditLogService.log(
                userId,
                '2FA_LOCKOUT_TRIGGERED',
                { ip, userAgent, multiplier: m },
                ip,
                userAgent,
            );
            throw new HttpException(
                `Limite de 6 tentativas de 2FA excedido. Verificação bloqueada por ${5 * m} minutos.`,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        } else {
            await this.auditLogService.log(
                userId,
                '2FA_VERIFICATION_FAILED',
                { ip, userAgent, failures },
                ip,
                userAgent,
            );
            throw new BadRequestException(`Código 2FA inválido. Tentativa ${failures} de 6.`);
        }
    }

    async resend2fa(twoFactorToken: string, ip?: string, userAgent?: string) {
        if (!twoFactorToken) {
            throw new BadRequestException('Token de 2FA é obrigatório');
        }

        let payload: any;
        try {
            payload = this.jwtService.verify(twoFactorToken, {
                secret: getTwoFactorJwtSecret(this.configService),
            });
        } catch (e) {
            throw new UnauthorizedException('Token de verificação 2FA expirado ou inválido');
        }

        if (!payload || !payload.id || !payload.isTwoFactorPending) {
            throw new UnauthorizedException('Token de verificação 2FA inválido');
        }

        const userId = payload.id;

        const user = await this.usersService.findOneById(userId);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }

        if (user.isBlocked) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.FORBIDDEN,
                    message: 'Acesso bloqueado. Por favor, recupere sua conta.',
                    error: 'Blocked Account',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        const requestLimitKey = `2fa_code_request_limit:${user.id}`;
        const isLimitActive = await this.redisSecurity.getValue(requestLimitKey);
        if (isLimitActive) {
            throw new HttpException(
                'Um código de verificação já foi enviado recentemente. Por favor, aguarde 5 minutos antes de solicitar um novo.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const otp = this.generateOtp();
        await this.redisSecurity.setValue(`2FA:${user.id}`, otp, 300000);
        await this.redisSecurity.setValue(requestLimitKey, '1', 300000);

        await this.emailProducer.enqueue(user.email, 'OTP_CODE', {
            otp,
            userName: user.name || undefined,
            expiresInMinutes: 5,
            purpose: 'TWO_FACTOR',
        });

        await this.auditLogService.log(
            user.id,
            '2FA_RESEND_REQUESTED',
            { ip, userAgent },
            ip,
            userAgent,
        );

        return {
            success: true,
            message: 'Código de verificação enviado para o seu e-mail.',
        };
    }

    async saveOnboardingSurvey(userId: string, surveyData: any) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new NotFoundException('Usuário não encontrado');

        user.surveyAnswers = surveyData;
        user.onboardingCompleted = true;
        user.lastActiveAt = new Date();
        user.lastActionType = 'onboarding';
        user.lastActionLabel = 'Concluiu questionário de onboarding';
        user.lastActionPath = '/onboarding';
        await this.usersService.update(user);

        return { success: true, onboardingCompleted: true };
    }

    async setTwoFactor(
        userId: string,
        enabled: boolean,
        verification?: { code?: string; password?: string },
    ) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new NotFoundException('Usuário não encontrado');

        if (!enabled && user.twoFactorEnabled) {
            const disableAttemptsKey = `2fa_disable_attempts:${userId}`;
            const rateCheck = await this.redisSecurity.incrementWithWindow(
                disableAttemptsKey,
                900,
            );
            if (rateCheck.count > 5) {
                throw new HttpException(
                    'Muitas tentativas de desativar 2FA. Aguarde 15 minutos antes de tentar novamente.',
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }

            const cleanCode = String(verification?.code || '').trim();
            const rawPassword = typeof verification?.password === 'string' ? verification.password : '';

            let codeValid = false;
            if (cleanCode) {
                if (user.twoFactorSecret) {
                    const decryptedSecret = this.decryptTwoFactorSecret(user.twoFactorSecret);
                    codeValid = verifySync({
                        token: cleanCode,
                        secret: decryptedSecret,
                    }).valid;
                }
                if (!codeValid) {
                    const storedOtp = await this.redisSecurity.getValue(`2FA:${userId}`);
                    if (storedOtp && timingSafeEqualStr(storedOtp, cleanCode)) {
                        const consumed = await this.redisSecurity.consumeOnce(`2FA:${userId}`);
                        codeValid = Boolean(consumed && timingSafeEqualStr(consumed, cleanCode));
                    }
                }
            }

            const requiresPassword = Boolean(user.passwordHash);
            const passwordValid = requiresPassword
                ? Boolean(rawPassword && (await verifyPasswordSecure(rawPassword, user.passwordHash)))
                : true;

            if (!codeValid || !passwordValid) {
                throw new BadRequestException(
                    requiresPassword
                        ? 'Para desativar o 2FA, informe o código TOTP/OTP válido E a sua senha atual.'
                        : 'Para desativar o 2FA, informe um código TOTP/OTP válido.',
                );
            }

            user.twoFactorEnabled = false;
            user.isTwoFactorConfirmed = false;
            user.twoFactorSecret = null;
            await this.usersService.update(user);
            await this.usersService.invalidateAuthGuardCache(userId);
            await this.auditLogService.log(userId, '2FA_DISABLED', {});
            return { success: true, enabled: false };
        }

        user.twoFactorEnabled = enabled;
        await this.usersService.update(user);
        await this.usersService.invalidateAuthGuardCache(userId);

        return { success: true, enabled: user.twoFactorEnabled };
    }

    private async createDefaultAccount(userId: string, forcedToken?: string) {
        const user = await this.usersService.findOneById(userId);
        const token = forcedToken || (user ? user.apiToken : crypto.randomUUID().toUpperCase());

        const account = this.accountRepository.create({
            userId: userId,
            appToken: token,
            mt5Id: null,
            balance: 0,
            equity: 0,
            isConnected: false,
        });
        return this.accountRepository.save(account);
    }
}
