import { Controller, Post, Get, Delete, Body, HttpCode, Param, UseGuards, Req, Headers, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AppTokenGuard } from '../auth/app-token.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Mt5Service } from './mt5.service';
import { Mt5DataDto } from './dto/mt5-data.dto';
import { Mt5InstanceService } from './mt5-instance.service';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

import { Mt5TcpServer } from '../mt5-tcp.server';

@Controller('mt5')
export class Mt5Controller {
    private readonly logger = new Logger(Mt5Controller.name);

    constructor(
        private readonly mt5Service: Mt5Service,
        @InjectQueue('mt5-data') private mt5Queue: Queue,
        private readonly mt5TcpServer: Mt5TcpServer,
        private readonly mt5InstanceService: Mt5InstanceService
    ) { }

    @Get('import-history')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async getImportHistory(@Req() req) {
        return this.mt5Service.getImportHistory(req.user.id);
    }

    @Delete('import-history/:id/revert')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async revertImport(@Param('id') id: string, @Req() req) {
        return this.mt5Service.revertImport(Number(id), req.user.id);
    }

    @Post('data')
    @HttpCode(200)
    async syncData(@Body() data: Mt5DataDto) {
        // ... (rest same)
        await this.mt5Queue.add('sync-data', data, {
            removeOnComplete: true, // Auto removal of completed jobs
            removeOnFail: 100,      // Keep last 100 failed jobs
            attempts: 3,
            backoff: 1000 // Retry delay
        });
        return { success: true, queued: true };
    }

    @Post('save-history')
    @UseGuards(AppTokenGuard)
    @HttpCode(200)
    async saveHistory(@Body() trades: any[], @Req() req) {
        // We can now access req.user or req.account if needed
        await this.mt5Queue.add('save-history', trades, {
            removeOnComplete: true,
            removeOnFail: 50,
            attempts: 3
        });
        return { success: true, queued: true };
    }

    @Post(':id/command')
    @UseGuards(JwtAuthGuard) // Protect with admin guard later
    async sendCommand(@Param('id') id: string, @Body() body: { type: number, payload?: string }) {
        const success = this.mt5TcpServer.sendCommand(id, body.type, body.payload);
        if (!success) {
            return { success: false, message: 'MT5 not connected or send failed' };
        }
        return { success: true, message: `Command ${body.type} sent to ${id}` };
    }

    @Post('journal/:ticket') // Using POST for simplicity or PATCH
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PREMIUM)
    async updateJournal(@Body() data: any, @Param('ticket') ticket: string, @Req() req) {
        return this.mt5Service.updateJournal(ticket, data, req.user.id);
    }

    @Post('manual')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async createManualTrade(@Body() data: any, @Req() req) {
        return this.mt5Service.createManualTrade(data, req.user.id);
    }

    @Post('ping')
    @HttpCode(200)
    async ping(@Headers('x-app-token') token: string) {
        if (token) {
            await this.mt5Service.updateHeartbeat(token);
        }
        return 'pong';
    }

    @Post('cloud/connect')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PREMIUM)
    async connectCloud(@Body() body: { login: string, pass: string, server: string }, @Req() req) {
        return this.mt5InstanceService.startInstance(req.user.id, body.login, body.pass, body.server);
    }

    @Post('cloud/disconnect')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @RequirePlan(PlanTier.PREMIUM)
    async disconnectCloud(@Body() body: { login: string }, @Req() req) {
        return this.mt5InstanceService.stopInstance(req.user.id, body.login);
    }
}
