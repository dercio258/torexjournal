import { Controller, Post, Get, Body, UnauthorizedException, Logger, UseGuards, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as moment from 'moment';
import { UsersService } from '../users/users.service';
import { SubscriptionService } from '../payment/subscription.service';

@Controller('admin')
export class AdminController {
    private readonly logger = new Logger(AdminController.name);

    constructor(
        private configService: ConfigService,
        private usersService: UsersService,
        private subscriptionService: SubscriptionService
    ) { }

    // --- Auth ---
    @Post('auth/login')
    login(@Body() body: { email: string; pass: string; date: string }) {
        const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
        const adminPass = this.configService.get<string>('ADMIN_PASS');
        const today = moment().format('DD/MM/YYYY');

        this.logger.log(`Admin Login Attempt: ${body.email} with date ${body.date}`);

        if (
            body.email === adminEmail &&
            body.pass === adminPass &&
            body.date === today
        ) {
            return {
                success: true,
                token: 'admin-session-' + Date.now(),
                user: { email: adminEmail, role: 'admin' }
            };
        }

        throw new UnauthorizedException('Invalid credentials or date');
    }

    // --- Users ---
    @Get('users')
    async getUsers() {
        // In real app, verify token here
        return this.usersService.findAll();
    }

    // --- Plans ---
    @Get('plans')
    async getPlans() {
        return this.subscriptionService.getActivePlans();
    }

    @Post('plans')
    async createPlan(@Body() body: any) {
        // body should contain tier, monthlyPrice, etc.
        return this.subscriptionService.createPlanConfig(body);
    }

    // --- Finance / Stats ---
    @Get('stats')
    async getStats() {
        const users = await this.usersService.findAll();
        const activeSubs = users.filter(u =>
            u.subscriptions?.some(s => s.status === 'ACTIVE')
        ).length;

        // Mock revenue for now (or calculate from subscriptions if price is stored in sub, or via plan)
        // Simple estimation: Active * ~R$49.90
        const estimatedMonthlyRevenue = activeSubs * 49.90;

        return {
            totalUsers: users.length,
            activeSubscribers: activeSubs,
            estimatedMonthlyRevenue
        };
    }
}
