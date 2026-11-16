import {
    Injectable,
    UnauthorizedException,
    ConflictException,
    NotFoundException,
    HttpException,
    HttpStatus,
    Inject,
    BadRequestException,
    Optional,
} from '@nestjs/common';
import { CryptoUtil } from '../common/utils/crypto.util';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity } from '../account/account.entity';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EmailProducerService } from '../email/email-producer.service';
import { resolveFrontendUrl } from '../email/templates';
import { PlanPermissionService } from '../payment/plan-permission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../notifications/sms.service';
import { SmsTemplates } from '../notifications/sms-templates';
import { AuditLogService } from './audit-log.service';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as qrcode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { SessionEntity } from './session.entity';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { getJwtSecret, timingSafeEqualStr } from '../common/security/security.config';
import { resolveAcquisitionFields, sanitizeAttributionPayload } from '../users/users.service';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class AuthService {
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
        private smsService: SmsService,
        private notificationsService: NotificationsService,
        private auditLogService: AuditLogService,
        private configService: ConfigService,
        private redisSecurity: RedisSecurityService,
        @Optional() private analyticsService?: AnalyticsService,
    ) {}

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
        if (user && user.passwordHash && (await bcrypt.compare(pass, user.passwordHash))) {
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
            user && user.passwordHash && (await bcrypt.compare(pass, user.passwordHash));

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
                    const secret = getJwtSecret(this.configService);
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
        let updated = false;
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

        const requestLimitKey = `2fa_code_request_limit:${user.id}`;

        // --- 2FA INTERCEPTION ---
        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            await this.auditLogService.log(
                user.id,
                'LOGIN_2FA_REQUIRED',
                { ip, userAgent },
                ip,
                userAgent,
            );

            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' },
            );

            const isLimitActive = await this.redisSecurity.getValue(requestLimitKey);
            if (isLimitActive) {
                return {
                    success: true,
                    twoFactorRequired: true,
                    twoFactorType: 'TOTP',
                    twoFactorToken: temporaryToken,
                    hasWhatsAppBackup: true,
                    message:
                        'Um código de verificação já foi enviado recentemente. Use o código ativo ou aguarde 5 minutos.',
                };
            }

            const otp = this.generateOtp();
            await this.redisSecurity.setValue(`2FA:${user.id}`, otp, 300000); // 5 mins
            await this.redisSecurity.setValue(requestLimitKey, '1', 300000);

            await this.emailProducer.enqueue(user.email, 'OTP_CODE', {
                otp,
                userName: user.name || undefined,
                expiresInMinutes: 5,
                purpose: 'TWO_FACTOR',
            });

            await this.notificationsService.send2FA(user.id, otp).catch(() => {});

            return {
                success: true,
                twoFactorRequired: true,
                twoFactorType: 'TOTP',
                twoFactorToken: temporaryToken,
                hasWhatsAppBackup: true,
            };
        }

        if (user.twoFactorEnabled) {
            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' },
            );

            const isLimitActive = await this.redisSecurity.getValue(requestLimitKey);
            if (isLimitActive) {
                return {
                    success: true,
                    twoFactorRequired: true,
                    twoFactorType: 'EMAIL',
                    twoFactorToken: temporaryToken,
                    message:
                        'Um código de verificação já foi enviado recentemente. Use o código ativo ou aguarde 5 minutos.',
                };
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

            await this.notificationsService.send2FA(user.id, otp).catch(() => {});

            await this.auditLogService.log(
                user.id,
                'LOGIN_2FA_REQUIRED_EMAIL',
                { ip, userAgent },
                ip,
                userAgent,
            );
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorType: 'EMAIL',
                twoFactorToken: temporaryToken,
            };
        }

        return this.generateAuthResponse(user, ip, userAgent, false);
    }

    private async generateAuthResponse(
        user: any,
        ip?: string,
        userAgent?: string,
        isTwoFactorVerified = false,
        options: { skipLoginAlert?: boolean } = {},
    ) {
        const payload = { email: user.email, id: user.id, isTwoFactorVerified };
        const accessToken = this.jwtService.sign(payload);
        const refreshToken = crypto.randomUUID();

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

        await this.cacheManager.set(`user_session:${accessToken}`, 'active', 24 * 60 * 60 * 1000);

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
                api_token: user.apiToken,
                tier: planTier,
                onboardingCompleted: user.onboardingCompleted,
            },
        };
    }

    async logout(token: string) {
        if (!token) return;
        await this.sessionRepository.update({ token }, { isActive: false });
        await this.cacheManager.del(`user_session:${token}`).catch(() => {});
    }

    async refresh(refreshToken: string, ip?: string, userAgent?: string) {
        const user = await this.usersService.findOneByRefreshToken(refreshToken);
        if (!user) {
            await this.auditLogService.log(
                null,
                'REFRESH_TOKEN_INVALID',
                { tokenHashPrefix: this.sha256(refreshToken || '').slice(0, 12), ip, userAgent },
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
            user.twoFactorEnabled && user.isTwoFactorConfirmed,
            { skipLoginAlert: true },
        );
    }

    async sendOtp(email: string) {
        const normalizedEmail = this.normalizeEmail(email);
        if (await this.usersService.findOneByEmail(normalizedEmail)) {
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

        await this.emailProducer.enqueue(normalizedEmail, 'OTP_CODE', {
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
        const secret = getJwtSecret(this.configService);
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

        const attemptKey = `forgot_password_attempts:${email}`;
        const currentAttempts = Number((await this.redisSecurity.getValue(attemptKey)) || '0');
        if (currentAttempts >= 6) {
            throw new HttpException(
                'Excedeu o limite de 6 tentativas de verificação. Por favor, solicite um novo código após 5 minutos.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const secret = getJwtSecret(this.configService);
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

            const consumed = await this.redisSecurity.consumeOnce(`pwd_reset:${email}`);
            if (!consumed) {
                throw new BadRequestException('Código de recuperação já utilizado ou expirado');
            }
            verifiedResetId = stored.resetId;
        }

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

        const user = await this.usersService.findOneByEmail(email);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }

        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(newPassword, salt);
        user.isBlocked = false;
        user.refreshToken = null as any;
        await this.usersService.update(user);
        await this.usersService.invalidateAuthGuardCache(user.id);

        // Revoke all active user sessions so stolen JWTs cannot persist across password resets
        const activeSessions = await this.sessionRepository.find({
            where: { userId: user.id, isActive: true },
            select: ['id', 'token'],
        });
        if (activeSessions.length > 0) {
            await this.sessionRepository.update({ userId: user.id, isActive: true }, { isActive: false });
            await Promise.all(
                activeSessions.map((s) => this.cacheManager.del(`user_session:${s.token}`).catch(() => {})),
            );
        }

        await this.redisSecurity.deleteKey(attemptKey);
        await this.redisSecurity.deleteKey(`login_failures:${email}`);
        await this.redisSecurity.deleteKey(`login_lockout:${email}`);
        await this.redisSecurity.deleteKey(`forgot_password_request_limit:${email}`);

        return {
            success: true,
            message: 'Senha redefinida com sucesso. Sua conta foi desbloqueada.',
        };
    }

    async register(data: any, ip?: string, userAgent?: string) {
        const email = this.normalizeEmail(data?.email);
        const otp = typeof data?.otp === 'string' ? data.otp.trim() : '';
        if (!email || !otp) {
            throw new BadRequestException('OTP is required');
        }

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

        if (await this.usersService.findOneByEmail(email)) {
            throw new ConflictException('Email already registered');
        }

        // Consume OTP atomically to prevent concurrent duplicate registration with the same code
        const consumed = await this.redisSecurity.consumeOnce(`OTP:${email}`);
        if (!consumed) {
            throw new BadRequestException('Invalid or expired OTP');
        }
        await this.redisSecurity.deleteKey(failKey);

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(data.password, salt);

        const preferredLocale = data.preferredLocale === 'en' ? 'en' : 'pt';
        const timezone =
            typeof data.timezone === 'string' && data.timezone.trim()
                ? data.timezone.trim().slice(0, 64)
                : undefined;
        const attributionData = sanitizeAttributionPayload(data.attributionData);
        const resolvedAcq = resolveAcquisitionFields(attributionData || data.attributionData, data.visitorId);

        let newUser: any;
        try {
            newUser = await this.usersService.create({
                name: data.name,
                email,
                passwordHash: passwordHash,
                whatsapp: data.contact || data.whatsapp,
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

        if (resolvedAcq.visitorId) {
            void this.analyticsService?.identifyVisitor(newUser.id, resolvedAcq.visitorId, attributionData);
        }
        void this.analyticsService?.recordAuthOrBillingConversion({
            eventName: 'signup',
            userId: newUser.id,
            email: newUser.email,
            visitorId: resolvedAcq.visitorId,
            attributionData,
            metadata: { method: 'email_otp' },
        });

        await this.auditLogService.log(newUser.id, 'USER_REGISTERED', { email: newUser.email });

        await this.createDefaultAccount(newUser.id);

        await this.emailProducer.enqueue(
            newUser.email,
            'WELCOME_EMAIL',
            { userName: newUser.name || undefined },
            { jobId: `welcome:${newUser.id}` },
        );

        if (newUser.whatsapp) {
            await this.smsService.sendSms(
                newUser.id,
                newUser.whatsapp,
                SmsTemplates.WELCOME(newUser.name),
                true,
            );
        }

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

        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' },
            );
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorToken: temporaryToken,
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

        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' },
            );
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorToken: temporaryToken,
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

    private getTwoFactorEncryptionKey(): string {
        return (
            this.configService.get<string>('TWO_FACTOR_ENCRYPTION_KEY') ||
            getJwtSecret(this.configService)
        );
    }

    private encryptTwoFactorSecret(secret: string): string {
        return CryptoUtil.encrypt(secret, this.getTwoFactorEncryptionKey());
    }

    private decryptTwoFactorSecret(storedSecret: string): string {
        if (!storedSecret) return storedSecret;
        if (storedSecret.includes(':')) {
            return CryptoUtil.decrypt(storedSecret, this.getTwoFactorEncryptionKey());
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

        user.twoFactorSecret = this.encryptTwoFactorSecret(secret);
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

        const decryptedSecret = this.decryptTwoFactorSecret(user.twoFactorSecret);
        const isValid = verifySync({
            token,
            secret: decryptedSecret,
        }).valid;

        if (!isValid) {
            throw new BadRequestException('Código 2FA inválido');
        }

        // Re-encrypt legacy plaintext secrets transparently upon confirmation
        if (!user.twoFactorSecret.includes(':')) {
            user.twoFactorSecret = this.encryptTwoFactorSecret(decryptedSecret);
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
            payload = this.jwtService.verify(twoFactorToken);
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
            const decryptedSecret = this.decryptTwoFactorSecret(user.twoFactorSecret);
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
            payload = this.jwtService.verify(twoFactorToken);
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

        await this.notificationsService.send2FA(user.id, otp).catch(() => {});

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

    async setTwoFactor(userId: string, enabled: boolean) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new NotFoundException('Usuário não encontrado');

        user.twoFactorEnabled = enabled;
        await this.usersService.update(user);

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
