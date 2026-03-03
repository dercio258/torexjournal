import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
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

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        @InjectRepository(AccountEntity)
        private accountRepository: Repository<AccountEntity>,
        @InjectQueue('email-queue') private emailQueue: Queue,
        @Inject(CACHE_MANAGER) private cacheManager: any,
    ) { }

    async validateUser(email: string, pass: string): Promise<any> {
        const user = await this.usersService.findOneByEmail(email);
        if (user && (await bcrypt.compare(pass, user.passwordHash))) {
            const { passwordHash, ...result } = user;
            return result;
        }
        return null;
    }

    async login(user: any, ip?: string, userAgent?: string) {
        const payload = { email: user.email, id: user.id };

        // Auto-fix: Ensure user has API Token
        let updated = false;
        if (!user.apiToken) {
            user.apiToken = crypto.randomUUID().toUpperCase();
            updated = true;
        }

        // Check if account exists, create if not (Legacy parity)
        const existingAccount = await this.accountRepository.findOne({ where: { userId: user.id } });
        if (!existingAccount) {
            await this.createDefaultAccount(user.id);
        }

        if (updated) {
            await this.usersService.update(user);
        }

        // Dispatch Login Alert (Async)
        await this.emailQueue.add('login-alert', {
            email: user.email,
            name: user.name,
            ip: ip || 'Unknown IP',
            device: userAgent || 'Unknown Device',
            time: new Date().toLocaleString('pt-BR', { timeZone: 'Africa/Maputo' })
        }, { removeOnComplete: true });

        return {
            success: true,
            message: 'Login successful',
            token: this.jwtService.sign(payload),
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                api_token: user.apiToken
            }
        };
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

        // Create default Account
        await this.createDefaultAccount(newUser.id);

        // Dispatch Welcome Email
        await this.emailQueue.add('welcome', {
            email: newUser.email,
            name: newUser.name
        }, { removeOnComplete: true });

        const payload = { email: newUser.email, id: newUser.id };
        return {
            success: true,
            message: 'User registered successfully',
            token: this.jwtService.sign(payload),
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                api_token: newUser.apiToken
            }
        };
    }

    async forgotPassword(email: string) {
        const user = await this.usersService.findOneByEmail(email);
        if (!user) {
            throw new BadRequestException('Email not found');
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // 10 minutes
        await this.cacheManager.set(`OTP:${email}`, otp, 600000);

        // Reuse otp-alert (generic enough: "Seu Código de Verificação")
        await this.emailQueue.add('otp-alert', {
            email,
            otp
        }, { removeOnComplete: true });

        return { success: true, message: 'OTP sent to your email' };
    }

    async resetPassword(data: any) {
        const { email, otp, newPassword } = data;

        if (!email || !otp || !newPassword) {
            throw new BadRequestException('Missing required fields');
        }

        const storedOtp = await this.cacheManager.get(`OTP:${email}`);
        if (!storedOtp || storedOtp !== otp) {
            throw new BadRequestException('Invalid or expired OTP');
        }

        const user = await this.usersService.findOneByEmail(email);
        if (!user) {
            throw new BadRequestException('User not found');
        }

        // Delete OTP
        await this.cacheManager.del(`OTP:${email}`);

        // Update Password
        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(newPassword, salt);

        await this.usersService.update(user); // Assuming update method exists and works with entity

        return { success: true, message: 'Password updated successfully' };
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
