import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Mt5RedisSubscriber implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(Mt5RedisSubscriber.name);
    private redis: Redis;
    private isRunning = true;
    private readonly CONSUMER_GROUP = 'nest_backend_group';
    private readonly CONSUMER_NAME = `consumer_${Math.random().toString(36).substring(7)}`;

    constructor(
        private configService: ConfigService,
        @InjectQueue('mt5-data') private mt5Queue: Queue
    ) {
        this.redis = new Redis({
            host: this.configService.get('REDIS_HOST'),
            port: this.configService.get('REDIS_PORT'),
            password: this.configService.get('REDIS_PASSWORD'),
        });
    }

    async onModuleInit() {
        // Initialize groups for both streams
        await this.createGroupIfNotExists('stream:mt5_market_data');
        await this.createGroupIfNotExists('stream:mt5_history_sync');
        await this.createGroupIfNotExists('stream:mt5_ticks');
        await this.createGroupIfNotExists('stream:mt5_trade_data');

        this.logger.log(`🚀 Redis Streams Consumer Started by ${this.CONSUMER_NAME}`);
        this.consumeStreams();
    }

    private async createGroupIfNotExists(stream: string) {
        try {
            // MKSTREAM ensures the stream exists
            await this.redis.xgroup('CREATE', stream, this.CONSUMER_GROUP, '$', 'MKSTREAM');
            this.logger.log(`Created Consumer Group for ${stream}`);
        } catch (e) {
            if (!e.message.includes('BUSYGROUP')) {
                this.logger.error(`Error creating group for ${stream}: ${e.message}`);
            } else {
                this.logger.debug(`Consumer Group for ${stream} already exists.`);
            }
        }
    }

    private async consumeStreams() {
        while (this.isRunning) {
            try {
                // Block for 5 seconds waiting for new messages on any stream
                const response = await (this.redis as any).xreadgroup(
                    'GROUP', this.CONSUMER_GROUP, this.CONSUMER_NAME,
                    'BLOCK', 5000,
                    'COUNT', 50,
                    'STREAMS', 'stream:mt5_market_data', 'stream:mt5_history_sync', 'stream:mt5_ticks', 'stream:mt5_trade_data',
                    '>', '>', '>', '>'
                ) as any;

                if (response) {
                    for (const streamData of response) {
                        const streamName = streamData[0]; // e.g., "stream:mt5_market_data"
                        const messages = streamData[1];

                        for (const message of messages) {
                            const id = message[0];
                            const fields = message[1];
                            const dataStr = fields[1]; // We stored JSON in the 'data' field (index 1)

                            await this.processMessage(streamName, dataStr);

                            // Acknowledge processed message
                            await this.redis.xack(streamName, this.CONSUMER_GROUP, id);
                        }
                    }
                }
            } catch (e) {
                this.logger.error(`Error in Stream Consumer Loop: ${e.message}`);
                // Brief pause on error to avoid tight loops
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private async processMessage(stream: string, message: string) {
        if (stream === 'stream:mt5_market_data') {
            try {
                const data = JSON.parse(message);
                await this.mt5Queue.add('sync-data', {
                    token: 'TCP_STREAM',
                    mt5_id: data.mt5_id,
                    balance: data.balance,
                    equity: data.equity,
                    positions: [],
                    ...data
                }, { removeOnComplete: true, attempts: 3 });
            } catch (e) {
                this.logger.error(`Error processing Market Data: ${e.message}`);
            }
        } else if (stream === 'stream:mt5_history_sync') {
            try {
                const data = JSON.parse(message);
                // Add save-history-deal job
                await this.mt5Queue.add('save-history-deal', data, { removeOnComplete: true, attempts: 3 });
            } catch (e) {
                this.logger.error(`Error processing History message: ${e.message}`);
            }
        } else if (stream === 'stream:mt5_ticks') {
            try {
                const data = JSON.parse(message);
                // Dispatch Tick Job 
                await this.mt5Queue.add('save-tick', data, { removeOnComplete: true, attempts: 1 });
            } catch (e) {

                this.logger.error(`Error processing Tick message: ${e.message}`);
            }
        } else if (stream === 'stream:mt5_trade_data') {
            try {
                const trades = JSON.parse(message);
                if (Array.isArray(trades)) {
                    this.logger.log(`Received ${trades.length} trades from stream. Queuing save...`);
                    await this.mt5Queue.add('save-history', trades, { removeOnComplete: true, attempts: 3 });
                }
            } catch (e) {
                this.logger.error(`Error processing Trade Data message: ${e.message}`);
            }
        }
    }

    onModuleDestroy() {
        this.isRunning = false;
        this.redis.disconnect();
    }
}
