import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { TelemetryService } from '../common/observability/telemetry.service';
import { diagnoseRedisError, formatErrorDetails } from '../common/observability/error-formatter';

const LOGICAL_STREAMS = [
    'stream:mt5_market_data',
    'stream:mt5_history_sync',
    'stream:mt5_ticks',
    'stream:mt5_trade_data',
] as const;

type LogicalStreamName = (typeof LOGICAL_STREAMS)[number];

@Injectable()
export class Mt5RedisSubscriber implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(Mt5RedisSubscriber.name);
    private readonly redis: Redis;
    private readonly redisEndpoint: string;
    private readonly redisPrefix: string;
    private readonly prefixedStreams: string[];
    private readonly fullToLogicalStream = new Map<string, LogicalStreamName>();
    private isRunning = true;
    private readonly CONSUMER_GROUP = 'nest_backend_group';
    private readonly CONSUMER_NAME = `consumer_${Math.random().toString(36).substring(2, 8)}`;

    // Anti-flood state so persistent outages remain clear without spamming 40 lines/min
    private lastLoopErrorKey = '';
    private loopErrorCount = 0;
    private lastLoopErrorLoggedAt = 0;
    private lastClientErrorKey = '';
    private lastClientErrorLoggedAt = 0;

    constructor(
        private configService: ConfigService,
        @InjectQueue('mt5-data') private mt5Queue: Queue,
        @Optional() private telemetry?: TelemetryService,
    ) {
        const host = this.configService.get<string>('REDIS_HOST') || '127.0.0.1';
        const port = Number(this.configService.get<number>('REDIS_PORT') || 6379);
        const password = this.configService.get<string>('REDIS_PASSWORD');
        this.redisPrefix = this.configService.get<string>('REDIS_PREFIX', '{cossa_trading}') || '';
        this.redisEndpoint = `${host}:${port}`;

        for (const logical of LOGICAL_STREAMS) {
            const fullKey = `${this.redisPrefix}${logical}`;
            this.fullToLogicalStream.set(fullKey, logical);
            this.fullToLogicalStream.set(logical, logical);
        }
        this.prefixedStreams = LOGICAL_STREAMS.map((s) => `${this.redisPrefix}${s}`);

        // Do NOT pass keyPrefix to ioredis here: ioredis prefixes XREADGROUP/XACK
        // but does NOT prefix XGROUP, causing NOGROUP mismatches. We pass explicit prefixed keys.
        this.redis = new Redis({
            host,
            port,
            password,
            maxRetriesPerRequest: null,
        });

        this.redis.on('error', (err) => {
            const diag = diagnoseRedisError(err, this.redisEndpoint);
            const now = Date.now();
            if (diag.technicalSummary !== this.lastClientErrorKey || now - this.lastClientErrorLoggedAt >= 30_000) {
                this.lastClientErrorKey = diag.technicalSummary;
                this.lastClientErrorLoggedAt = now;
                this.logger.error(
                    `${diag.explanation} | detalhe: ${diag.technicalSummary}`,
                    err instanceof Error ? err.stack : undefined,
                );
                this.telemetry?.recordError('mt5-redis-client', `${diag.explanation}: ${diag.technicalSummary}`);
            }
        });
    }

    async onModuleInit() {
        await this.ensureAllGroups();

        this.logger.log(
            `MT5 Redis Streams consumer iniciado (${this.CONSUMER_NAME} | group=${this.CONSUMER_GROUP} | prefix="${this.redisPrefix}" | redis=${this.redisEndpoint})`,
        );
        void this.consumeStreams();
    }

    private async ensureAllGroups(): Promise<void> {
        for (const fullStreamKey of this.prefixedStreams) {
            await this.createGroupIfNotExists(fullStreamKey);
        }
    }

    private async createGroupIfNotExists(fullStreamKey: string): Promise<void> {
        try {
            await this.redis.xgroup('CREATE', fullStreamKey, this.CONSUMER_GROUP, '$', 'MKSTREAM');
            this.logger.log(
                `Grupo consumidor "${this.CONSUMER_GROUP}" criado para a stream "${fullStreamKey}"`,
            );
        } catch (e: any) {
            const msg = String(e?.message || '');
            if (!msg.includes('BUSYGROUP')) {
                const diag = diagnoseRedisError(e, this.redisEndpoint);
                this.logger.error(
                    `Falha ao inicializar grupo "${this.CONSUMER_GROUP}" na stream "${fullStreamKey}": ${diag.explanation} — ${diag.technicalSummary}`,
                    e instanceof Error ? e.stack : undefined,
                );
                this.telemetry?.recordError(
                    'mt5-redis-stream',
                    `XGROUP CREATE ${fullStreamKey}: ${diag.technicalSummary}`,
                );
            }
        }
    }

    private async consumeStreams() {
        const newIdsPlaceholders = this.prefixedStreams.map(() => '>');

        while (this.isRunning) {
            try {
                const response = (await (this.redis as any).xreadgroup(
                    'GROUP',
                    this.CONSUMER_GROUP,
                    this.CONSUMER_NAME,
                    'BLOCK',
                    5000,
                    'COUNT',
                    50,
                    'STREAMS',
                    ...this.prefixedStreams,
                    ...newIdsPlaceholders,
                )) as any;

                if (this.loopErrorCount > 0) {
                    this.logger.log(
                        `Consumo de Redis Streams recuperado com sucesso após ${this.loopErrorCount} falha(s) (${this.redisEndpoint}).`,
                    );
                    this.loopErrorCount = 0;
                    this.lastLoopErrorKey = '';
                }

                if (response) {
                    for (const streamData of response) {
                        const rawStreamKey = String(streamData[0] || '');
                        const logicalStream = this.fullToLogicalStream.get(rawStreamKey);
                        const ackKey = rawStreamKey || '';
                        const messages = streamData[1];

                        if (!logicalStream) {
                            this.logger.warn(
                                `Mensagem recebida de stream desconhecida "${rawStreamKey}" (esperadas: ${this.prefixedStreams.join(', ')})`,
                            );
                            continue;
                        }

                        for (const message of messages) {
                            const id = String(message[0]);
                            const fields = message[1];

                            const parsedFields: Record<string, string> = {};
                            for (let i = 0; i < fields.length; i += 2) {
                                parsedFields[fields[i]] = fields[i + 1];
                            }

                            const dataStr = parsedFields.data ?? fields[1];
                            await this.processMessage(logicalStream, id, dataStr, parsedFields);

                            await this.redis.xack(ackKey, this.CONSUMER_GROUP, id);
                        }
                    }
                }
            } catch (e: any) {
                if (!this.isRunning) {
                    break;
                }

                const diag = diagnoseRedisError(e, this.redisEndpoint);

                // Self-heal immediately if streams/groups were wiped (e.g. FLUSHDB or Redis restart)
                if (diag.isNoGroup) {
                    this.logger.warn(
                        `${diag.explanation} (group="${this.CONSUMER_GROUP}", streams=[${this.prefixedStreams.join(', ')}]). Detalhe: ${diag.technicalSummary}. A recriar grupos automaticamente...`,
                    );
                    this.telemetry?.recordError(
                        'mt5-redis-stream',
                        `Auto-recuperação NOGROUP: ${diag.technicalSummary}`,
                    );
                    await this.ensureAllGroups();
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }

                this.loopErrorCount += 1;
                const now = Date.now();
                const isNewError = diag.technicalSummary !== this.lastLoopErrorKey;
                const shouldLogRepeat = now - this.lastLoopErrorLoggedAt >= 30_000;

                if (isNewError || shouldLogRepeat) {
                    this.lastLoopErrorKey = diag.technicalSummary;
                    this.lastLoopErrorLoggedAt = now;
                    const attemptNote =
                        this.loopErrorCount > 1 ? ` (tentativa #${this.loopErrorCount})` : '';
                    this.logger.error(
                        `Erro no consumidor de Redis Streams${attemptNote}: ${diag.explanation} | consumer=${this.CONSUMER_NAME} group=${this.CONSUMER_GROUP} | causa: ${diag.technicalSummary}`,
                        isNewError && e instanceof Error ? e.stack : undefined,
                    );
                    this.telemetry?.recordError(
                        'mt5-redis-stream',
                        `${diag.explanation}: ${diag.technicalSummary}`,
                        undefined,
                        { category: diag.category, attempts: this.loopErrorCount },
                    );
                }

                const backoffMs = Math.min(15_000, 1500 * Math.pow(2, Math.min(this.loopErrorCount - 1, 3)));
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }
    }

    private async processMessage(
        stream: LogicalStreamName,
        messageId: string,
        message: string,
        parsedFields: Record<string, string>,
    ) {
        const preview =
            typeof message === 'string' && message.length > 160
                ? `${message.slice(0, 160)}...`
                : String(message);

        if (stream === 'stream:mt5_market_data') {
            try {
                const data = JSON.parse(message);
                if (!data.token) {
                    return;
                }
                await this.mt5Queue.add(
                    'sync-data',
                    {
                        positions: [],
                        ...data,
                    },
                    { removeOnComplete: true, attempts: 3 },
                );
            } catch (e: any) {
                this.logger.error(
                    `Falha ao processar mensagem da stream "${stream}" (id=${messageId}): ${formatErrorDetails(e)} | payload=${preview}`,
                    e instanceof Error ? e.stack : undefined,
                );
            }
        } else if (stream === 'stream:mt5_history_sync') {
            try {
                const data = JSON.parse(message);
                await this.mt5Queue.add('save-history-deal', data, {
                    removeOnComplete: true,
                    attempts: 3,
                });
            } catch (e: any) {
                this.logger.error(
                    `Falha ao processar histórico na stream "${stream}" (id=${messageId}): ${formatErrorDetails(e)} | payload=${preview}`,
                    e instanceof Error ? e.stack : undefined,
                );
            }
        } else if (stream === 'stream:mt5_ticks') {
            try {
                const data = JSON.parse(message);
                await this.mt5Queue.add('save-tick', data, { removeOnComplete: true, attempts: 1 });
            } catch (e: any) {
                this.logger.error(
                    `Falha ao processar tick na stream "${stream}" (id=${messageId}): ${formatErrorDetails(e)} | payload=${preview}`,
                    e instanceof Error ? e.stack : undefined,
                );
            }
        } else if (stream === 'stream:mt5_trade_data') {
            try {
                const trades = JSON.parse(message);
                if (Array.isArray(trades)) {
                    await this.mt5Queue.add(
                        'save-history',
                        {
                            trades,
                            userId: parsedFields.userId || undefined,
                            accountId: parsedFields.accountId || undefined,
                        },
                        { removeOnComplete: true, attempts: 3 },
                    );
                }
            } catch (e: any) {
                this.logger.error(
                    `Falha ao processar trades na stream "${stream}" (id=${messageId}, accountId=${parsedFields.accountId || 'n/a'}): ${formatErrorDetails(e)} | payload=${preview}`,
                    e instanceof Error ? e.stack : undefined,
                );
            }
        }
    }

    onModuleDestroy() {
        this.isRunning = false;
        this.redis.disconnect();
    }
}
