import { Injectable, UnauthorizedException, ConflictException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { CryptoUtil } from '../common/utils/crypto.util';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity } from '../account/account.entity';
import { Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PlanPermissionService } from '../payment/plan-permission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../notifications/sms.service';
import { SmsTemplates } from '../notifications/sms-templates';
import { AuditLogService } from './audit-log.service';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as qrcode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { SessionEntity } from './session.entity';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        @InjectRepository(AccountEntity)
        private accountRepository: Repository<AccountEntity>,
        @InjectRepository(SessionEntity)
        private sessionRepository: Repository<SessionEntity>,
        @InjectQueue('email-queue') private emailQueue: Queue,
        @Inject(CACHE_MANAGER) private cacheManager: any,
        private planPermissionService: PlanPermissionService,
        private smsService: SmsService,
        private notificationsService: NotificationsService,
        private auditLogService: AuditLogService,
        private configService: ConfigService,
    ) { }

    async validateUser(email: string, pass: string): Promise<any> {
        const user = await this.usersService.findOneByEmail(email);
        if (user && user.passwordHash && (await bcrypt.compare(pass, user.passwordHash))) {
            const { passwordHash, ...result } = user;
            return result;
        }
        return null;
    }

    async authenticateAndLogin(email: string, pass: string, ip?: string, userAgent?: string) {
        if (!email || !pass) {
            throw new BadRequestException('E-mail e senha são obrigatórios');
        }

        const user = await this.usersService.findOneByEmail(email);
        if (user && user.isBlocked) {
            throw new HttpException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'Esta conta foi bloqueada devido a 9 tentativas falhas de login. Por favor, utilize o link de recuperação enviado ao seu e-mail para redefinir sua senha.',
                error: 'Blocked Account'
            }, HttpStatus.FORBIDDEN);
        }

        const lockoutKey = `login_lockout:${email}`;
        const lockoutType = await this.cacheManager.get(lockoutKey);
        if (lockoutType) {
            throw new HttpException({
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                message: 'Múltiplas tentativas falhas. Acesso temporariamente bloqueado. Por favor, aguarde.',
                error: 'Too Many Requests'
            }, HttpStatus.TOO_MANY_REQUESTS);
        }

        const isPasswordCorrect = user && user.passwordHash && (await bcrypt.compare(pass, user.passwordHash));

        if (!isPasswordCorrect) {
            const failureKey = `login_failures:${email}`;
            let failures = (await this.cacheManager.get(failureKey)) || 0;
            failures += 1;
            await this.cacheManager.set(failureKey, failures, 86400000);

            if (failures >= 9) {
                if (user) {
                    user.isBlocked = true;
                    await this.usersService.update(user);
                    
                    const recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
                    const rawPayload = JSON.stringify({ email, code: recoveryCode, timestamp: Date.now() });
                    const token = CryptoUtil.encrypt(rawPayload, this.configService.get<string>('JWT_SECRET'));
                    const sig = crypto.createHmac('sha256', this.configService.get<string>('JWT_SECRET')).update(token).digest('hex');
                    
                    await this.emailQueue.add('general-notification', {
                        email: user.email,
                        userName: user.name || 'Trader',
                        title: 'Recuperação de Acesso',
                        subtitle: 'CONTA BLOQUEADA',
                        message: `Sua conta foi bloqueada devido a 9 tentativas falhas de login. Use o código abaixo para redefinir sua senha e reativar seu acesso:\n\n👉 **${recoveryCode}** 👈`,
                        buttonUrl: `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001'}/login?recover=true&email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}&sig=${sig}`,
                        buttonLabel: 'Ir para a Página de Login'
                    }, { removeOnComplete: true });
                }
                await this.cacheManager.del(failureKey);
                throw new HttpException({
                    statusCode: HttpStatus.FORBIDDEN,
                    message: 'Sua conta foi bloqueada devido a 9 tentativas falhas de login. Um código de recuperação foi enviado para seu e-mail.',
                    error: 'Account Blocked'
                }, HttpStatus.FORBIDDEN);
            } else if (failures === 6) {
                await this.cacheManager.set(lockoutKey, '6_attempts', 300000);
                throw new HttpException({
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message: 'Credenciais inválidas. Cooldown de 5 minutos ativado devido a 6 tentativas falhas.',
                    error: 'Too Many Requests'
                }, HttpStatus.TOO_MANY_REQUESTS);
            } else if (failures === 3) {
                await this.cacheManager.set(lockoutKey, '3_attempts', 15000);
                throw new HttpException({
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message: 'Credenciais inválidas. Cooldown de 15 segundos ativado devido a 3 tentativas falhas.',
                    error: 'Too Many Requests'
                }, HttpStatus.TOO_MANY_REQUESTS);
            } else {
                throw new UnauthorizedException(`Credenciais inválidas. Tentativa ${failures} de 9.`);
            }
        }

        await this.cacheManager.del(`login_failures:${email}`);
        await this.cacheManager.del(lockoutKey);

        const { passwordHash, ...result } = user;
        return this.login(result, ip, userAgent);
    }

    async login(user: any, ip?: string, userAgent?: string) {
        let updated = false;
        if (!user.apiToken) {
            user.apiToken = crypto.randomUUID().toUpperCase();
            updated = true;
        }

        const existingAccount = await this.accountRepository.findOne({ where: { userId: user.id } });
        if (!existingAccount) {
            await this.createDefaultAccount(user.id);
        }

        if (updated) {
            await this.usersService.update(user);
        }

        const requestLimitKey = `2fa_code_request_limit:${user.id}`;

        // --- 2FA INTERCEPTION ---
        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            await this.auditLogService.log(user.id, 'LOGIN_2FA_REQUIRED', { ip, userAgent }, ip, userAgent);
            
            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' }
            );

            const isLimitActive = await this.cacheManager.get(requestLimitKey);
            if (isLimitActive) {
                return {
                    success: true,
                    twoFactorRequired: true,
                    twoFactorType: 'TOTP',
                    twoFactorToken: temporaryToken,
                    hasWhatsAppBackup: true,
                    message: 'Um código de verificação já foi enviado recentemente. Use o código ativo ou aguarde 5 minutos.'
                };
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            await this.cacheManager.set(`2FA:${user.id}`, otp, 300000); // 5 mins
            await this.cacheManager.set(requestLimitKey, true, 300000); // 5 mins request cooldown
            
            await this.emailQueue.add('otp-alert', {
                email: user.email,
                otp
            }, { removeOnComplete: true });

            await this.notificationsService.send2FA(user.id, otp).catch(() => {});
            
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorType: 'TOTP',
                twoFactorToken: temporaryToken,
                hasWhatsAppBackup: true
            };
        }

        if (user.twoFactorEnabled) {
            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' }
            );

            const isLimitActive = await this.cacheManager.get(requestLimitKey);
            if (isLimitActive) {
                return {
                    success: true,
                    twoFactorRequired: true,
                    twoFactorType: 'EMAIL',
                    twoFactorToken: temporaryToken,
                    message: 'Um código de verificação já foi enviado recentemente. Use o código ativo ou aguarde 5 minutos.'
                };
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            await this.cacheManager.set(`2FA:${user.id}`, otp, 300000);
            await this.cacheManager.set(requestLimitKey, true, 300000); // 5 mins request cooldown

            await this.emailQueue.add('otp-alert', {
                email: user.email,
                otp
            }, { removeOnComplete: true });

            await this.notificationsService.send2FA(user.id, otp).catch(() => {});

            await this.auditLogService.log(user.id, 'LOGIN_2FA_REQUIRED_EMAIL', { ip, userAgent }, ip, userAgent);
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorType: 'EMAIL',
                twoFactorToken: temporaryToken
            };
        }

        return this.generateAuthResponse(user, ip, userAgent, false);
    }

    private async generateAuthResponse(user: any, ip?: string, userAgent?: string, isTwoFactorVerified = false) {
        const payload = { email: user.email, id: user.id, isTwoFactorVerified };
        const accessToken = this.jwtService.sign(payload);
        const refreshToken = crypto.randomUUID();

        // Store refresh token
        await this.usersService.updateRefreshToken(user.id, refreshToken);

        // Persist session token in Database
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // 24h expiration

        await this.sessionRepository.save({
            userId: user.id,
            token: accessToken,
            userAgent,
            ipAddress: ip,
            expiresAt,
            isActive: true
        });

        // Cache session status in Redis
        await this.cacheManager.set(`user_session:${accessToken}`, 'active', 24 * 60 * 60 * 1000);

        await this.auditLogService.log(user.id, 'LOGIN_SUCCESS', { ip, userAgent }, ip, userAgent);

        // Dispatch Login Alert (Async)
        await this.emailQueue.add('login-alert', {
            email: user.email,
            name: user.name,
            ip: ip || 'Unknown IP',
            device: userAgent || 'Unknown Device',
            time: new Date().toLocaleString('pt-BR', { timeZone: 'Africa/Maputo' })
        }, { removeOnComplete: true });

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
                onboardingCompleted: user.onboardingCompleted
            }
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
            await this.auditLogService.log(null, 'REFRESH_TOKEN_INVALID', { refreshToken, ip, userAgent }, ip, userAgent);
            throw new UnauthorizedException('Token de atualização inválido');
        }

        await this.auditLogService.log(user.id, 'REFRESH_TOKEN_SUCCESS', { ip, userAgent }, ip, userAgent);
        return this.generateAuthResponse(user, ip, userAgent, user.twoFactorEnabled && user.isTwoFactorConfirmed);
    }

    async sendOtp(email: string) {
        if (await this.usersService.findOneByEmail(email)) {
            throw new ConflictException('Email already registered');
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // 10 minutes = 600000 ms (or seconds depending on version, cache-manager v5 uses ms)
        await this.cacheManager.set(`OTP:${email}`, otp, 600000);

        await this.emailQueue.add('otp-alert', {
            email,
            otp
        }, { removeOnComplete: true });

        return { success: true, message: 'OTP sent successfully' };
    }

    async forgotPassword(email: string) {
        const user = await this.usersService.findOneByEmail(email);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }

        const requestLimitKey = `forgot_password_request_limit:${email}`;
        const isLimited = await this.cacheManager.get(requestLimitKey);
        if (isLimited) {
            throw new HttpException(
                'Um código de verificação já foi enviado recentemente. Por favor, aguarde 5 minutos antes de solicitar um novo.',
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const rawPayload = JSON.stringify({ email, code, timestamp: Date.now() });
        const secret = this.configService.get<string>('JWT_SECRET') || 'dev_secret';
        const token = CryptoUtil.encrypt(rawPayload, secret);
        const sig = crypto.createHmac('sha256', secret).update(token).digest('hex');

        await this.cacheManager.set(requestLimitKey, true, 300000); // 5 mins

        await this.emailQueue.add('general-notification', {
            email: user.email,
            userName: user.name || 'Trader',
            title: 'Recuperação de Senha',
            subtitle: 'CÓDIGO DE RECUPERAÇÃO',
            message: `Você solicitou a redefinição de sua senha. Use o código abaixo para redefinir sua senha:\n\n👉 **${code}** 👈`,
            buttonUrl: `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001'}/login?recover=true&email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}&sig=${sig}`,
            buttonLabel: 'Ir para a Página de Login'
        }, { removeOnComplete: true });

        return {
            success: true,
            message: 'Código de recuperação enviado com sucesso.',
            token,
            sig
        };
    }

    async resetPassword(body: any) {
        const { email, code, token, sig, newPassword } = body;
        if (!email || !code || !token || !sig || !newPassword) {
            throw new BadRequestException('Parâmetros de redefinição inválidos');
        }

        const secret = this.configService.get<string>('JWT_SECRET') || 'dev_secret';
        const expectedSig = crypto.createHmac('sha256', secret).update(token).digest('hex');
        if (sig !== expectedSig) {
            throw new BadRequestException('Assinatura do token inválida');
        }

        let payload;
        try {
            const decrypted = CryptoUtil.decrypt(token, secret);
            payload = JSON.parse(decrypted);
        } catch (e) {
            throw new BadRequestException('Token de recuperação inválido ou corrompido');
        }

        if (payload.email !== email) {
            throw new BadRequestException('O e-mail informado não corresponde ao token de redefinição');
        }

        // 15 minutes expiration
        if (Date.now() - payload.timestamp > 15 * 60 * 1000) {
            throw new BadRequestException('Token de recuperação expirado');
        }

        const attemptKey = `forgot_password_attempts:${email}`;
        let attempts = (await this.cacheManager.get(attemptKey)) || 0;
        if (attempts >= 6) {
            throw new HttpException(
                'Excedeu o limite de 6 tentativas de verificação. Por favor, solicite um novo código após 5 minutos.',
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        if (payload.code !== code) {
            attempts += 1;
            await this.cacheManager.set(attemptKey, attempts, 300000); // 5 mins
            if (attempts >= 6) {
                await this.cacheManager.set(`forgot_password_request_limit:${email}`, true, 300000);
                throw new HttpException(
                    'Código incorreto. Limite de 6 tentativas excedido. Você deve aguardar 5 minutos para solicitar um novo código.',
                    HttpStatus.TOO_MANY_REQUESTS
                );
            }
            throw new BadRequestException(`Código de recuperação inválido. Tentativa ${attempts} de 6.`);
        }

        const user = await this.usersService.findOneByEmail(email);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }

        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(newPassword, salt);
        user.isBlocked = false; // unlock user if they were locked
        await this.usersService.update(user);

        await this.cacheManager.del(attemptKey);
        await this.cacheManager.del(`login_failures:${email}`);
        await this.cacheManager.del(`forgot_password_request_limit:${email}`);

        return { success: true, message: 'Senha redefinida com sucesso. Sua conta foi desbloqueada.' };
    }

    async register(data: any) {
        if (!data.otp) {
            throw new BadRequestException('OTP is required');
        }

        const storedOtp = await this.cacheManager.get(`OTP:${data.email}`);
        if (!storedOtp || storedOtp !== data.otp) {
            throw new BadRequestException('Invalid or expired OTP');
        }

        if (await this.usersService.findOneByEmail(data.email)) {
            throw new ConflictException('Email already registered');
        }

        // Delete OTP after usage
        await this.cacheManager.del(`OTP:${data.email}`);

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(data.password, salt);

        const newUser = await this.usersService.create({
            name: data.name,
            email: data.email,
            passwordHash: passwordHash,
            whatsapp: data.contact || data.whatsapp,
            apiToken: crypto.randomUUID().toUpperCase()
        });

        await this.auditLogService.log(newUser.id, 'USER_REGISTERED', { email: newUser.email });

        // Create default Account
        await this.createDefaultAccount(newUser.id);

        // Dispatch Welcome Email
        await this.emailQueue.add('welcome', {
            email: newUser.email,
            name: newUser.name
        }, { removeOnComplete: true });

        // Dispatch Welcome SMS (Systemic)
        if (newUser.whatsapp) {
            await this.smsService.sendSms(
                newUser.id, 
                newUser.whatsapp, 
                SmsTemplates.WELCOME(newUser.name),
                true // isSystemic
            );
        }

        const payload = { email: newUser.email, id: newUser.id };
        const planTier = await this.planPermissionService.getUserPlan(newUser.id);

        return {
            success: true,
            message: 'User registered successfully',
            token: this.jwtService.sign(payload),
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                api_token: newUser.apiToken,
                tier: planTier,
                onboardingCompleted: false
            }
        };
    }



    async regenerateToken(userId: string) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new UnauthorizedException();

        const newToken = crypto.randomUUID().toUpperCase();
        user.apiToken = newToken;
        await this.usersService.update(user);

        // Sync with AccountEntity
        const account = await this.accountRepository.findOne({ where: { userId } });
        if (account) {
            account.appToken = newToken;
            await this.accountRepository.save(account);
        } else {
            // Should verify if we need to create one, but for now just sync if exists is fine
            // Or better, create one to be safe if missing
            await this.createDefaultAccount(userId, newToken);
        }

        return {
            success: true,
            message: 'Token regenerated successfully',
            api_token: user.apiToken
        }
    }

    async validateGoogleUser(profile: any) {
        let user = await this.usersService.findOneByGoogleId(profile.googleId);

        if (!user) {
            user = await this.usersService.findOneByEmail(profile.email);
            if (user) {
                // Link Google to existing account
                user.googleId = profile.googleId;
                await this.usersService.update(user);
            } else {
                // Create new social account
                user = await this.usersService.create({
                    email: profile.email,
                    name: profile.name,
                    googleId: profile.googleId,
                    avatarUrl: profile.avatarUrl,
                    apiToken: crypto.randomUUID().toUpperCase(),
                });
                await this.createDefaultAccount(user.id);
            }
        }

        if (user.isBlocked) {
            throw new HttpException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'Esta conta foi bloqueada devido a tentativas falhas de login. Por favor, redefina sua senha.',
                error: 'Blocked Account'
            }, HttpStatus.FORBIDDEN);
        }

        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' }
            );
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorToken: temporaryToken,
                token: null,
                user: null,
                requiresContact: false
            };
        }

        const payload = { email: user.email, id: user.id };
        const token = this.jwtService.sign(payload);

        return {
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                api_token: user.apiToken,
                onboardingCompleted: user.onboardingCompleted
            },
            requiresContact: !user.whatsapp
        };
    }

    async validateGithubUser(profile: any) {
        let user = await this.usersService.findOneByGithubId(profile.githubId);

        if (!user) {
            user = await this.usersService.findOneByEmail(profile.email);
            if (user) {
                // Link Github to existing account
                user.githubId = profile.githubId;
                await this.usersService.update(user);
            } else {
                // Create new social account
                user = await this.usersService.create({
                    email: profile.email,
                    name: profile.name,
                    githubId: profile.githubId,
                    avatarUrl: profile.avatarUrl,
                    apiToken: crypto.randomUUID().toUpperCase(),
                });
                await this.createDefaultAccount(user.id);
            }
        }

        if (user.isBlocked) {
            throw new HttpException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'Esta conta foi bloqueada devido a tentativas falhas de login. Por favor, redefina sua senha.',
                error: 'Blocked Account'
            }, HttpStatus.FORBIDDEN);
        }

        if (user.twoFactorEnabled && user.isTwoFactorConfirmed) {
            const temporaryToken = this.jwtService.sign(
                { id: user.id, email: user.email, isTwoFactorPending: true },
                { expiresIn: '5m' }
            );
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorToken: temporaryToken,
                token: null,
                user: null,
                requiresContact: false
            };
        }

        const payload = { email: user.email, id: user.id };
        const token = this.jwtService.sign(payload);

        return {
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                api_token: user.apiToken,
                onboardingCompleted: user.onboardingCompleted
            },
            requiresContact: !user.whatsapp
        };
    }

    async getAppToken(userId: string) {
        let account = await this.accountRepository.findOne({ where: { userId } });

        if (!account) {
            account = await this.createDefaultAccount(userId);
        }

        if (!account.appToken) {
            account.appToken = crypto.randomUUID().toUpperCase();
            await this.accountRepository.save(account);
        }

        return { token: account.appToken };
    }

    async setupTwoFactor(userId: string) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new NotFoundException('Usuário não encontrado');

        const secret = generateSecret();
        const otpauthUrl = generateURI({
            label: user.email,
            issuer: 'Torex Journal',
            secret
        });
        const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

        // Store secret temporarily but don't confirm yet
        user.twoFactorSecret = secret;
        user.isTwoFactorConfirmed = false;
        await this.usersService.update(user);

        return {
            secret,
            qrCodeDataUrl
        };
    }

    async verifyTwoFactorSetup(userId: string, token: string) {
        const user = await this.usersService.findOneById(userId);
        if (!user || !user.twoFactorSecret) {
            throw new BadRequestException('Setup de 2FA não iniciado');
        }

        const isValid = verifySync({
            token,
            secret: user.twoFactorSecret
        }).valid;

        if (!isValid) {
            throw new BadRequestException('Código 2FA inválido');
        }

        user.isTwoFactorConfirmed = true;
        user.twoFactorEnabled = true;
        await this.usersService.update(user);

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
        const isLockedOut = await this.cacheManager.get(lockoutKey);
        if (isLockedOut) {
            throw new HttpException(
                'Limite de tentativas de 2FA excedido. Verificação bloqueada temporariamente.',
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        const user = await this.usersService.findOneById(userId);
        if (!user) throw new BadRequestException('Usuário não encontrado');

        if (user.isBlocked) {
            throw new HttpException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'Acesso bloqueado. Por favor, recupere sua conta.',
                error: 'Blocked Account'
            }, HttpStatus.FORBIDDEN);
        }

        // Try Cached OTP first (WhatsApp/Email backup)
        const storedOtp = await this.cacheManager.get(`2FA:${userId}`);
        const isCachedOtpValid = storedOtp && storedOtp === otp;

        let isTotpValid = false;
        if (!isCachedOtpValid && user.isTwoFactorConfirmed && user.twoFactorSecret) {
            isTotpValid = verifySync({
                token: otp,
                secret: user.twoFactorSecret
            }).valid;
        }

        if (isCachedOtpValid || isTotpValid) {
            // Success
            await this.cacheManager.del(`2FA:${userId}`);
            await this.cacheManager.del(`2fa_failures:${userId}`);
            await this.cacheManager.del(lockoutKey);
            await this.cacheManager.del(`2fa_multiplier:${userId}`);
            await this.cacheManager.del(`2fa_code_request_limit:${userId}`);

            await this.auditLogService.log(
                userId,
                '2FA_VERIFICATION_SUCCESS',
                { type: isCachedOtpValid ? 'BACKUP_OTP' : 'TOTP', ip, userAgent },
                ip,
                userAgent
            );
            return this.generateAuthResponse(user, ip, userAgent, true);
        }

        // Fail
        const failuresKey = `2fa_failures:${userId}`;
        let failures = (await this.cacheManager.get(failuresKey)) || 0;
        failures += 1;

        if (failures >= 6) {
            const multiplierKey = `2fa_multiplier:${userId}`;
            let m = (await this.cacheManager.get(multiplierKey)) || 1;
            const lockoutTimeMs = 5 * m * 60 * 1000;

            await this.cacheManager.set(lockoutKey, true, lockoutTimeMs);
            await this.cacheManager.set(multiplierKey, m * 2, 86400000); // preserve multiplier for 24h
            await this.cacheManager.del(failuresKey);

            await this.auditLogService.log(userId, '2FA_LOCKOUT_TRIGGERED', { ip, userAgent, multiplier: m }, ip, userAgent);
            throw new HttpException(
                `Limite de 6 tentativas de 2FA excedido. Verificação bloqueada por ${5 * m} minutos.`,
                HttpStatus.TOO_MANY_REQUESTS
            );
        } else {
            await this.cacheManager.set(failuresKey, failures, 300000); // 5 mins TTL
            await this.auditLogService.log(userId, '2FA_VERIFICATION_FAILED', { ip, userAgent, failures }, ip, userAgent);
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
            throw new HttpException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'Acesso bloqueado. Por favor, recupere sua conta.',
                error: 'Blocked Account'
            }, HttpStatus.FORBIDDEN);
        }

        const requestLimitKey = `2fa_code_request_limit:${user.id}`;
        const isLimitActive = await this.cacheManager.get(requestLimitKey);
        if (isLimitActive) {
            throw new HttpException(
                'Um código de verificação já foi enviado recentemente. Por favor, aguarde 5 minutos antes de solicitar um novo.',
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await this.cacheManager.set(`2FA:${user.id}`, otp, 300000); // 5 mins
        await this.cacheManager.set(requestLimitKey, true, 300000); // 5 mins request cooldown

        // Always send email OTP
        await this.emailQueue.add('otp-alert', {
            email: user.email,
            otp
        }, { removeOnComplete: true });

        // Also send WhatsApp if available
        await this.notificationsService.send2FA(user.id, otp).catch(() => {});

        await this.auditLogService.log(user.id, '2FA_RESEND_REQUESTED', { ip, userAgent }, ip, userAgent);

        return {
            success: true,
            message: 'Código de verificação enviado para o seu e-mail.'
        };
    }

    async saveOnboardingSurvey(userId: string, surveyData: any) {
        const user = await this.usersService.findOneById(userId);
        if (!user) throw new NotFoundException('Usuário não encontrado');

        user.surveyAnswers = surveyData;
        user.onboardingCompleted = true;
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
            isConnected: false
        });
        return this.accountRepository.save(account);
    }
}
