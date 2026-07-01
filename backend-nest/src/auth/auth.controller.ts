import { Controller, Post, Body, UseGuards, Request, Get, Put, Res, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AccountService } from '../account/account.service';
import { AuthGuard } from '@nestjs/passport';
import { GoogleOauthGuard } from './google-oauth.guard';
import { GithubOauthGuard } from './github-oauth.guard';
import { Throttle } from '@nestjs/throttler';
import { PlanPermissionService } from '../payment/plan-permission.service';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);
    constructor(
        private readonly authService: AuthService,
        private readonly usersService: UsersService,
        private readonly accountService: AccountService,
        private readonly planPermissionService: PlanPermissionService,
        private readonly configService: ConfigService
    ) { }

    @Post('login')
    @Throttle({ default: { limit: 9, ttl: 60000 } })
    async login(@Body() body, @Request() req) {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const userAgent = req.headers['user-agent'];

        return this.authService.authenticateAndLogin(body.email, body.password, ip, userAgent);
    }

    @Post('refresh')
    async refresh(@Body() body, @Request() req) {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        if (!body.refreshToken) return { success: false, error: 'Refresh token is required' };
        return this.authService.refresh(body.refreshToken, ip, userAgent);
    }

    @Post('register')
    @Throttle({ default: { limit: 3, ttl: 60000 } }) // Limit: 3 req/min
    async register(@Body() body, @Request() req) {
        try {
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
            const userAgent = req.headers['user-agent'];
            return await this.authService.register(body, ip, userAgent);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @Post('send-otp')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async sendOtp(@Body() body) {
        try {
            if (!body.email) return { success: false, error: 'Email is required' };
            return await this.authService.sendOtp(body.email);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @Post('forgot-password')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async forgotPassword(@Body() body) {
        try {
            if (!body.email) return { success: false, error: 'Email is required' };
            return await this.authService.forgotPassword(body.email);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @Post('reset-password')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async resetPassword(@Body() body) {
        try {
            return await this.authService.resetPassword(body);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('regenerate-token')
    async regenerateToken(@Request() req) {
        return this.authService.regenerateToken(req.user.id);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('logout')
    async logout(@Request() req) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        await this.authService.logout(token);
        return { success: true, message: 'Logged out successfully' };
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('profile')
    async getProfile(@Request() req) {
        try {
            const user = await this.usersService.findOneById(req.user.id);
            if (!user) return null;

            // Fetch account status
            let isConnected = false;
            try {
                const account = await this.accountService.findOneByUserId(user.id);
                isConnected = account.isConnected;
            } catch (e) {
                // Account might not exist yet or error
                isConnected = false;
            }

            const planTier = await this.planPermissionService.getUserPlan(user.id);
            const subscription = await this.planPermissionService.getFullUserSubscription(user.id);

            // Map only safe user fields and backend apiToken to frontend token expectation
            return {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                avatarUrl: user.avatarUrl,
                whatsapp: user.whatsapp,
                createdAt: user.createdAt,
                twoFactorEnabled: user.twoFactorEnabled,
                isTwoFactorConfirmed: user.isTwoFactorConfirmed,
                onboardingCompleted: user.onboardingCompleted,
                dailyLossLimit: user.dailyLossLimit,
                token: user.apiToken,
                is_connected: isConnected,
                tier: planTier,
                subscription: subscription ? {
                    id: subscription.id,
                    status: subscription.status,
                    expiresAt: subscription.currentPeriodEnd,
                    createdAt: subscription.createdAt,
                    planTier: planTier
                } : null
            };
        } catch (error) {
            console.error('Error in /api/auth/profile:', error);
            throw error;
        }
    }

    @UseGuards(AuthGuard('jwt'))
    @Put('profile')
    async updateProfile(@Request() req, @Body() body: { name?: string; avatarUrl?: string }) {
        return this.usersService.updateProfile(req.user.id, {
            name: body.name,
            avatarUrl: body.avatarUrl
        });
    }

    @UseGuards(AuthGuard('jwt'))
    @Put('contact')
    async updateContact(@Request() req, @Body() body: { whatsapp: string }) {
        return this.usersService.updateContact(req.user.id, body.whatsapp);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('app-token')
    async getAppToken(@Request() req) {
        return this.authService.getAppToken(req.user.id);
    }

    @Post('verify-2fa')
    async verify2fa(@Body() body, @Request() req) {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        return this.authService.verify2fa(body.twoFactorToken || body.userId, body.otp, ip, userAgent);
    }

    @Post('resend-2fa')
    async resend2fa(@Body() body, @Request() req) {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
        const userAgent = req.headers['user-agent'];
        return this.authService.resend2fa(body.twoFactorToken || body.userId, ip, userAgent);
    }

    @UseGuards(AuthGuard('jwt'))
    @Put('2fa')
    async update2fa(@Request() req, @Body() body: { enabled: boolean }) {
        return this.authService.setTwoFactor(req.user.id, body.enabled);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('2fa/setup')
    async setup2fa(@Request() req) {
        return this.authService.setupTwoFactor(req.user.id);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('2fa/verify-setup')
    async verify2faSetup(@Request() req, @Body() body: { token: string }) {
        return this.authService.verifyTwoFactorSetup(req.user.id, body.token);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('onboarding')
    async completeOnboarding(@Request() req, @Body() body: any) {
        return this.authService.saveOnboardingSurvey(req.user.id, body);
    }

    @UseGuards(GoogleOauthGuard)
    @Get('google')
    async googleAuth(@Request() req) {
        // Guard redirects to Google
    }

    @UseGuards(GoogleOauthGuard)
    @Get('google/callback')
    async googleAuthRedirect(@Request() req, @Res() res: FastifyReply) {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const userAgent = req.headers['user-agent'];
        const result = await this.authService.validateGoogleUser(req.user, ip, userAgent);
        
        const frontendUrl = this.configService.get<string>('FRONTEND_URL');
        if (!frontendUrl) {
            this.logger.error('FRONTEND_URL not configured in .env! Redirection will likely fail.');
            return res.status(500).send('Redirection error: FRONTEND_URL missing');
        }

        if (result.twoFactorRequired) {
            return res.redirect(`${frontendUrl}/2fa?twoFactorToken=${result.twoFactorToken}`);
        }

        const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
        redirectUrl.searchParams.append('token', result.token);
        redirectUrl.searchParams.append('onboardingCompleted', result.user.onboardingCompleted.toString());
        redirectUrl.searchParams.append('requiresContact', result.requiresContact.toString());

        return res.redirect(redirectUrl.toString());
    }

    @UseGuards(GithubOauthGuard)
    @Get('github')
    async githubAuth(@Request() req) {
        // Guard redirects to GitHub
    }

    @UseGuards(GithubOauthGuard)
    @Get('github/callback')
    async githubAuthRedirect(@Request() req, @Res() res: FastifyReply) {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const userAgent = req.headers['user-agent'];
        const result = await this.authService.validateGithubUser(req.user, ip, userAgent);

        const frontendUrl = this.configService.get<string>('FRONTEND_URL');
        if (!frontendUrl) {
            this.logger.error('FRONTEND_URL not configured in .env! Redirection will likely fail.');
            return res.status(500).send('Redirection error: FRONTEND_URL missing');
        }

        if (result.twoFactorRequired) {
            return res.redirect(`${frontendUrl}/2fa?twoFactorToken=${result.twoFactorToken}`);
        }

        const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
        redirectUrl.searchParams.append('token', result.token);
        redirectUrl.searchParams.append('onboardingCompleted', result.user.onboardingCompleted.toString());
        redirectUrl.searchParams.append('requiresContact', result.requiresContact.toString());

        return res.redirect(redirectUrl.toString());
    }
}
