import {
    Controller,
    Post,
    Body,
    UseGuards,
    Request,
    Get,
    Put,
    Delete,
    Res,
    Logger,
    Query,
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AccountService } from '../account/account.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleOauthGuard } from './google-oauth.guard';
import { GithubOauthGuard } from './github-oauth.guard';
import { Throttle } from '@nestjs/throttler';
import { PlanPermissionService } from '../payment/plan-permission.service';
import { SubscriptionService } from '../payment/subscription.service';
import { ConfigService } from '@nestjs/config';
import { extractTrustedClientIp } from '../common/security/security.config';
import {
    LoginDto,
    RefreshTokenDto,
    SendOtpDto,
    RegisterDto,
    ForgotPasswordDto,
    ResetPasswordDto,
    Verify2faDto,
    Resend2faDto,
    UpdateProfileDto,
    UpdateContactDto,
    UpdatePreferencesDto,
    Update2faDto,
    Verify2faSetupDto,
    OnboardingSurveyDto,
    OAuthExchangeDto,
    RegisterInitiateDto,
    VerifyRegistrationDto,
    ResendRegistrationOtpDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);
    constructor(
        private readonly authService: AuthService,
        private readonly usersService: UsersService,
        private readonly accountService: AccountService,
        private readonly planPermissionService: PlanPermissionService,
        private readonly subscriptionService: SubscriptionService,
        private readonly configService: ConfigService
    ) { }

    @Post('login')
    @Throttle({ default: { limit: 9, ttl: 60000 } })
    async login(@Body() body: LoginDto, @Request() req) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];

        return this.authService.authenticateAndLogin(body.email, body.password, ip, userAgent);
    }

    @Post('refresh')
    @Throttle({ default: { limit: 15, ttl: 60000 } })
    async refresh(@Body() body: RefreshTokenDto, @Request() req) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        return this.authService.refresh(body.refreshToken, ip, userAgent);
    }

    @Get('geo-hint')
    @Throttle({ default: { limit: 20, ttl: 60000 } })
    getGeoHint(@Request() req, @Query('tz') tz?: string) {
        return this.authService.getGeoHint(req.headers, tz);
    }

    @Post('register/initiate')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    async initiateRegistration(@Body() body: RegisterInitiateDto, @Request() req) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        return this.authService.initiateRegistration(body, ip, userAgent);
    }

    @Post('register/verify')
    @Throttle({ default: { limit: 6, ttl: 60000 } })
    async verifyRegistration(@Body() body: VerifyRegistrationDto, @Request() req) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        return this.authService.verifyRegistration(body.verificationToken, body.otp, ip, userAgent);
    }

    @Post('register/resend')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async resendRegistrationOtp(@Body() body: ResendRegistrationOtpDto) {
        return this.authService.resendRegistrationOtp(body.verificationToken);
    }

    @Post('register')
    @Throttle({ default: { limit: 3, ttl: 60000 } }) // Limit: 3 req/min
    async register(@Body() body: RegisterDto, @Request() req) {
        try {
            const ip = extractTrustedClientIp(req);
            const userAgent = req.headers['user-agent'];
            return await this.authService.register(body, ip, userAgent);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @Post('send-otp')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async sendOtp(@Body() body: SendOtpDto) {
        try {
            return await this.authService.sendOtp(body.email);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @Post('forgot-password')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async forgotPassword(@Body() body: ForgotPasswordDto) {
        try {
            return await this.authService.forgotPassword(body.email);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @Post('reset-password')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    async resetPassword(@Body() body: ResetPasswordDto) {
        try {
            return await this.authService.resetPassword(body);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('regenerate-token')
    async regenerateToken(@Request() req) {
        return this.authService.regenerateToken(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post('logout')
    async logout(@Request() req) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        await this.authService.logout(token, req.user?.id);
        return { success: true, message: 'Logged out successfully' };
    }

    @UseGuards(JwtAuthGuard)
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

            // Check and automatically grant trial if eligible and campaign is active
            const trialResult = await this.subscriptionService.claimOrCheckTrialForUser(user.id);

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
                hasUsedTrial: user.hasUsedTrial || trialResult.hasUsedTrial,
                trialUsedAt: user.trialUsedAt,
                trialJustGranted: trialResult.trialGranted,
                trialDays: trialResult.trialDays,
                preferredLocale: user.preferredLocale || 'pt',
                timezone: user.timezone || null,
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

    @UseGuards(JwtAuthGuard)
    @Put('profile')
    async updateProfile(@Request() req, @Body() body: UpdateProfileDto) {
        return this.usersService.updateProfile(req.user.id, {
            name: body.name,
            username: body.username,
            avatarUrl: body.avatarUrl,
            dailyLossLimit: body.dailyLossLimit,
        });
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('profile/avatar')
    @UseInterceptors(new FastifyFileInterceptor('file', { allowedImageOnly: true, maxFileSizeBytes: 5 * 1024 * 1024 }))
    async uploadProfileAvatar(@Request() req, @UploadedFile() file) {
        return this.usersService.uploadAvatar(req.user.id, file);
    }

    @UseGuards(JwtAuthGuard)
    @Delete('profile/avatar')
    async deleteProfileAvatar(@Request() req) {
        return this.usersService.deleteAvatar(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Put('contact')
    async updateContact(@Request() req, @Body() body: UpdateContactDto) {
        return this.usersService.updateContact(req.user.id, body.whatsapp);
    }

    @UseGuards(JwtAuthGuard)
    @Put('preferences')
    async updatePreferences(@Request() req, @Body() body: UpdatePreferencesDto) {
        return this.usersService.updatePreferences(req.user.id, body);
    }

    @UseGuards(JwtAuthGuard)
    @Get('app-token')
    async getAppToken(@Request() req, @Query('accountId') queryAccountId?: string) {
        const accountId = queryAccountId || (req.headers['x-account-id'] as string) || undefined;
        return this.authService.getAppToken(req.user.id, accountId);
    }

    @Post('verify-2fa')
    @Throttle({ default: { limit: 6, ttl: 60000 } })
    async verify2fa(@Body() body: Verify2faDto, @Request() req) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        return this.authService.verify2fa(body.twoFactorToken || body.userId || '', body.otp, ip, userAgent);
    }

    @Post('resend-2fa')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async resend2fa(@Body() body: Resend2faDto, @Request() req) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        return this.authService.resend2fa(body.twoFactorToken || body.userId || '', ip, userAgent);
    }

    @UseGuards(JwtAuthGuard)
    @Put('2fa')
    async update2fa(@Request() req, @Body() body: Update2faDto) {
        return this.authService.setTwoFactor(req.user.id, body.enabled, {
            code: body.code,
            password: body.password,
        });
    }

    @UseGuards(JwtAuthGuard)
    @Post('2fa/setup')
    async setup2fa(@Request() req) {
        return this.authService.setupTwoFactor(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Post('2fa/verify-setup')
    async verify2faSetup(@Request() req, @Body() body: Verify2faSetupDto) {
        return this.authService.verifyTwoFactorSetup(req.user.id, body.token);
    }

    @UseGuards(JwtAuthGuard)
    @Post('onboarding')
    async completeOnboarding(@Request() req, @Body() body: OnboardingSurveyDto) {
        return this.authService.saveOnboardingSurvey(req.user.id, body);
    }

    @Post('oauth/exchange')
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    async exchangeOAuthCode(@Body() body: OAuthExchangeDto) {
        return this.authService.exchangeOAuthCode(body.code);
    }

    @UseGuards(GoogleOauthGuard)
    @Get('google')
    async googleAuth(@Request() req) {
        // Guard redirects to Google
    }

    @UseGuards(GoogleOauthGuard)
    @Get('google/callback')
    async googleAuthRedirect(@Request() req, @Res() res: FastifyReply) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        const result = await this.authService.validateGoogleUser(req.user, ip, userAgent);
        
        const frontendUrl = this.configService.get<string>('FRONTEND_URL');
        if (!frontendUrl) {
            this.logger.error('FRONTEND_URL not configured in .env! Redirection will likely fail.');
            return res.status(500).send('Redirection error: FRONTEND_URL missing');
        }

        const code = await this.authService.createOAuthExchangeCode({
            token: result.token || null,
            twoFactorRequired: 'twoFactorRequired' in result ? Boolean(result.twoFactorRequired) : false,
            twoFactorType: 'twoFactorType' in result ? result.twoFactorType || null : null,
            twoFactorToken: 'twoFactorToken' in result ? result.twoFactorToken || null : null,
            requiresContact: Boolean(result.requiresContact),
        });

        const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
        redirectUrl.searchParams.append('code', code);
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
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        const result = await this.authService.validateGithubUser(req.user, ip, userAgent);

        const frontendUrl = this.configService.get<string>('FRONTEND_URL');
        if (!frontendUrl) {
            this.logger.error('FRONTEND_URL not configured in .env! Redirection will likely fail.');
            return res.status(500).send('Redirection error: FRONTEND_URL missing');
        }

        const code = await this.authService.createOAuthExchangeCode({
            token: result.token || null,
            twoFactorRequired: 'twoFactorRequired' in result ? Boolean(result.twoFactorRequired) : false,
            twoFactorType: 'twoFactorType' in result ? result.twoFactorType || null : null,
            twoFactorToken: 'twoFactorToken' in result ? result.twoFactorToken || null : null,
            requiresContact: Boolean(result.requiresContact),
        });

        const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
        redirectUrl.searchParams.append('code', code);
        return res.redirect(redirectUrl.toString());
    }
}
