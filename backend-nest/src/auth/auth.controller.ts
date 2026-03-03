import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AccountService } from '../account/account.service';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
    constructor(
        private authService: AuthService,
        private usersService: UsersService,
        private accountService: AccountService
    ) { }

    @Post('login')
    @Throttle({ default: { limit: 5, ttl: 60000 } }) // Limit: 5 req/min
    async login(@Body() body, @Request() req) {
        const user = await this.authService.validateUser(body.email, body.password);
        if (!user) {
            return { success: false, error: 'Invalid credentials' };
        }

        // Extract IP and UA
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        return this.authService.login(user, ip, userAgent);
    }

    @Post('register')
    @Throttle({ default: { limit: 3, ttl: 60000 } }) // Limit: 3 req/min
    async register(@Body() body) {
        try {
            return await this.authService.register(body);
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
    @Get('profile')
    async getProfile(@Request() req) {
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

        // Map backend apiToken to frontend token expectation
        return {
            ...user,
            token: user.apiToken,
            is_connected: isConnected
        };
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('app-token')
    async getAppToken(@Request() req) {
        return this.authService.getAppToken(req.user.id);
    }
}
