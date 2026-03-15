import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Mt5Service } from './mt5.service';
import { ImportMethod } from './import-log.entity';

@Processor('trade-import')
export class TradeImportProcessor {
    private readonly logger = new Logger(TradeImportProcessor.name);

    constructor(private readonly mt5Service: Mt5Service) { }

    @Process('process-trade-import')
    async handleTradeImport(job: Job<{ trades: any[], importMethod: ImportMethod, userId?: string, accountId?: string }>) {
        this.logger.log(`Processing background trade import for userId: ${job.data.userId || 'N/A'}, trades: ${job.data.trades.length}`);
        
        try {
            const result = await this.mt5Service.processTradeImport(job.data);
            this.logger.log(`Background trade import completed successfully. Saved: ${result.count}`);
        } catch (error) {
            this.logger.error(`Failed to process background trade import: ${error.message}`, error.stack);
            throw error; // Bull will retry based on job options
        }
    }
}
