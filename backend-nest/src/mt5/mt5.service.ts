import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException, OnModuleInit, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository, DataSource, LessThan, In, Between, Not, IsNull } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Mt5DataDto } from './dto/mt5-data.dto';
import { AccountEntity, AccountType } from '../account/account.entity';
import { PositionEntity } from './position.entity';
import { TradeEntity } from './trade.entity';
import { TradeHistoryEntity } from './trade-history.entity';
import { UserEntity } from '../users/user.entity';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { Mt5Gateway } from './mt5.gateway';
import { ImportLog, ImportMethod, ImportStatus } from './import-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { AiService } from '../ai/ai.service';
import { NormalizationService } from '../import/normalization/normalization.service';
import { AlertsService } from '../alerts/alerts.service';
import { AlertEntity, AlertType, AlertSeverity } from '../alerts/alert.entity';
import { DashboardService } from '../dashboard/dashboard.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailProducerService } from '../email/email-producer.service';
import { TelemetryService } from '../common/observability/telemetry.service';
import { getQuantInternalHeaders } from '../common/security/security.config';

@Injectable()
export class Mt5Service implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(Mt5Service.name);
    private checkInterval: any;

    constructor(
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(PositionEntity)
        private positionRepo: Repository<PositionEntity>,
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        @InjectRepository(TradeHistoryEntity)
        private historyRepo: Repository<TradeHistoryEntity>,
        private clickHouseService: ClickHouseService,
        @InjectRepository(ImportLog)
        private importLogRepo: Repository<ImportLog>,
        private dataSource: DataSource,
        private mt5Gateway: Mt5Gateway,
        private notificationsService: NotificationsService,
        private alertsService: AlertsService,
        @Optional() private aiService?: AiService,
        private emailProducer?: EmailProducerService,
        @Inject(CACHE_MANAGER) private cacheManager?: Cache,
        @InjectQueue('behavioral-analysis') private behavioralQueue?: Queue,
        @InjectQueue('trade-import') private tradeImportQueue?: Queue,
        private normalizationService?: NormalizationService,
        private dashboardService?: DashboardService,
        private eventEmitter?: EventEmitter2,
        @Optional() private telemetry?: TelemetryService,
    ) { }

    onModuleInit() {
        // Run stale connection audit every 60 seconds
        this.checkInterval = setInterval(() => this.checkDisconnections(), 60000);
    }

    onModuleDestroy() {
        if (this.checkInterval) clearInterval(this.checkInterval);
    }

    /**
     * Forex/CFD weekend market closure window: Friday 22:00 UTC through Sunday 21:00 UTC.
     * During this window, MT5 terminals receive no ticks and idle EAs do not push updates.
     */
    private isForexWeekendClosed(now: Date = new Date()): boolean {
        const day = now.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
        const hour = now.getUTCHours();
        if (day === 6) return true;
        if (day === 5 && hour >= 22) return true;
        if (day === 0 && hour < 21) return true;
        return false;
    }

    private async checkDisconnections() {
        try {
            this.telemetry?.recordMt5Metric('disconnectChecksRun', 1);

            // Do not falsely mark MT5 terminals offline during weekend market closure
            if (this.isForexWeekendClosed()) {
                return;
            }

            // 20-minute grace window accommodates worker sticky-session cooldowns and brief ISP blips
            const threshold = new Date(Date.now() - 20 * 60 * 1000);

            const staleAccounts = await this.accountRepo.find({
                where: {
                    isConnected: true,
                    isArchived: false,
                    broker: Not('Deriv'),
                    mt5Id: Not(IsNull()),
                    lastSeen: LessThan(threshold),
                },
            });

            if (staleAccounts.length === 0) return;

            this.logger.log(
                `Marking ${staleAccounts.length} inactive MT5 account(s) offline (>20m without heartbeat).`,
            );

            for (const account of staleAccounts) {
                if (!account.mt5Id || account.mt5Id.startsWith('PENDING')) continue;

                account.isConnected = false;
                await this.accountRepo.save(account);
                this.telemetry?.recordMt5Metric('accountsMarkedOffline', 1);

                if (account.userId) {
                    const remainingConnected = await this.accountRepo.count({
                        where: {
                            userId: account.userId,
                            isConnected: true,
                            isArchived: false,
                            broker: Not('Deriv'),
                        },
                    });

                    this.mt5Gateway.broadcastConnectionStatus(
                        {
                            isConnected: remainingConnected > 0,
                            accountId: account.id,
                            mt5Id: account.mt5Id,
                        },
                        account.userId,
                    );

                    // Respect account notification toggle + 12h Redis hysteresis cooldown to eliminate email spam
                    if (account.notificationsEnabled !== false) {
                        const cooldownKey = `mt5:disc_notified:${account.id}`;
                        const alreadyNotified = await this.cacheManager
                            .get(cooldownKey)
                            .catch(() => null);

                        if (alreadyNotified) {
                            this.telemetry?.recordMt5Metric(
                                'disconnectAlertsSuppressedCooldown',
                                1,
                            );
                            continue;
                        }

                        const user = await this.dataSource
                            .getRepository(UserEntity)
                            .findOne({ where: { id: account.userId } });

                        if (user?.email) {
                            await this.cacheManager
                                .set(cooldownKey, '1', 12 * 60 * 60 * 1000)
                                .catch(() => {});

                            await this.emailProducer.enqueue(user.email, 'MT5_STATUS', {
                                userName: user.name || undefined,
                                mt5Id: account.mt5Id,
                                broker: account.broker,
                                status: 'DISCONNECTED',
                            });
                            this.telemetry?.recordMt5Metric('disconnectEmailsQueued', 1);
                        }
                    }
                }
            }
        } catch (err: any) {
            this.logger.error(`Disconnection check failed: ${err.message}`);
        }
    }

    async validateAppToken(token: string): Promise<AccountEntity | null> {
        return this.accountRepo.findOne({ where: { appToken: token } });
    }

    async updateHeartbeat(token: string) {
        // Efficient heartbeat update
        await this.accountRepo.update({ appToken: token }, { lastSeen: new Date(), isConnected: true });
    }


    private calculateSession(date: Date): string {
        const hour = date.getUTCHours();
        const sessions = [];
        if (hour >= 22 || hour < 7) sessions.push('Sydney');
        if (hour >= 0 && hour < 9) sessions.push('Tokyo');
        if (hour >= 8 && hour < 17) sessions.push('London');
        if (hour >= 13 && hour < 22) sessions.push('New York');

        return sessions.join(' / ') || 'Off-Session';
    }

    public safeDate(dateInput: any): Date | null {
        if (!dateInput) return null;
        // Handle numeric timestamps (seconds from MQL5/Deriv)
        const timestamp = typeof dateInput === 'number' ? dateInput * 1000 : dateInput;
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? null : date;
    }

    async syncData(data: Mt5DataDto) {
        const { token, mt5_id, positions, ...stats } = data;

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 2. Validate Token & Find Account (strictly require non-empty token)
            if (!token || typeof token !== 'string' || !token.trim()) {
                this.logger.error(`Authentication Failed: Missing appToken for MT5 ID ${mt5_id}.`);
                throw new ConflictException('Invalid Token: Access Denied');
            }

            let account = await queryRunner.manager.findOne(AccountEntity, {
                where: { appToken: token.trim() },
            });

            if (!account) {
                this.logger.error(`Authentication Failed: Token not found in any account.`);
                throw new ConflictException('Invalid Token: Access Denied');
            }

            let isFirstBind = false;
            if (account.mt5Id === 'PENDING' || account.mt5Id === 'PENDING_' + (account.userId || '').substring(0, 8) || !account.mt5Id) {
                this.logger.log(`Binding Account: User ${account.userId} linked to MT5 ID ${mt5_id}`);
                account.mt5Id = mt5_id.toString();
                isFirstBind = true;
            } else if (account.mt5Id !== mt5_id.toString()) {
                this.logger.warn(`Token/Account Mismatch: Token belongs to MT5 ID ${account.mt5Id}, but request came from ${mt5_id}.`);
                throw new ConflictException('Token belongs to another MT5 account');
            }

            // 3. Update Account Stats
            const wasConnected = account.isConnected;
            account.balance = stats.balance;
            account.equity = stats.equity;
            account.margin = stats.margin;
            account.marginFree = stats.margin_free;
            account.marginLevel = stats.margin_level;
            account.leverage = stats.leverage;
            account.isConnected = true;
            account.lastSeen = new Date();
            await queryRunner.manager.save(account);

            if (!wasConnected && account.userId) {
                this.telemetry?.recordMt5Metric('reconnectsRestored', 1);
                this.mt5Gateway.broadcastConnectionStatus(
                    { isConnected: true, accountId: account.id, mt5Id: account.mt5Id },
                    account.userId,
                );

                // Clear disconnect hysteresis flag silently on auto-reconnect;
                // Only send CONNECTED email on initial MT5 binding so routine auto-reconnects never spam the inbox!
                await this.cacheManager.del(`mt5:disc_notified:${account.id}`).catch(() => {});

                if (isFirstBind && account.notificationsEnabled !== false) {
                    const user = await queryRunner.manager.findOne(UserEntity, {
                        where: { id: account.userId },
                    });
                    if (user?.email) {
                        await this.emailProducer.enqueue(
                            user.email,
                            'MT5_STATUS',
                            {
                                userName: user.name || undefined,
                                mt5Id: account.mt5Id,
                                broker: account.broker,
                                status: 'CONNECTED',
                            },
                            { jobId: `mt5-first-connected:${account.id}:${account.mt5Id}` },
                        );
                    }
                }
            }

            // 4. Batch Upsert & Prune Closed Positions Atomically
            const newlyOpenedTickets: string[] = [];
            if (positions && positions.length > 0) {
                const existingPositions = await queryRunner.manager.find(PositionEntity, {
                    where: { accountId: account.id }
                });

                const positionMap = new Map<string, PositionEntity>();
                existingPositions.forEach(p => positionMap.set(p.ticket.toString(), p));

                const positionsToSave: PositionEntity[] = [];
                const incomingTickets: string[] = [];

                for (const pos of positions) {
                    const ticketStr = pos.ticket.toString();
                    incomingTickets.push(ticketStr);
                    let entity = positionMap.get(ticketStr);

                    if (entity) {
                        entity.profit = pos.profit;
                        entity.currentPrice = pos.currentPrice;
                        entity.volume = pos.volume;
                        entity.sl = pos.sl;
                        entity.tp = pos.tp;
                        positionsToSave.push(entity);
                    } else {
                        const newPos = this.positionRepo.create({
                            accountId: account.id,
                            ticket: ticketStr,
                            symbol: pos.symbol,
                            type: pos.type,
                            volume: pos.volume,
                            openPrice: pos.openPrice,
                            currentPrice: pos.currentPrice,
                            profit: pos.profit,
                            sl: pos.sl,
                            tp: pos.tp,
                            openTime: new Date(pos.openTime * 1000), // Ensure timestamp conversion if needed, MQL5 sends seconds
                        });
                        positionsToSave.push(newPos);
                        newlyOpenedTickets.push(ticketStr);
                    }
                }

                if (positionsToSave.length > 0) {
                    await queryRunner.manager.save(positionsToSave);
                }

                if (incomingTickets.length > 0) {
                    await queryRunner.manager
                        .createQueryBuilder()
                        .delete()
                        .from(PositionEntity)
                        .where('account_id = :accountId', { accountId: account.id })
                        .andWhere('ticket NOT IN (:...tickets)', { tickets: incomingTickets })
                        .execute();
                }
            } else {
                await queryRunner.manager.delete(PositionEntity, { accountId: account.id });
            }

            await queryRunner.commitTransaction();

            // Live Pre-Close Behavioral Guardrail on newly opened positions
            if (newlyOpenedTickets.length > 0 && account.userId && typeof this.behavioralQueue?.add === 'function') {
                for (const ticketStr of newlyOpenedTickets) {
                    this.behavioralQueue
                        .add(
                            'analyze-open-position',
                            { userId: account.userId, accountId: account.id, ticket: ticketStr },
                            {
                                delay: 1000,
                                removeOnComplete: true,
                                removeOnFail: true,
                                jobId: `behavior-open:${account.id}:${ticketStr}`,
                            },
                        )
                        .catch((err) =>
                            this.logger.warn(
                                `Failed to queue open-position behavioral guardrail for ticket ${ticketStr}: ${err?.message || err}`,
                            ),
                        );
                }
            }

            // Broadcast Update (scoped to account.userId)
            if (account.userId) {
                this.mt5Gateway.broadcastAccountUpdate({
                    balance: stats.balance,
                    equity: stats.equity,
                    margin: stats.margin,
                    marginFree: stats.margin_free,
                    marginLevel: stats.margin_level,
                    positions: positions // Assuming positions match IPosition interface (verify below if needed)
                }, account.userId);
            }

            return { success: true };

        } catch (err) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Sync failed: ${err.message}`);
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async saveHistory(trades: any[], importMethod: ImportMethod = ImportMethod.EA, userId?: string, accountId?: string) {
        try {
            // 1. Resolve and validate Account ID
            let resolvedAccountId = (accountId && accountId !== 'all' && accountId !== 'undefined' && accountId !== 'null' && accountId !== '')
                ? accountId
                : null;

            if (resolvedAccountId && userId) {
                // Verify that the requested account exists, belongs to this user, and is not archived
                const userAcc = await this.accountRepo.findOne({ where: { id: resolvedAccountId, userId, isArchived: false } });
                if (!userAcc) {
                    this.logger.warn(`Specified account ${resolvedAccountId} not found or archived for user ${userId}. Falling back to primary.`);
                    resolvedAccountId = null;
                }
            }

            if (!resolvedAccountId && userId) {
                const account = await this.accountRepo.findOne({ where: { userId, isArchived: false, isPrimary: true } })
                    || await this.accountRepo.findOne({ where: { userId, isArchived: false }, order: { lastSeen: 'DESC' } });
                if (account) {
                    resolvedAccountId = account.id;
                } else {
                    this.logger.warn(`No account found for user ${userId}. Creating a default manual account to store imported trades.`);
                    const newAcc = this.accountRepo.create({
                        userId: userId,
                        name: 'Conta Principal',
                        broker: 'MetaTrader 5',
                        type: AccountType.LIVE,
                        currency: 'USD',
                        isPrimary: true,
                        isConnected: false
                    });
                    const savedAcc = await this.accountRepo.save(newAcc);
                    resolvedAccountId = savedAcc.id;
                }
            }

            // 2. Normalization Step (Fast)
            const normalizedTrades = this.normalizationService.normalizeBatch(trades, importMethod);

            if (normalizedTrades.length === 0) {
                return { success: true, count: 0, accountId: resolvedAccountId, message: 'Nenhuma operação válida para importar' };
            }

            // 3. Process trade import DIRECTLY and synchronously for reliability.
            // This ensures trades are immediately committed to PostgreSQL, replicated to ClickHouse,
            // and made instantly visible in the UI without relying on background queue lag.
            const result = await this.processTradeImport({
                trades: normalizedTrades,
                importMethod,
                userId,
                accountId: resolvedAccountId
            });

            this.logger.log(`Imported and saved ${result.count} trades (Method: ${importMethod}, User: ${userId || 'N/A'}, Account: ${resolvedAccountId || 'N/A'})`);

            return {
                success: true,
                count: result.count,
                accountId: resolvedAccountId,
                message: `Importamos ${result.count} operações com sucesso!`
            };

        } catch (err) {
            this.logger.error(`Failed to save trade history: ${err.message}`, err.stack);
            throw err;
        }
    }

    async processTradeImport(data: { trades: any[], importMethod: ImportMethod, userId?: string, accountId?: string }) {
        const { trades, importMethod, userId, accountId } = data;

        // Resolve target user if not explicitly passed
        let targetUserId = userId;
        if (!targetUserId && accountId) {
            const acc = await this.accountRepo.findOne({ where: { id: accountId } });
            if (acc) targetUserId = acc.userId;
        }

        // Prevent foreign key violation if the user has been deleted or ID is invalid (stale queue jobs)
        if (targetUserId) {
            const userRepo = this.dataSource.getRepository(UserEntity);
            const userExists = await userRepo.findOne({ where: { id: targetUserId } });
            if (!userExists) {
                this.logger.warn(`User with ID ${targetUserId} not found in database. Discarding background trade import.`);
                return { count: 0 };
            }
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            if (!accountId) {
                this.logger.warn(`processTradeImport called without accountId for user ${targetUserId || 'N/A'}. Aborting to prevent global ticket collision.`);
                await queryRunner.rollbackTransaction();
                return { count: 0 };
            }

            const tradesToSave: TradeEntity[] = [];
            const tickets = Array.from(new Set(
                trades.flatMap(t => [
                    (t.ticket || t.contractId)?.toString(),
                    t.dealTicket?.toString(),
                    t.positionId?.toString(),
                ]).filter(Boolean)
            ));
            const contractIds = Array.from(new Set(
                trades.flatMap(t => [
                    (t.contractId || t.ticket)?.toString(),
                    t.dealTicket?.toString(),
                    t.positionId?.toString(),
                ]).filter(Boolean)
            ));

            // Fetch existing tickets and contractIds in batch strictly scoped to this accountId (using ANY($2::text[]) — 2 bind params only)
            const allLookupKeys = Array.from(new Set([...tickets, ...contractIds].filter(Boolean)));
            let existingTrades: Array<{ ticket?: string; contractId?: string }> = [];
            if (allLookupKeys.length > 0) {
                await queryRunner.query('SAVEPOINT sp_find_existing');
                try {
                    const rawRows = await queryRunner.query(
                        `SELECT ticket, "contractId"
                         FROM trades
                         WHERE account_id = $1
                           AND (ticket = ANY($2::text[]) OR "contractId" = ANY($2::text[]))`,
                        [accountId, allLookupKeys]
                    );
                    existingTrades = rawRows || [];
                } catch (findErr) {
                    await queryRunner.query('ROLLBACK TO SAVEPOINT sp_find_existing');
                    const rawRows = await queryRunner.query(
                        `SELECT ticket, "contractId" FROM trades WHERE account_id = $1`,
                        [accountId]
                    ).catch(() => []);
                    existingTrades = rawRows || [];
                }
            }
            const existingTickets = new Set(existingTrades.map(t => t.ticket?.toString()).filter(Boolean));
            const existingContracts = new Set(existingTrades.map(t => t.contractId?.toString()).filter(Boolean));
            const seenInBatch = new Set<string>();
            const maxAllowedCloseMs = Date.now() + 2 * 24 * 60 * 60 * 1000;

            for (const t of trades) {
                const rawTypeStr = (t.type || '').toString().trim().toLowerCase();
                if (rawTypeStr.includes('limit') || rawTypeStr.includes('stop') || rawTypeStr.includes('balance') || rawTypeStr.includes('credit')) {
                    continue;
                }
                const normalizedType = rawTypeStr.includes('sell') || rawTypeStr.includes('put') ? 'SELL' : 'BUY';

                const ticket = t.ticket ? t.ticket.toString().trim() : (t.contractId ? t.contractId.toString().trim() : null);
                const dealTicket = t.dealTicket ? t.dealTicket.toString().trim() : null;
                const contractId = (t.contractId ? t.contractId.toString().trim() : ticket) || `TR_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

                // Deduping against DB (strictly within this account, checking both Position Ticket and Deal Ticket)
                if (
                    (ticket && (existingTickets.has(ticket) || existingContracts.has(ticket))) ||
                    (contractId && (existingContracts.has(contractId) || existingTickets.has(contractId))) ||
                    (dealTicket && (existingTickets.has(dealTicket) || existingContracts.has(dealTicket)))
                ) {
                    continue;
                }

                // Deduping against current batch
                const batchKey = `${accountId}:${contractId}`;
                if (seenInBatch.has(batchKey)) continue;
                seenInBatch.add(batchKey);

                if (ticket) existingTickets.add(ticket);
                if (contractId) existingContracts.add(contractId);

                if (!t.openTime) continue;
                const parsedOpen = new Date(t.openTime);
                if (isNaN(parsedOpen.getTime())) continue;

                const isTradeClosed = t.status === 'CLOSED' || !!t.closeTime || t.closePrice > 0 || (t.profit !== undefined && t.profit !== null);
                const parsedClose = t.closeTime ? new Date(t.closeTime) : null;
                const hasValidCloseTime = Boolean(parsedClose && !isNaN(parsedClose.getTime()) && parsedClose.getTime() <= maxAllowedCloseMs);
                const finalCloseTime = hasValidCloseTime
                    ? parsedClose
                    : (isTradeClosed ? parsedOpen : null);
                const computedDataQuality = t.dataQuality || (isTradeClosed && !hasValidCloseTime ? 'partial' : 'ok');

                const safeNum = (val: any, fallback = 0): number => {
                    const n = Number(val);
                    return Number.isFinite(n) ? n : fallback;
                };
                const rawMagic = safeNum(t.magic, 0);
                const safeMagic = rawMagic >= -2147483648 && rawMagic <= 2147483647 ? Math.trunc(rawMagic) : 0;
                const safeProfit = safeNum(t.profit, 0);
                const safeCommission = safeNum(t.commission, 0);
                const safeSwap = safeNum(t.swap, 0);
                const safeNetPnl = t.netPnl !== undefined && t.netPnl !== null
                    ? safeNum(t.netPnl, safeProfit + safeCommission + safeSwap)
                    : (safeProfit + safeCommission + safeSwap);

                const newTrade: TradeEntity = this.tradeRepo.create({
                    accountId: accountId,
                    ticket: ticket,
                    contractId: contractId,
                    symbol: (t.symbol || 'Unknown').toString().substring(0, 100),
                    type: normalizedType,
                    volume: safeNum(t.volume, 0),
                    openPrice: safeNum(t.openPrice, 0),
                    closePrice: safeNum(t.closePrice, 0),
                    profit: safeProfit,
                    commission: safeCommission,
                    swap: safeSwap,
                    netPnl: safeNetPnl,
                    sl: t.sl !== undefined && t.sl !== null && safeNum(t.sl, 0) > 0 ? safeNum(t.sl, 0) : null,
                    tp: t.tp !== undefined && t.tp !== null && safeNum(t.tp, 0) > 0 ? safeNum(t.tp, 0) : null,
                    openTime: parsedOpen,
                    closeTime: finalCloseTime,
                    status: isTradeClosed ? 'CLOSED' : (t.status || 'OPEN'),
                    magic: safeMagic,
                    comment: t.comment ? t.comment.toString().substring(0, 255) : null,
                    session: t.session || null,
                    dataQuality: computedDataQuality
                } as Partial<TradeEntity>) as TradeEntity;

                // Ensure entity type is correctly cast
                tradesToSave.push(newTrade);
            }

            let finalLogId = null;
            let tradesForDownstream: TradeEntity[] = [];
            if (tradesToSave.length > 0) {
                // Update Account balance with net PnL of new trades ONLY for manual/file imports.
                // For AUTO_SYNC, syncAccountMetrics already sets the authoritative real-time MT5 balance & equity.
                if (accountId && importMethod !== ImportMethod.AUTO_SYNC) {
                    const acc = await queryRunner.manager.findOne(AccountEntity, { where: { id: accountId } });
                    if (acc) {
                        const netPnLDelta = tradesToSave.reduce((sum, tr) => sum + (Number(tr.profit || 0) + Number(tr.commission || 0) + Number(tr.swap || 0)), 0);
                        acc.balance = Number((Number(acc.balance || 0) + netPnLDelta).toFixed(2));
                        acc.equity = Number((Number(acc.equity || acc.balance) + netPnLDelta).toFixed(2));
                        await queryRunner.manager.save(acc);
                    }
                }
                if (targetUserId) {
                    try {
                        let accountName = '';
                        if (accountId) {
                            const acc = await this.accountRepo.findOne({ where: { id: accountId } });
                            if (acc) accountName = acc.name || acc.broker || '';
                        }

                        const log = this.importLogRepo.create({
                            userId: targetUserId,
                            accountId: accountId || null,
                            method: importMethod,
                            status: ImportStatus.SUCCESS,
                            tradesCount: tradesToSave.length,
                            details: accountName 
                                ? `Importadas ${tradesToSave.length} operações na conta "${accountName}"`
                                : `Importadas ${tradesToSave.length} operações via ${importMethod}`
                        });
                        const savedLog = await this.importLogRepo.save(log);
                        finalLogId = savedLog.id;
                    } catch (logErr) {
                        this.logger.warn(`Could not persist importLog (continuing trade save): ${logErr.message}`);
                    }
                }

                if (finalLogId) {
                    for (const trade of tradesToSave) {
                        trade.importLogId = finalLogId;
                    }
                }

                // Insert in safe 500-row chunks with ON CONFLICT DO NOTHING so large imports never exceed PostgreSQL's 65,535 bind parameter limit
                await queryRunner.query('SAVEPOINT sp_batch_trades');
                try {
                    const CHUNK_SIZE = 500;
                    for (let i = 0; i < tradesToSave.length; i += CHUNK_SIZE) {
                        const chunk = tradesToSave.slice(i, i + CHUNK_SIZE);
                        await queryRunner.manager
                            .createQueryBuilder()
                            .insert()
                            .into(TradeEntity)
                            .values(chunk)
                            .orIgnore()
                            .execute();
                    }
                } catch (batchErr) {
                    await queryRunner.query('ROLLBACK TO SAVEPOINT sp_batch_trades');
                    this.logger.warn(`Batch insert fallback triggered for account ${accountId}: ${batchErr.message}`);
                    for (const singleTrade of tradesToSave) {
                        await queryRunner.query('SAVEPOINT sp_single_trade');
                        try {
                            await queryRunner.manager.save(TradeEntity, singleTrade);
                        } catch (singleErr) {
                            await queryRunner.query('ROLLBACK TO SAVEPOINT sp_single_trade');
                            await queryRunner.query('SAVEPOINT sp_raw_sql_trade');
                            try {
                                await queryRunner.query(
                                    `INSERT INTO trades (
                                        account_id, ticket, "contractId", symbol, type,
                                        volume, open_price, close_price, profit, commission,
                                        swap, "netPnl", sl, tp, open_time, close_time,
                                        status, magic, comment, session, "dataQuality", import_log_id
                                    ) VALUES (
                                        $1, $2, $3, $4, $5,
                                        $6, $7, $8, $9, $10,
                                        $11, $12, $13, $14, $15, $16,
                                        $17, $18, $19, $20, $21, $22
                                    )`,
                                    [
                                        singleTrade.accountId,
                                        singleTrade.ticket,
                                        singleTrade.contractId,
                                        singleTrade.symbol || 'Unknown',
                                        singleTrade.type || 'BUY',
                                        Number(singleTrade.volume || 0),
                                        Number(singleTrade.openPrice || 0),
                                        Number(singleTrade.closePrice || 0),
                                        Number(singleTrade.profit || 0),
                                        Number(singleTrade.commission || 0),
                                        Number(singleTrade.swap || 0),
                                        Number(singleTrade.netPnl || 0),
                                        singleTrade.sl ?? null,
                                        singleTrade.tp ?? null,
                                        singleTrade.openTime,
                                        singleTrade.closeTime ?? null,
                                        singleTrade.status || 'CLOSED',
                                        singleTrade.magic ?? 0,
                                        singleTrade.comment ?? null,
                                        singleTrade.session ?? null,
                                        singleTrade.dataQuality || 'ok',
                                        singleTrade.importLogId ?? null,
                                    ]
                                );
                            } catch (rawSqlErr) {
                                await queryRunner.query('ROLLBACK TO SAVEPOINT sp_raw_sql_trade');
                                this.logger.warn(`Skipped single trade ${singleTrade.ticket}: ${rawSqlErr.message}`);
                            }
                        }
                    }
                }
                
                // Fetch saved records with generated IDs using ANY($2::text[]) (2 bind params only)
                let savedTrades: TradeEntity[] = [];
                await queryRunner.query('SAVEPOINT sp_fetch_saved');
                try {
                    const savedContractIds = tradesToSave.map(t => String(t.contractId)).filter(Boolean);
                    savedTrades = savedContractIds.length > 0
                        ? await queryRunner.manager
                              .createQueryBuilder(TradeEntity, 't')
                              .where('t.account_id = :accountId', { accountId })
                              .andWhere('t."contractId" = ANY(:savedContractIds)', { savedContractIds })
                              .getMany()
                        : [];
                } catch (fetchSavedErr) {
                    await queryRunner.query('ROLLBACK TO SAVEPOINT sp_fetch_saved');
                    this.logger.warn(`Fallback to in-memory trades for downstream replication: ${fetchSavedErr.message}`);
                }

                tradesForDownstream = savedTrades.length > 0 ? savedTrades : tradesToSave;
            }

            await queryRunner.commitTransaction();

            // Replicate to ClickHouse AFTER PostgreSQL transaction commits
            if (tradesForDownstream.length > 0) {
                this.clickHouseService.saveTrades(tradesForDownstream).catch(err => {
                    this.logger.warn(`ClickHouse async trade replication warning: ${err.message}`);
                });
            }

            if (tradesToSave.length > 0) {
                // Broadcast updates
                try {
                    const protoTrades = tradesToSave.map(t => ({
                        ticket: Number(t.ticket) || 0,
                        symbol: t.symbol,
                        type: t.type,
                        volume: t.volume,
                        openPrice: t.openPrice,
                        closePrice: t.closePrice,
                        openTime: new Date(t.openTime).getTime(),
                        closeTime: t.closeTime ? new Date(t.closeTime).getTime() : 0,
                        profit: t.profit,
                        commission: t.commission,
                        swap: t.swap,
                        comment: t.comment
                    }));

                    if (targetUserId) {
                        this.mt5Gateway.broadcastHistoryUpdate({
                            count: tradesToSave.length,
                            trades: protoTrades
                        }, targetUserId);
                    }
                } catch (e) {
                    this.logger.warn(`Broadcast failed: ${e.message}`);
                }

                // Invalidate Dashboard Cache immediately so trades reflect in all charts and stats
                if (targetUserId) {
                    try {
                        await this.dashboardService.invalidateUserCache(targetUserId);
                    } catch (cacheErr) {
                        this.logger.warn(`Cache invalidation failed: ${cacheErr.message}`);
                    }
                }

                // Notifications & Governance
                if (targetUserId) {
                    try {
                        const methodLabelMap: Record<string, string> = {
                            [ImportMethod.FILE]: 'Importou arquivo de trades',
                            [ImportMethod.EA]: 'Sincronizou trades via EA MT5',
                            [ImportMethod.AUTO_SYNC]: 'Sincronização automática MT5',
                            [ImportMethod.MANUAL]: 'Adicionou trade manualmente',
                            [ImportMethod.DERIV]: 'Sincronizou trades Deriv',
                        };
                        const actionLabel = `${methodLabelMap[importMethod] || 'Importou trades'} (${tradesToSave.length})`;
                        await this.dataSource.getRepository(UserEntity).update(targetUserId, {
                            lastActiveAt: new Date(),
                            lastActionType: 'trade_import',
                            lastActionLabel: actionLabel.slice(0, 180),
                            lastActionPath: '/add-trades',
                        });
                    } catch (actErr: any) {
                        this.logger.warn(`Activity update warning after import: ${actErr?.message || actErr}`);
                    }
                    try {
                        const isManualFileImport = importMethod === ImportMethod.FILE;
                        if (isManualFileImport) {
                            this.telemetry?.recordMt5Metric('manualFileImports', 1);
                            const user = await this.dataSource
                                .getRepository(UserEntity)
                                .findOne({ where: { id: targetUserId } });
                            const targetAccount = accountId
                                ? await this.accountRepo.findOne({ where: { id: accountId } })
                                : null;

                            const batchNetPnl = tradesToSave.reduce(
                                (sum, t) =>
                                    sum +
                                    (Number(t.profit) || 0) +
                                    (Number(t.commission) || 0) +
                                    (Number(t.swap) || 0),
                                0,
                            );
                            const wins = tradesToSave.filter((t) => Number(t.profit) > 0).length;
                            const losses = tradesToSave.filter((t) => Number(t.profit) < 0).length;

                            if (user?.email) {
                                await this.emailProducer.enqueue(user.email, 'TRADE_IMPORTED', {
                                    userName: user.name || undefined,
                                    count: tradesToSave.length,
                                    method: importMethod,
                                    profit: batchNetPnl,
                                    currency: targetAccount?.currency || 'USD',
                                    wins,
                                    losses,
                                    accountName: targetAccount?.name,
                                });
                            }

                            await this.notificationsService
                                .create(
                                    targetUserId,
                                    {
                                        title: 'Importação de Operações Concluída',
                                        message: `${tradesToSave.length} operações foram processadas no histórico.`,
                                        type: NotificationType.SYSTEM,
                                    },
                                    { skipEmail: true, skipExternal: true },
                                )
                                .catch((e) =>
                                    this.logger.warn(
                                        `Could not create in-app import notification: ${e.message}`,
                                    ),
                                );
                        } else {
                            this.telemetry?.recordMt5Metric('autoSyncBatches', 1);
                        }

                        // Risk & Behavioral Analysis (runs silently on all imports, alerts only when risk thresholds breach)
                        if (accountId) {
                            await this.processProfessionalAlerts(
                                targetUserId,
                                accountId,
                                tradesToSave,
                            ).catch((e) =>
                                this.logger.warn(`Professional alerts warning: ${e.message}`),
                            );

                            this.eventEmitter.emit('trades.imported', {
                                userId: targetUserId,
                                accountId,
                                trades: tradesToSave,
                            });

                            this.behavioralQueue
                                .add(
                                    'analyze-user-behavior',
                                    { userId: targetUserId, accountId },
                                    {
                                        delay: 2000,
                                        removeOnComplete: true,
                                        removeOnFail: true,
                                        jobId: `behavior:${accountId}`,
                                    },
                                )
                                .catch((e) =>
                                    this.logger.warn(
                                        `Failed to queue behavioral analysis: ${e.message}`,
                                    ),
                                );
                        }
                    } catch (notifErr: any) {
                        this.logger.warn(`Post-import notification warning: ${notifErr.message}`);
                    }
                }

                // AI Insights
                if (accountId && targetUserId) {
                    try {
                        const totalProfitLoss = tradesToSave.reduce((sum, t) => sum + (Number(t.profit) || 0), 0);
                        const metricsSummary = {
                            tradesCount: tradesToSave.length,
                            totalProfitLoss,
                            symbolsTraded: [...new Set(tradesToSave.map(t => t.symbol))]
                        };

                        this.aiService?.generateInsights(accountId, targetUserId, metricsSummary, finalLogId)
                            .catch(e => this.logger.warn(`AI generation trigger failed: ${e.message}`));
                    } catch (e) {
                        this.logger.error(`AI metric aggregation failed: ${e.message}`);
                    }
                }
            }

            return { success: true, count: tradesToSave.length };

        } catch (err) {
            if (queryRunner.isTransactionActive) {
                await queryRunner.rollbackTransaction();
            }
            this.logger.error(`Background trade import failed: ${err.message}`, err.stack);
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async saveHistoryDeal(data: any) {
        const { deal, mt5_id } = data;

        try {
            await this.historyRepo.save({
                ticket: deal.ticket,
                mt5_id: mt5_id,
                symbol: deal.symbol,
                type: deal.type,
                volume: deal.volume,
                profit: deal.profit,
                open_price: deal.openPrice || deal.open_price, // Handle both just in case
                close_price: deal.closePrice || deal.close_price,
                open_time: deal.openTime || deal.open_time,
                close_time: deal.closeTime || deal.close_time
            });
            // History deal saved
        } catch (e: any) {
            if (e.code !== '23505') {
                this.logger.warn(`Failed to save history deal ticket=${deal?.ticket}: ${e?.message || e}`);
            }
        }
    }

    async updateJournal(ticket: string | number, journalData: Partial<TradeEntity>, userId?: string) {
        const ticketStr = ticket.toString();
        let trade: TradeEntity | null = null;

        if (userId) {
            const accounts = await this.accountRepo.find({ where: { userId } });
            const accountIds = accounts.map(a => a.id);
            if (accountIds.length > 0) {
                trade = await this.tradeRepo.findOne({
                    where: [
                        { ticket: ticketStr, accountId: In(accountIds) },
                        { contractId: ticketStr, accountId: In(accountIds) }
                    ]
                });
            }
        } else {
            trade = await this.tradeRepo.findOne({ where: { ticket: ticketStr } });
        }

        if (!trade) {
            throw new Error('Trade not found or access denied');
        }

        trade.mood = journalData.mood;
        trade.rating = journalData.rating;
        trade.setup = journalData.setup;
        trade.lesson = journalData.lesson;
        trade.tags = journalData.tags;

        const saved = await this.tradeRepo.save(trade);
        this.clickHouseService.saveTrade(saved).catch(() => {});
        return saved;
    }

    async submitBehaviorFeedback(
        tradeIdOrTicket: string,
        feedback: {
            verdict: 'CONFIRM' | 'FALSE_POSITIVE';
            correctedFlags?: string[];
            note?: string;
        },
        userId: string,
    ) {
        const cleanKey = String(tradeIdOrTicket || '').trim();
        if (!cleanKey) {
            throw new BadRequestException('Identificador de trade inválido.');
        }
        if (feedback?.verdict !== 'CONFIRM' && feedback?.verdict !== 'FALSE_POSITIVE') {
            throw new BadRequestException('Veredito inválido: utilize CONFIRM ou FALSE_POSITIVE.');
        }

        const accounts = await this.accountRepo.find({ where: { userId } });
        const accountIds = accounts.map((a) => a.id);
        if (accountIds.length === 0) {
            throw new NotFoundException('Trade não encontrado ou acesso negado.');
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanKey);
        const whereClauses: any[] = [
            { ticket: cleanKey, accountId: In(accountIds) },
            { contractId: cleanKey, accountId: In(accountIds) },
        ];
        if (isUuid) {
            whereClauses.unshift({ id: cleanKey, accountId: In(accountIds) });
        }

        const trade = await this.tradeRepo.findOne({ where: whereClauses });
        if (!trade) {
            throw new NotFoundException('Trade não encontrado ou acesso negado.');
        }

        const existingFlags =
            trade.qualityFlags && typeof trade.qualityFlags === 'object'
                ? trade.qualityFlags
                : {};
        const correctedFlags = Array.isArray(feedback.correctedFlags)
            ? feedback.correctedFlags
                  .map((f) => String(f || '').trim())
                  .filter(Boolean)
                  .slice(0, 6)
            : [];

        const behavioralFeedback = {
            verdict: feedback.verdict,
            correctedFlags,
            note: feedback.note ? String(feedback.note).trim().slice(0, 500) : null,
            updatedAt: new Date().toISOString(),
        };

        trade.qualityFlags = {
            ...existingFlags,
            behavioralFeedback,
        };
        await this.tradeRepo.save(trade);

        if (typeof this.dashboardService?.invalidateUserCache === 'function') {
            await this.dashboardService.invalidateUserCache(userId).catch(() => {});
        }

        if (feedback.verdict === 'FALSE_POSITIVE' && this.dataSource) {
            try {
                await this.dataSource
                    .getRepository(AlertEntity)
                    .update({ userId, tradeId: trade.id, resolved: false }, { resolved: true });
            } catch (err: any) {
                this.logger.warn(
                    `Failed to auto-resolve alerts after false-positive feedback for trade ${trade.id}: ${err?.message || err}`,
                );
            }
        }

        return {
            success: true,
            tradeId: trade.id,
            behavioralFeedback,
        };
    }

    async getBehaviorAnalytics(userId: string, accountId?: string) {
        const accounts = await this.accountRepo.find({
            where: { userId, isArchived: false },
            select: ['id', 'name', 'type'],
        });
        const scopedAccounts =
            accountId && accountId !== 'all'
                ? accounts.filter((a) => a.id === accountId)
                : accounts;
        const accountIds = scopedAccounts.map((a) => a.id);

        const baseUrl = (
            process.env.BEHAVIOR_ML_URL ||
            process.env.QUANT_ENGINE_URL ||
            'http://127.0.0.1:8001'
        )
            .trim()
            .replace(/\/$/, '');

        let engineStatus: any = { status: 'offline' };
        try {
            const res = await fetch(`${baseUrl}/api/ml/behavior/status`, {
                headers: getQuantInternalHeaders(),
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok) {
                engineStatus = await res.json();
            }
        } catch {
            engineStatus = { status: 'offline' };
        }

        if (accountIds.length === 0) {
            return {
                status: 'ok',
                summary: {
                    totalTrades: 0,
                    scoredTrades: 0,
                    flaggedTrades: 0,
                    avgAnomalyScore: 0,
                    confirmCount: 0,
                    falsePositiveCount: 0,
                    riskBreakdown: { LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 },
                    patternCounts: {},
                },
                engineStatus,
            };
        }

        const trades = await this.tradeRepo.find({
            where: { accountId: In(accountIds), status: 'CLOSED' },
            select: ['id', 'qualityFlags'],
        });

        const riskBreakdown = { LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 };
        const patternCounts: Record<string, number> = {};
        let scoredTrades = 0;
        let flaggedTrades = 0;
        let anomalySum = 0;
        let confirmCount = 0;
        let falsePositiveCount = 0;

        for (const t of trades) {
            const qf = t.qualityFlags && typeof t.qualityFlags === 'object' ? t.qualityFlags : {};
            const ml = qf.behavioralMl;
            const fb = qf.behavioralFeedback;

            if (fb?.verdict === 'CONFIRM') confirmCount += 1;
            else if (fb?.verdict === 'FALSE_POSITIVE') falsePositiveCount += 1;

            if (!ml || typeof ml !== 'object') continue;
            scoredTrades += 1;
            const anom = Number(ml.anomalyScore) || 0;
            anomalySum += anom;

            const risk = String(ml.riskLevel || 'LOW').toUpperCase();
            if (risk in riskBreakdown) {
                (riskBreakdown as Record<string, number>)[risk] += 1;
            }

            const flags = Array.isArray(ml.activeFlags) ? ml.activeFlags : [];
            const isFlagged =
                fb?.verdict !== 'FALSE_POSITIVE' &&
                (flags.length > 0 || risk === 'MODERATE' || risk === 'HIGH' || risk === 'CRITICAL');
            if (isFlagged) {
                flaggedTrades += 1;
            }
            if (fb?.verdict !== 'FALSE_POSITIVE') {
                for (const flag of flags) {
                    const key = String(flag || '').trim();
                    if (key) patternCounts[key] = (patternCounts[key] || 0) + 1;
                }
            }
        }

        return {
            status: 'ok',
            summary: {
                totalTrades: trades.length,
                scoredTrades,
                flaggedTrades,
                avgAnomalyScore: scoredTrades > 0 ? Number((anomalySum / scoredTrades).toFixed(2)) : 0,
                confirmCount,
                falsePositiveCount,
                riskBreakdown,
                patternCounts,
            },
            engineStatus,
        };
    }

    /**
     * Closed trades where the behavior model raised at least one flag and the trader has not
     * given a verdict yet. Feeds the review queue that collects human labels for retraining.
     */
    async getBehaviorReviewQueue(userId: string, accountId?: string, limit = 50) {
        const accounts = await this.accountRepo.find({
            where: { userId, isArchived: false },
            select: ['id', 'name'],
        });
        const scopedAccounts =
            accountId && accountId !== 'all'
                ? accounts.filter((a) => a.id === accountId)
                : accounts;
        const accountIds = scopedAccounts.map((a) => a.id);
        if (accountIds.length === 0) {
            return { items: [], pendingCount: 0, reviewedCount: 0 };
        }
        const accountNames = new Map(scopedAccounts.map((a) => [a.id, a.name]));
        const safeLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));

        const flaggedBase = () =>
            this.tradeRepo
                .createQueryBuilder('t')
                .where('t.accountId IN (:...accountIds)', { accountIds })
                .andWhere("t.status = 'CLOSED'")
                .andWhere(
                    "jsonb_typeof(t.qualityFlags -> 'behavioralMl' -> 'activeFlags') = 'array'"
                )
                .andWhere(
                    "jsonb_array_length(t.qualityFlags -> 'behavioralMl' -> 'activeFlags') > 0"
                );

        const pendingQb = flaggedBase().andWhere("(t.qualityFlags -> 'behavioralFeedback') IS NULL");
        const [rows, pendingCount, reviewedCount] = await Promise.all([
            pendingQb
                .clone()
                .select([
                    't.id',
                    't.accountId',
                    't.ticket',
                    't.symbol',
                    't.type',
                    't.volume',
                    't.openTime',
                    't.closeTime',
                    't.profit',
                    't.netPnl',
                    't.qualityFlags',
                ])
                .orderBy('t.closeTime', 'DESC', 'NULLS LAST')
                .take(safeLimit)
                .getMany(),
            pendingQb.clone().getCount(),
            flaggedBase().andWhere("(t.qualityFlags -> 'behavioralFeedback') IS NOT NULL").getCount(),
        ]);

        const items = rows.map((t) => {
            const ml = (t.qualityFlags && t.qualityFlags.behavioralMl) || {};
            return {
                id: t.id,
                accountId: t.accountId,
                accountName: accountNames.get(t.accountId) || null,
                ticket: t.ticket,
                symbol: t.symbol,
                type: t.type,
                volume: t.volume,
                openTime: t.openTime,
                closeTime: t.closeTime,
                netPnl: t.netPnl ?? t.profit,
                behavioralMl: {
                    riskLevel: ml.riskLevel ?? null,
                    anomalyScore: Number(ml.anomalyScore) || 0,
                    activeFlags: Array.isArray(ml.activeFlags) ? ml.activeFlags : [],
                    reasons: Array.isArray(ml.reasons) ? ml.reasons.slice(0, 3) : [],
                    probabilities: ml.probabilities && typeof ml.probabilities === 'object' ? ml.probabilities : {},
                },
            };
        });

        return { items, pendingCount, reviewedCount };
    }

    async createManualTrade(data: any, userId: string): Promise<TradeEntity> {
        let account: AccountEntity | null = null;
        if (data?.accountId && data.accountId !== 'all') {
            account = await this.accountRepo.findOne({ where: { id: data.accountId, userId, isArchived: false } });
        }
        if (!account) {
            account = await this.accountRepo.findOne({ where: { userId, isArchived: false, isPrimary: true } })
                || await this.accountRepo.findOne({ where: { userId, isArchived: false }, order: { lastSeen: 'DESC' } });
        }
        if (!account) {
            throw new Error('Conta de trading não encontrada para este usuário.');
        }

        const ticket = (data.ticket || Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)).toString();
        const profit = Number(data.profit) || 0;
        const commission = Number(data.commission) || 0;
        const swap = Number(data.swap) || 0;

        const newTrade = this.tradeRepo.create({
            accountId: account.id,
            ticket,
            contractId: ticket,
            symbol: data.symbol,
            type: data.type,
            volume: data.volume,
            openPrice: data.openPrice,
            closePrice: data.closePrice,
            openTime: new Date(data.openTime),
            closeTime: new Date(data.closeTime),
            profit,
            commission,
            swap,
            netPnl: profit + commission + swap,
            magic: 0,
            comment: 'Manual Trade',
            session: this.calculateSession(new Date(data.openTime)),
            status: 'CLOSED',
            mood: data.mood,
            setup: data.setup
        });

        const saved = await this.tradeRepo.save(newTrade);
        this.clickHouseService.saveTrade(saved).catch(() => {});

        // Invalidate Dashboard Cache
        await this.dashboardService.invalidateUserCache(userId);

        this.eventEmitter.emit('trades.imported', {
            userId,
            accountId: saved.accountId,
            count: 1,
            symbols: saved.symbol ? [saved.symbol] : [],
            netPnl: Number(saved.profit) || 0,
        });

        // Broadcast manual trade as history update (scoped to userId)
        this.mt5Gateway.broadcastHistoryUpdate({
            count: 1,
            trades: [{
                ticket: Number(saved.ticket),
                symbol: saved.symbol,
                type: saved.type,
                volume: saved.volume,
                openPrice: saved.openPrice,
                closePrice: saved.closePrice,
                openTime: saved.openTime.getTime(),
                closeTime: saved.closeTime.getTime(),
                profit: saved.profit,
                commission: saved.commission,
                swap: saved.swap,
                comment: saved.comment
            }]
        }, userId);

        return saved;
    }

    async saveTick(data: any) {
        // data = { mt5_id, tick: { symbol, bid, ask, last, volume, time } }
        const { tick, mt5_id } = data;

        if (!tick || !tick.symbol) return;

        try {
            await this.clickHouseService.saveTick({
                timestamp: new Date(Number(tick.time)), // Ensure millis
                symbol: tick.symbol,
                bid: tick.bid,
                ask: tick.ask,
                last: tick.last || 0,
                volume: tick.volume || 0,
                mt5Id: mt5_id
            });
        } catch (e) {
            // Log only critical errors
            this.logger.error(`Tick Save Error: ${e.message}`);
        }
    }


    async getImportHistory(
        userId: string,
        accountId?: string,
        options?: { page?: number; limit?: number; paginated?: boolean }
    ) {
        const whereClause: any = { userId };
        if (accountId && accountId !== 'all') {
            whereClause.accountId = accountId;
        }

        const safeLimit = Math.min(200, Math.max(1, Number(options?.limit) || 30));
        if (options?.paginated) {
            const safePage = Math.max(1, Number(options?.page) || 1);
            const [items, total] = await this.importLogRepo.findAndCount({
                where: whereClause,
                relations: ['account'],
                order: { createdAt: 'DESC' },
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
            });
            return {
                items,
                total,
                page: safePage,
                limit: safeLimit,
                totalPages: Math.ceil(total / safeLimit),
            };
        }

        return this.importLogRepo.find({
            where: whereClause,
            relations: ['account'],
            order: { createdAt: 'DESC' },
            take: safeLimit,
        });
    }

    async revertImport(logId: number, userId: string) {
        const log = await this.importLogRepo.findOne({ where: { id: logId, userId } });
        if (!log) {
            throw new Error('Import log not found');
        }

        // Find associated trades to get IDs, PnL and account references before deletion
        const tradesToDelete = await this.tradeRepo.find({
            where: { importLogId: logId },
            select: ['id', 'accountId', 'profit', 'commission', 'swap']
        });
        const tradeIds = tradesToDelete.map(t => t.id);

        this.logger.log(`Reverting import log ${logId} for user ${userId}. Found ${tradeIds.length} trades to delete.`);

        // 1. Delete associated trades, reverse manual/file balance delta, and delete log in a PostgreSQL transaction FIRST
        await this.dataSource.transaction(async (manager) => {
            if (log.method !== ImportMethod.AUTO_SYNC && tradesToDelete.length > 0) {
                const pnlByAcc = new Map<string, number>();
                for (const tr of tradesToDelete) {
                    if (!tr.accountId) continue;
                    const trPnl = (Number(tr.profit) || 0) + (Number(tr.commission) || 0) + (Number(tr.swap) || 0);
                    pnlByAcc.set(tr.accountId, (pnlByAcc.get(tr.accountId) || 0) + trPnl);
                }
                for (const [accId, pnlDelta] of pnlByAcc.entries()) {
                    const acc = await manager.findOne(AccountEntity, { where: { id: accId, userId } });
                    if (acc) {
                        acc.balance = Number((Number(acc.balance || 0) - pnlDelta).toFixed(2));
                        acc.equity = Number((Number(acc.equity || acc.balance) - pnlDelta).toFixed(2));
                        await manager.save(AccountEntity, acc);
                    }
                }
            }

            await manager.createQueryBuilder()
                .delete()
                .from(TradeEntity)
                .where('import_log_id = :logId', { logId })
                .execute();

            if (tradeIds.length > 0) {
                await manager.delete(TradeEntity, tradeIds);
            }

            await manager.delete(ImportLog, logId);
        });

        // 2. Delete associated trades from ClickHouse AFTER PostgreSQL transaction commits
        this.clickHouseService.deleteTradesByImportLogId(logId).catch(() => {});
        if (tradeIds.length > 0) {
            this.clickHouseService.deleteTradesByIds(tradeIds).catch(() => {});
        }

        // 3. Invalidate dashboard cache so deleted trades disappear immediately
        if (userId) {
            await this.dashboardService.invalidateUserCache(userId);
        }

        // 4. Broadcast history update to connected WebSocket clients (scoped to userId)
        this.mt5Gateway.broadcastHistoryUpdate({ count: 0, trades: [] }, userId);

        return { success: true, message: 'Importação revertida e trades excluídos com sucesso de todas as bases' };
    }

    private async processProfessionalAlerts(userId: string, accountId: string, newTrades: TradeEntity[]) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Fetch account for balance/equity
            const account = await this.accountRepo.findOne({ where: { id: accountId } });
            if (!account) return;

            // Fetch all trades from today to check aggregate limits
            const dailyTrades = await this.tradeRepo.find({
                where: {
                    accountId,
                    closeTime: Between(today, new Date())
                }
            });

            // 1. Overtrading Alert
            if (dailyTrades.length > 20) {
                await this.alertsService.create(userId, {
                    type: AlertType.RISK,
                    severity: AlertSeverity.WARNING,
                    title: 'Alerta de Overtrading âš ï¸',
                    description: `VocÃª jÃ¡ executou ${dailyTrades.length} trades hoje. O excesso de operaÃ§Ãµes pode levar Ã  fadiga de decisÃ£o e perdas por indisciplina.`,
                    metadata: { count: dailyTrades.length, limit: 20 }
                });
            }

            // 2. Revenge Trading Detection
            // Check if multiple losses occurred in a short time, followed by rapid entries
            const recentLosses = dailyTrades
                .filter(t => Number(t.profit) < 0)
                .sort((a, b) => b.closeTime.getTime() - a.closeTime.getTime());

            if (recentLosses.length >= 3) {
                const latestLoss = recentLosses[0];
                const prevLoss = recentLosses[1];
                const diffMs = latestLoss.closeTime.getTime() - prevLoss.closeTime.getTime();

                if (diffMs < 1000 * 60 * 15) { // 3 losses in 45 mins (approx)
                    await this.alertsService.create(userId, {
                        type: AlertType.PSYCHOLOGY,
                        severity: AlertSeverity.CRITICAL,
                        title: 'DetecÃ§Ã£o de Revenge Trading ðŸ§ ',
                        description: 'Identificamos uma sequÃªncia rÃ¡pida de perdas. Evite tentar "recuperar" o mercado imediatamente. FaÃ§a uma pausa de 30 minutos.',
                        metadata: { sequence: 3, interval_mins: 15 }
                    });
                }
            }

            // 3. Risk:Reward Ratio Check
            const avgWin = dailyTrades.filter(t => Number(t.profit) > 0).reduce((sum, t) => sum + Number(t.profit), 0) / (dailyTrades.filter(t => Number(t.profit) > 0).length || 1);
            const avgLoss = dailyTrades.filter(t => Number(t.profit) < 0).reduce((sum, t) => sum + Math.abs(Number(t.profit)), 0) / (dailyTrades.filter(t => Number(t.profit) < 0).length || 1);

            if (avgLoss > 0 && (avgWin / avgLoss) < 0.8 && dailyTrades.length > 5) {
                await this.alertsService.create(userId, {
                    type: AlertType.PERFORMANCE,
                    severity: AlertSeverity.WARNING,
                    title: 'RelaÃ§Ã£o R:R Negativa ðŸ“Š',
                    description: `Seu Risk:Reward mÃ©dio hoje estÃ¡ em ${(avgWin / avgLoss).toFixed(2)}:1. VocÃª estÃ¡ arriscando muito para ganhar pouco.`,
                    metadata: { ratio: (avgWin / avgLoss).toFixed(2) }
                });
            }

            // 4. Discipline: Stop Loss Movement (if we see SL far from open vs TP)
            // This is harder with just closed trades, but we can check if SL was moved deep into loss
            const slMovedTrades = newTrades.filter(t => t.sl && t.openPrice && Math.abs(t.openPrice - t.sl) > 2.0 * Math.abs(t.openPrice - (t.tp || t.openPrice)));
            if (slMovedTrades.length > 0) {
                await this.alertsService.create(userId, {
                    type: AlertType.DISCIPLINE,
                    severity: AlertSeverity.WARNING,
                    title: 'Stop Loss Estendido â—',
                    description: 'Detectamos trades onde o Stop Loss foi posicionado muito alÃ©m do risco inicial projetado. Isso corrÃ³i sua consistÃªncia.',
                    tradeId: slMovedTrades[0].id
                });
            }

            // 5. Journal Quality: Missing Notes
            const missingNotes = newTrades.filter(t => !t.comment || t.comment.trim() === '');
            if (missingNotes.length > 0) {
                await this.alertsService.create(userId, {
                    type: AlertType.JOURNAL,
                    severity: AlertSeverity.INFO,
                    title: 'Registro Incompleto ðŸ“',
                    description: 'VocÃª sincronizou novos trades mas alguns nÃ£o possuem comentÃ¡rios ou anotaÃ§Ãµes. Enriquecer seu diÃ¡rio agora facilita revisÃµes futuras.',
                    metadata: { count: missingNotes.length }
                });
            }

        } catch (error) {
            this.logger.error(`Error processing professional alerts: ${error.message}`);
        }
    }
}
