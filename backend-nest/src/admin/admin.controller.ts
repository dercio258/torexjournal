import { Controller, Post, Get, Body, UnauthorizedException, Logger, UseGuards, Headers, Patch, Param, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { SubscriptionService } from '../payment/subscription.service';
import { BroadcastingService } from '../notifications/broadcast.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { JwtService } from '@nestjs/jwt';
import { AdminAuthGuard } from './admin-auth.guard';

@Controller('admin')
export class AdminController {
    private readonly logger = new Logger(AdminController.name);

    constructor(
        private configService: ConfigService,
        private usersService: UsersService,
        private subscriptionService: SubscriptionService,
        private broadcastingService: BroadcastingService,
        private jwtService: JwtService,
        @Inject(CACHE_MANAGER) private cacheManager: any,
        @InjectQueue('email-queue') private emailQueue: Queue
    ) { }

    // --- Auth ---
    @Post('auth/login')
    async login(@Body() body: { email: string; pass: string }) {
        const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
        const adminPass = this.configService.get<string>('ADMIN_PASS');

        this.logger.log(`Admin Login Attempt: ${body.email}`);

        if (body.email !== adminEmail || body.pass !== adminPass) {
            throw new UnauthorizedException('Credenciais de administrador inválidas');
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await this.cacheManager.set(`admin_otp:${body.email}`, otp, 300000); // 5 mins

        // Send OTP to email
        await this.emailQueue.add('otp-alert', {
            email: adminEmail,
            otp
        }, { removeOnComplete: true });

        return {
            success: true,
            otpRequired: true,
            message: 'Código de verificação enviado ao e-mail cadastrado.'
        };
    }

    @Post('auth/verify')
    async verifyOtp(@Body() body: { email: string; otp: string }) {
        const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
        
        if (body.email !== adminEmail) {
            throw new UnauthorizedException('E-mail inválido');
        }

        const storedOtp = await this.cacheManager.get(`admin_otp:${body.email}`);
        if (!storedOtp || storedOtp !== body.otp) {
            throw new UnauthorizedException('Código de verificação inválido ou expirado');
        }

        // Clear OTP from cache
        await this.cacheManager.del(`admin_otp:${body.email}`);

        // Generate JWT token
        const secret = this.configService.get<string>('JWT_SECRET') || 'dev_secret';
        const token = this.jwtService.sign(
            { email: adminEmail, role: 'admin', isAdmin: true },
            { secret, expiresIn: '12h' }
        );

        return {
            success: true,
            token,
            user: { email: adminEmail, role: 'admin' }
        };
    }

    // --- Users ---
    @UseGuards(AdminAuthGuard)
    @Get('users')
    async getUsers() {
        return this.usersService.findAll();
    }

    // --- Finance / Stats ---
    @UseGuards(AdminAuthGuard)
    @Get('stats')
    async getStats() {
        return this.subscriptionService.getFinancialStats();
    }

    // --- Broadcast Notifications ---
    @UseGuards(AdminAuthGuard)
    @Get('broadcasts')
    async getBroadcasts() {
        return this.broadcastingService.findAll();
    }

    @UseGuards(AdminAuthGuard)
    @Post('broadcasts')
    async createBroadcast(@Body() body: any) {
        return this.broadcastingService.createBroadcast(body);
    }

    @UseGuards(AdminAuthGuard)
    @Post('broadcasts/:id/execute')
    async executeBroadcast(@Headers('id') id: string) {
        return this.broadcastingService.executeBroadcast(id);
    }

    // --- Subscription Plan Management ---
    @UseGuards(AdminAuthGuard)
    @Get('plans')
    async getPlans() {
        return this.subscriptionService.getAllPlans();
    }

    @UseGuards(AdminAuthGuard)
    @Patch('plans/:id')
    async updatePlan(@Param('id') id: string, @Body() body: any) {
        return this.subscriptionService.updatePlanConfig(id, body);
    }

    @UseGuards(AdminAuthGuard)
    @Post('plans')
    async createPlan(@Body() body: any) {
        return this.subscriptionService.createPlanConfig(body);
    }

    // --- User Subscription History ---
    @UseGuards(AdminAuthGuard)
    @Get('users/:id/subscriptions')
    async getUserSubscriptions(@Param('id') id: string) {
        return this.subscriptionService.getUserSubscriptionHistory(id);
    }
}
