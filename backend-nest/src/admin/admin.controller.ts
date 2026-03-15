import { Controller, Post, Get, Body, UnauthorizedException, Logger, UseGuards, Headers, Patch, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as moment from 'moment';
import { UsersService } from '../users/users.service';
import { SubscriptionService } from '../payment/subscription.service';
import { BroadcastingService } from '../notifications/broadcast.service';

@Controller('admin')
export class AdminController {
    private readonly logger = new Logger(AdminController.name);

    constructor(
        private configService: ConfigService,
        private usersService: UsersService,
        private subscriptionService: SubscriptionService,
        private broadcastingService: BroadcastingService
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

    // --- Broadcast Notifications ---
    @Get('broadcasts')
    async getBroadcasts() {
        return this.broadcastingService.findAll();
    }

    @Post('broadcasts')
    async createBroadcast(@Body() body: any) {
        return this.broadcastingService.createBroadcast(body);
    }

    @Post('broadcasts/:id/execute')
    async executeBroadcast(@Headers('id') id: string) {
        // Fallback to param id if header not present (standardizing with other routes)
        return this.broadcastingService.executeBroadcast(id);
    }

    // --- Subscription Plan Management ---
    @Get('plans')
    async getPlans() {
        return this.subscriptionService.getAllPlans();
    }

    @Patch('plans/:id')
    async updatePlan(@Param('id') id: string, @Body() body: any) {
        return this.subscriptionService.updatePlanConfig(id, body);
    }

    @Post('plans')
    async createPlan(@Body() body: any) {
        return this.subscriptionService.createPlanConfig(body);
    }

    // --- User Subscription History ---
    @Get('users/:id/subscriptions')
    async getUserSubscriptions(@Param('id') id: string) {
        return this.subscriptionService.getUserSubscriptionHistory(id);
    }
}
