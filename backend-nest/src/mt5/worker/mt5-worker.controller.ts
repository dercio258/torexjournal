import { Controller, Post, Get, Body, Param, UseGuards, HttpCode, Logger, Req } from '@nestjs/common';
import { WorkerAuthGuard } from './worker-auth.guard';
import { Mt5WorkerService } from './mt5-worker.service';
import {
    AckWorkerTaskDto,
    ExchangeCredentialsDto,
    RegisterWorkerDto,
    SyncWorkerAccountMetricsDto,
    SyncWorkerOrdersDto,
    SyncWorkerPositionsDto,
    SyncWorkerTradesDto,
    WorkerHeartbeatDto,
} from './dto/mt5-worker.dto';

@Controller('v1/mt5-worker')
@UseGuards(WorkerAuthGuard)
export class Mt5WorkerController {
    private readonly logger = new Logger(Mt5WorkerController.name);

    constructor(private readonly workerService: Mt5WorkerService) { }

    @Post('register')
    @HttpCode(200)
    async register(@Body() body: RegisterWorkerDto) {
        return this.workerService.registerWorker(body.workerId, body.capacity, body.systemInfo || {});
    }

    @Post('heartbeat')
    @HttpCode(200)
    async heartbeat(@Body() body: WorkerHeartbeatDto) {
        return this.workerService.recordHeartbeat(body);
    }

    @Get('tasks')
    async getTasks(@Req() req: any) {
        const tasks = this.workerService.getPendingTasks(true, req?.workerId);
        return { tasks };
    }

    @Post('tasks/:id/ack')
    @HttpCode(200)
    async ackTask(
        @Param('id') id: string,
        @Body() body: AckWorkerTaskDto
    ) {
        const taskId = id || body.taskId;
        return this.workerService.ackTask(taskId, body.status as any, body.message, body.details);
    }

    @Post('credentials/exchange')
    @HttpCode(200)
    async exchangeCredentials(@Body() body: ExchangeCredentialsDto) {
        return this.workerService.exchangeCredential(body.taskId, body.accountId, body.credentialToken);
    }

    @Post('sync/accounts')
    @HttpCode(200)
    async syncAccounts(@Body() body: SyncWorkerAccountMetricsDto, @Req() req: any) {
        return this.workerService.syncAccountMetrics(body, req?.workerId);
    }

    @Post('sync/trades')
    @HttpCode(200)
    async syncTrades(@Body() body: SyncWorkerTradesDto) {
        const deals = body.trades || body.deals || [];
        const login = body.login || body.accountId?.toString();
        return this.workerService.syncTrades(
            body.accountId,
            login,
            deals,
            body.lastDealTicket,
            body.server,
            body.serverTzOffsetSec,
        );
    }

    @Post('sync/positions')
    @HttpCode(200)
    async syncPositions(@Body() body: SyncWorkerPositionsDto) {
        if (body?.skipped) {
            return { success: true, skipped: true };
        }
        const login = body.login || body.accountId?.toString();
        return this.workerService.syncPositions(body.accountId, login, body.positions || [], body.server);
    }

    @Post('sync/orders')
    @HttpCode(200)
    async syncOrders(@Body() body: SyncWorkerOrdersDto) {
        const login = body.login || body.accountId?.toString();
        return this.workerService.syncOrders(body.accountId, login, body.orders || []);
    }

    @Post('events')
    @HttpCode(200)
    async handleEvent(@Body() body: any) {
        return this.workerService.recordWorkerEvent(body);
    }

    @Post('sync/candles')
    @HttpCode(200)
    async syncCandles(@Body() body: any) {
        return this.workerService.syncCandlesBatch(body);
    }

    @Post('sync/calendar')
    @HttpCode(200)
    async syncCalendar(@Body() body: any) {
        return this.workerService.syncEconomicCalendar(body);
    }
}
