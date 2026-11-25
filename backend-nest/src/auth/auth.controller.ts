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
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';
import { SubscriptionService } from '../payment/subscription.service';
import { ConfigService } from '@nestjs/config';
import { extractTrustedClientIp } from '../common/security/security.config';
import { TurnstileService } from '../common/security/turnstile.service';
import { maskEmailAddress, maskPhoneNumber } from '../common/security/payload-envelope.util';
import {
    clearUserSessionCookies,
    extractUserAccessToken,
    extractUserRefreshToken,
    setUserSessionCookies,
} from '../common/security/cookie-security.util';
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
        private readonly configService: ConfigService,
        private readonly turnstileService: TurnstileService,
    ) { }

    @Post('login')
    @Throttle({ default: { limit: 9, ttl: 60000 } })
    async login(
        @Body() body: LoginDto,
        @Request() req,
        @Res({ passthrough: true }) res: FastifyReply,
    ) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        await this.turnstileService.verifyOrThrow(body.turnstileToken, ip, 'login');

        const result: any = await this.authService.authenticateAndLogin(body.email, body.password, ip, userAgent);
        if (result?.token) {
            setUserSessionCookies(res, req, {
                accessToken: result.token,
                refreshToken: result.refreshToken,
            });
        }
        return result;
    }

    @Post('refresh')
    @Throttle({ default: { limit: 15, ttl: 60000 } })
    async refresh(
        @Body() body: RefreshTokenDto,
        @Request() req,
        @Res({ passthrough: true }) res: FastifyReply,
    ) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        const tokenToUse = extractUserRefreshToken(req, body?.refreshToken) || '';
        const result: any = await this.authService.refresh(tokenToUse, ip, userAgent);
        if (result?.token) {
            setUserSessionCookies(res, req, {
                accessToken: result.token,
                refreshToken: result.refreshToken,
            });
        }
        return result;
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
        await this.turnstileService.verifyOrThrow(body.turnstileToken, ip, 'register');
        return this.authService.initiateRegistration(body, ip, userAgent);
    }

    @Post('register/verify')
    @Throttle({ default: { limit: 6, ttl: 60000 } })
    async verifyRegistration(
        @Body() body: VerifyRegistrationDto,
        @Request() req,
        @Res({ passthrough: true }) res: FastifyReply,
    ) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        const result: any = await this.authService.verifyRegistration(body.verificationToken, body.otp, ip, userAgent);
        if (result?.token) {
            setUserSessionCookies(res, req, {
                accessToken: result.token,
                refreshToken: result.refreshToken,
            });
        }
        return result;
    }

    @Post('register/resend')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async resendRegistrationOtp(@Body() body: ResendRegistrationOtpDto) {
        return this.authService.resendRegistrationOtp(body.verificationToken);
    }

    @Post('register')
    @Throttle({ default: { limit: 3, ttl: 60000 } }) // Limit: 3 req/min
    async register(
        @Body() body: RegisterDto,
        @Request() req,
        @Res({ passthrough: true }) res: FastifyReply,
    ) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        await this.turnstileService.verifyOrThrow(body.turnstileToken, ip, 'register');
        const result: any = await this.authService.register(body, ip, userAgent);
        if (result?.token) {
            setUserSessionCookies(res, req, {
                accessToken: result.token,
                refreshToken: result.refreshToken,
            });
        }
        return result;
    }

    @Post('send-otp')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async sendOtp(@Body() body: SendOtpDto, @Request() req) {
        await this.turnstileService.verifyOrThrow(
            body.turnstileToken,
            extractTrustedClientIp(req),
            'send_otp',
        );
        return this.authService.sendOtp(body.email);
    }

    @Post('forgot-password')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    async forgotPassword(@Body() body: ForgotPasswordDto, @Request() req) {
        await this.turnstileService.verifyOrThrow(
            body.turnstileToken,
            extractTrustedClientIp(req),
            'forgot_password',
        );
        return this.authService.forgotPassword(body.email);
    }

    @Post('reset-password')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    async resetPassword(@Body() body: ResetPasswordDto) {
        return this.authService.resetPassword(body);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('regenerate-token')
    async regenerateToken(@Request() req) {
        return this.authService.regenerateToken(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post('logout')
    async logout(@Request() req, @Res({ passthrough: true }) res: FastifyReply) {
        const token = extractUserAccessToken(req) || '';
        await this.authService.logout(token, req.user?.id);
        clearUserSessionCookies(res, req);
        return { success: true, message: 'Logged out successfully' };
    }

    @UseGuards(JwtAuthGuard)
    @Get('profile')
    async getProfile(@Request() req) {
        try {
            const user = await this.usersService.findOneById(req.user.id);
            if (!user) return null;

            const planTier = await this.planPermissionService.getUserPlan(user.id);
            const hasActivePlan = planTier !== PlanTier.FREE;

            let isConnected = false;
            if (hasActivePlan) {
                try {
                    const account = await this.accountService.findOneByUserId(user.id);
                    isConnected = account.isConnected;
                } catch (e) {
                    isConnected = false;
                }
            }

            const subscription = hasActivePlan
                ? await this.planPermissionService.getFullUserSubscription(user.id)
                : null;
            const trialEligible = hasActivePlan
                ? false
                : await this.subscriptionService.isEligibleForBasicTrial(user.id);

            // Strict zero-data isolation when user has no active plan (FREE / expired)
            // Also strips raw EA tokens, internal subscription IDs, and trial timestamps
            return {
                id: user.id,
                name: user.name,
                username: user.username,
                email: maskEmailAddress(user.email),
                emailVerified: Boolean(
                    user.emailVerifiedAt ||
                        user.googleId ||
                        user.githubId ||
                        user.isTwoFactorConfirmed,
                ),
                avatarUrl: hasActivePlan ? user.avatarUrl : null,
                whatsapp: hasActivePlan ? maskPhoneNumber(user.whatsapp) : null,
                twoFactorEnabled: Boolean(user.twoFactorEnabled),
                onboardingCompleted: hasActivePlan ? Boolean(user.onboardingCompleted) : true,
                dailyLossLimit: hasActivePlan ? user.dailyLossLimit : null,
                is_connected: hasActivePlan ? isConnected : false,
                tier: planTier,
                trialEligible,
                preferredLocale: user.preferredLocale || 'pt',
                timezone: user.timezone || null,
                subscription: subscription
                    ? {
                          status: subscription.status,
                          expiresAt: subscription.currentPeriodEnd,
                          planTier: planTier,
                      }
                    : null,
            };
        } catch (error) {
            console.error('Error in /api/auth/profile:', error);
            throw error;
        }
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 6, ttl: 60000 } })
    @Get('profile/sensitive')
    async getSensitiveProfile(@Request() req) {
        const user = await this.usersService.findOneById(req.user.id);
        if (!user) return { email: '', whatsapp: null };
        return {
            email: user.email || '',
            whatsapp: user.whatsapp || null,
        };
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
    async verify2fa(
        @Body() body: Verify2faDto,
        @Request() req,
        @Res({ passthrough: true }) res: FastifyReply,
    ) {
        const ip = extractTrustedClientIp(req);
        const userAgent = req.headers['user-agent'];
        const result: any = await this.authService.verify2fa(body.twoFactorToken || body.userId || '', body.otp, ip, userAgent);
        if (result?.token) {
            setUserSessionCookies(res, req, {
                accessToken: result.token,
                refreshToken: result.refreshToken,
            });
        }
        return result;
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
    async exchangeOAuthCode(
        @Body() body: OAuthExchangeDto,
        @Request() req,
        @Res({ passthrough: true }) res: FastifyReply,
    ) {
        const result: any = await this.authService.exchangeOAuthCode(body.code);
        if (result?.token) {
            setUserSessionCookies(res, req, { accessToken: result.token });
        }
        return result;
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
