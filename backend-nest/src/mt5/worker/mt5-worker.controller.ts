import { Controller, Post, Get, Body, Param, UseGuards, HttpCode, Logger } from '@nestjs/common';
import { WorkerAuthGuard } from './worker-auth.guard';
import { Mt5WorkerService } from './mt5-worker.service';

@Controller('v1/mt5-worker')
@UseGuards(WorkerAuthGuard)
export class Mt5WorkerController {
    private readonly logger = new Logger(Mt5WorkerController.name);

    constructor(private readonly workerService: Mt5WorkerService) { }

    @Post('register')
    @HttpCode(200)
    async register(@Body() body: { workerId: string; capacity: number; systemInfo: Record<string, any> }) {
        return this.workerService.registerWorker(body.workerId, body.capacity, body.systemInfo);
    }

    @Post('heartbeat')
    @HttpCode(200)
    async heartbeat(@Body() body: any) {
        return this.workerService.recordHeartbeat(body);
    }

    @Get('tasks')
    async getTasks() {
        const tasks = this.workerService.getPendingTasks();
        return { tasks };
    }

    @Post('tasks/:id/ack')
    @HttpCode(200)
    async ackTask(
        @Param('id') id: string,
        @Body() body: { taskId?: string; status: any; message?: string; details?: any }
    ) {
        const taskId = id || body.taskId;
        return this.workerService.ackTask(taskId, body.status, body.message, body.details);
    }

    @Post('credentials/exchange')
    @HttpCode(200)
    async exchangeCredentials(@Body() body: { taskId: string; accountId: number; credentialToken: string }) {
        return this.workerService.exchangeCredential(body.taskId, body.accountId, body.credentialToken);
    }

    @Post('sync/accounts')
    @HttpCode(200)
    async syncAccounts(@Body() body: any) {
        return this.workerService.syncAccountMetrics(body);
    }

    @Post('sync/trades')
    @HttpCode(200)
    async syncTrades(@Body() body: { accountId: number; login?: string; trades?: any[]; deals?: any[]; lastDealTicket?: number }) {
        const deals = body.trades || body.deals || [];
        const login = body.login || body.accountId?.toString();
        return this.workerService.syncTrades(body.accountId, login, deals, body.lastDealTicket);
    }

    @Post('sync/positions')
    @HttpCode(200)
    async syncPositions(@Body() body: { accountId: number; login?: string; positions: any[] }) {
        const login = body.login || body.accountId?.toString();
        return this.workerService.syncPositions(body.accountId, login, body.positions);
    }

    @Post('sync/orders')
    @HttpCode(200)
    async syncOrders(@Body() body: { accountId: number; login?: string; orders: any[] }) {
        const login = body.login || body.accountId?.toString();
        return this.workerService.syncOrders(body.accountId, login, body.orders || []);
    }

    @Post('events')
    @HttpCode(200)
    async handleEvent(@Body() body: any) {
        return this.workerService.recordWorkerEvent(body);
    }
}
