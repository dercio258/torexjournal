
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Mt5Service } from './mt5.service';
import { Mt5DataDto } from './dto/mt5-data.dto';

@Processor('mt5-data')
export class Mt5Processor {
    private readonly logger = new Logger(Mt5Processor.name);

    constructor(private readonly mt5Service: Mt5Service) { }

    @Process('sync-data')
    async handleSyncData(job: Job<Mt5DataDto>) {
        this.logger.debug(`Processing sync-data job for MT5 ID: ${job.data.mt5_id}, attempt: ${job.attemptsMade + 1}`);
        try {
            await this.mt5Service.syncData(job.data);
            this.logger.debug(`Sync-data job completed for MT5 ID: ${job.data.mt5_id}`);
        } catch (error) {
            this.logger.error(`Failed to process sync-data job: ${error.message}`, error.stack);
            throw error; // Let Bull handle retries if configured
        }
    }

    @Process('save-history')
    async handleSaveHistory(job: Job<any[]>) {
        this.logger.debug(`Processing save-history job, trades: ${job.data.length}`);
        try {
            const result = await this.mt5Service.saveHistory(job.data);
            this.logger.debug(`Save-history job completed. Saved: ${result.count}`);
        } catch (error) {
            this.logger.error(`Failed to process save-history job: ${error.message}`, error.stack);
            throw error;
        }
    }

    @Process('save-history-deal')
    async handleSaveHistoryDeal(job: Job<any>) {
        // job.data contains { mt5_id, deal: { ticket, ... } }
        try {
            await this.mt5Service.saveHistoryDeal(job.data);
        } catch (error) {
            this.logger.error(`Failed to save history deal: ${error.message}`);
            // Don't throw if duplicate to avoid retry loop on known error
        }
    }

    @Process('save-tick')
    async handleSaveTick(job: Job<any>) {
        try {
            await this.mt5Service.saveTick(job.data);
        } catch (error) {
            // Silent fail for ticks preferably
        }
    }
}
