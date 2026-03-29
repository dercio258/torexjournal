import { Injectable, Logger, ConflictException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository, DataSource, LessThan, In, Between } from 'typeorm';
import { Mt5DataDto } from './dto/mt5-data.dto';
import { AccountEntity } from '../account/account.entity';
import { PositionEntity } from './position.entity';
import { TradeEntity } from './trade.entity';
import { TradeHistoryEntity } from './trade-history.entity';
import { MarketTickEntity } from './market-tick.entity';
import { UserEntity } from '../users/user.entity';
import { Mt5Gateway } from './mt5.gateway';
import { ImportLog, ImportMethod, ImportStatus } from './import-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { AiService } from '../ai/ai.service';
import { NormalizationService } from '../import/normalization/normalization.service';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';
import { DashboardService } from '../dashboard/dashboard.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
        @InjectRepository(MarketTickEntity)
        private tickRepo: Repository<MarketTickEntity>,
        @InjectRepository(ImportLog)
        private importLogRepo: Repository<ImportLog>,
        private dataSource: DataSource,
        private mt5Gateway: Mt5Gateway,
        private notificationsService: NotificationsService,
        private alertsService: AlertsService,
        private aiService: AiService,
        @InjectQueue('email-queue') private emailQueue: Queue,
        @InjectQueue('behavioral-analysis') private behavioralQueue: Queue,
        @InjectQueue('trade-import') private tradeImportQueue: Queue,
        private normalizationService: NormalizationService,
        private dashboardService: DashboardService,
        private eventEmitter: EventEmitter2
    ) { }

    // ... skipping unchanged lines, we will do a multi-replace or careful chunk replace ...
    // Let's re-eval and do it specifically for constructor and saveHistory


    onModuleInit() {
        // Run check every 30 seconds
        this.checkInterval = setInterval(() => this.checkDisconnections(), 30000);
    }

    onModuleDestroy() {
        if (this.checkInterval) clearInterval(this.checkInterval);
    }

    private async checkDisconnections() {
        try {
            // Threshold: 180 seconds (3 minutes) to be safe
            const threshold = new Date(Date.now() - 180000);

            const staleAccounts = await this.accountRepo.find({
                where: {
                    isConnected: true,
                    lastSeen: LessThan(threshold)
                }
            });

            if (staleAccounts.length > 0) {
                this.logger.log(`Found ${staleAccounts.length} stale accounts. Disconnecting...`);

                for (const account of staleAccounts) {
                    account.isConnected = false;
                    await this.accountRepo.save(account);

                    // Send Disconnected Email
                    if (account.userId) {
                        const user = await this.dataSource.getRepository(UserEntity).findOne({ where: { id: account.userId } });
                        if (user && user.email) {
                            await this.emailQueue.add('mt5-disconnected', {
                                email: user.email,
                                name: user.name,
                                mt5_id: account.mt5Id
                            });
                        }
                    }
                }

                this.mt5Gateway.broadcastConnectionStatus({ isConnected: false });
            }
        } catch (err) {
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
            // 2. Validate Token & Find Account
            let account = await queryRunner.manager.findOne(AccountEntity, {
                where: { mt5Id: mt5_id.toString() },
            });

            if (!account) {
                const tokenOwner = await queryRunner.manager.findOne(AccountEntity, {
                    where: { appToken: token }
                });

                if (!tokenOwner) {
                    this.logger.error(`Authentication Failed: Token '${token}' not found in any account.`);
                    throw new ConflictException('Invalid Token: Access Denied');
                }

                if (tokenOwner.mt5Id === 'PENDING' || tokenOwner.mt5Id === 'PENDING_' + tokenOwner.userId.substring(0, 8)) {
                    // First time connect or pending state! Bind this ID to the user.
                    this.logger.log(`Binding Account: User ${tokenOwner.userId} linked to MT5 ID ${mt5_id}`);
                    account = tokenOwner;
                    account.mt5Id = mt5_id.toString();
                } else if (tokenOwner.mt5Id !== mt5_id.toString()) {
                    this.logger.warn(`Token/Account Mismatch: Token belongs to MT5 ID ${tokenOwner.mt5Id}, but request came from ${mt5_id}.`);
                    throw new ConflictException('Token belongs to another MT5 account');
                } else {
                    account = tokenOwner;
                }
            } else {
                // Account exists for this MT5 ID. check token.
                if (account.appToken && account.appToken !== token) {
                    this.logger.error(`Token Mismatch for MT5 ID ${mt5_id}: Expected '${account.appToken}', Got '${token}'`);
                    throw new ConflictException('Invalid Token: Mismatch');
                }
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

            // Send Connected Email (Only if status changed)
            if (!wasConnected) {
                if (account.userId) {
                    const user = await queryRunner.manager.findOne(UserEntity, { where: { id: account.userId } });
                    if (user && user.email) {
                        try {
                            await this.emailQueue.add('mt5-connected', {
                                email: user.email,
                                name: user.name,
                                mt5_id: account.mt5Id
                            });
                        } catch (e) {
                            this.logger.error(`Failed to queue connected email: ${e.message}`);
                        }
                    }
                }
            }

            // 4. Batch Upsert Positions
            if (positions && positions.length > 0) {
                const existingPositions = await queryRunner.manager.find(PositionEntity, {
                    where: { accountId: account.id }
                });

                const positionMap = new Map<string, PositionEntity>();
                existingPositions.forEach(p => positionMap.set(p.ticket.toString(), p));

                const positionsToSave: PositionEntity[] = [];

                for (const pos of positions) {
                    const ticketStr = pos.ticket.toString();
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
                    }
                }

                if (positionsToSave.length > 0) {
                    await queryRunner.manager.save(positionsToSave);
                }
            }

            await queryRunner.commitTransaction();

            // Broadcast Update
            this.mt5Gateway.broadcastAccountUpdate({
                balance: stats.balance,
                equity: stats.equity,
                margin: stats.margin,
                marginFree: stats.margin_free,
                marginLevel: stats.margin_level,
                positions: positions // Assuming positions match IPosition interface (verify below if needed)
            });

            return { success: true };

        } catch (err) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Sync failed: ${err.message}`);
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async saveHistory(trades: any[], importMethod: ImportMethod = ImportMethod.EA, userId?: string) {
        try {
            // 1. Resolve Account ID if userId is provided (Fast DB check)
            let accountId = null;
            if (userId) {
                const account = await this.accountRepo.findOne({ where: { userId } });
                if (account) {
                    accountId = account.id;
                } else {
                    this.logger.warn(`No account found for user ${userId}. Trade import might fail if account_id is required.`);
                }
            }

            // 2. Normalization Step (Fast)
            const normalizedTrades = this.normalizationService.normalizeBatch(trades, importMethod);

            if (normalizedTrades.length === 0) {
                return { success: true, count: 0, message: 'No trades to import' };
            }

            // 3. Queue the heavy processing work
            await this.tradeImportQueue.add('process-trade-import', {
                trades: normalizedTrades,
                importMethod,
                userId,
                accountId
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: true
            });

            this.logger.log(`Queued background import for ${normalizedTrades.length} trades (Method: ${importMethod}, User: ${userId || 'N/A'})`);

            return { success: true, count: normalizedTrades.length, message: 'Background processing started' };

        } catch (err) {
            this.logger.error(`Failed to queue trade history: ${err.message}`);
            throw err;
        }
    }

    async processTradeImport(data: { trades: any[], importMethod: ImportMethod, userId?: string, accountId?: string }) {
        const { trades, importMethod, userId, accountId } = data;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const tradesToSave = [];
            const tickets = trades.map(t => t.ticket).filter(t => !!t);

            // Fetch existing tickets in batch
            const existingTrades = tickets.length > 0
                ? await queryRunner.manager.find(TradeEntity, { where: { ticket: In(tickets) } })
                : [];
            const existingTickets = new Set(existingTrades.map(t => t.ticket.toString()));

            for (const t of trades) {
                const ticket = t.ticket.toString();
                if (existingTickets.has(ticket)) continue;

                if (!t.openTime) continue;

                const newTrade = this.tradeRepo.create({
                    ...t,
                    ticket: ticket,
                    accountId: accountId,
                    dataQuality: t.dataQuality || 'ok'
                });

                tradesToSave.push(newTrade);
            }

            let finalLogId = null;
            if (tradesToSave.length > 0) {
                if (userId) {
                    const log = this.importLogRepo.create({
                        userId,
                        method: importMethod,
                        status: ImportStatus.SUCCESS,
                        tradesCount: tradesToSave.length,
                        details: `Imported ${tradesToSave.length} trades via ${importMethod} (BG)`
                    });
                    const savedLog = await queryRunner.manager.save(log);
                    finalLogId = savedLog.id;
                }

                if (finalLogId) {
                    for (const trade of tradesToSave) {
                        trade.importLogId = finalLogId;
                    }
                }

                await queryRunner.manager.save(tradesToSave);
            }

            await queryRunner.commitTransaction();

            if (tradesToSave.length > 0) {
                // Broadcast updates
                try {
                    const protoTrades = tradesToSave.map(t => ({
                        ticket: t.ticket,
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

                    this.mt5Gateway.broadcastHistoryUpdate({
                        count: tradesToSave.length,
                        trades: protoTrades
                    });
                } catch (e) {
                    this.logger.warn(`Broadcast failed: ${e.message}`);
                }

                // Notifications
                if (userId) {
                    const user = await this.dataSource.getRepository(UserEntity).findOne({ where: { id: userId } });
                    if (user && user.email) {
                        this.emailQueue.add('trade-imported', {
                            email: user.email,
                            name: user.name,
                            count: tradesToSave.length,
                            method: importMethod
                        }).catch(e => this.logger.warn(`Could not queue email: ${e.message}`));

                        this.notificationsService.create(userId, {
                            title: 'SincronizaÃ§Ã£o de Trades',
                            message: `${tradesToSave.length} novos trades foram sincronizados via ${importMethod}.`,
                            type: NotificationType.SYSTEM
                        }).catch(e => this.logger.warn(`Could not create notification: ${e.message}`));

                        // Invalidate Dashboard Cache
                        await this.dashboardService.invalidateUserCache(userId);

                        // Professional Alerts
                        await this.processProfessionalAlerts(userId, accountId!, tradesToSave);
                        
                        this.behavioralQueue.add('analyze-user-behavior', { userId, accountId }, {
                            delay: 2000,
                            removeOnComplete: true
                        }).catch(e => this.logger.warn(`Failed to queue behavioral analysis: ${e.message}`));
                    }
                }

                // AI Insights
                if (accountId && userId) {
                    try {
                        const totalProfitLoss = tradesToSave.reduce((sum, t) => sum + (t.profit || 0), 0);
                        const metricsSummary = {
                            tradesCount: tradesToSave.length,
                            totalProfitLoss,
                            symbolsTraded: [...new Set(tradesToSave.map(t => t.symbol))]
                        };

                        this.aiService.generateInsights(accountId, userId, metricsSummary, finalLogId)
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
            // console.log(`ðŸ“œ HistÃ³rico salvo: Ticket ${deal.ticket}`);
        } catch (e) {
            if (e.code !== '23505') { // Postgres duplicate key error code
                console.error("Erro ao salvar histÃ³rico", e);
            }
        }
    }

    async updateJournal(ticket: string | number, journalData: Partial<TradeEntity>) {
        const ticketStr = ticket.toString();
        const trade = await this.tradeRepo.findOne({ where: { ticket: ticketStr } });
        if (!trade) {
            throw new Error('Trade not found');
        }

        trade.mood = journalData.mood;
        trade.rating = journalData.rating;
        trade.setup = journalData.setup;
        trade.lesson = journalData.lesson;
        trade.tags = journalData.tags;

        return this.tradeRepo.save(trade);
    }

    async createManualTrade(data: any, userId: string): Promise<TradeEntity> {
        const account = await this.accountRepo.findOne({ where: { userId } });
        if (!account) {
            throw new Error('Conta de trading nÃ£o encontrada para este usuÃ¡rio.');
        }

        const ticket = data.ticket || Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);

        const newTrade = this.tradeRepo.create({
            accountId: account.id,
            ticket,
            symbol: data.symbol,
            type: data.type,
            volume: data.volume,
            openPrice: data.openPrice,
            closePrice: data.closePrice,
            openTime: new Date(data.openTime),
            closeTime: new Date(data.closeTime),
            profit: data.profit,
            magic: 0,
            comment: 'Manual Trade',
            session: this.calculateSession(new Date(data.openTime)),
            status: 'CLOSED',
            mood: data.mood,
            setup: data.setup
        });

        const saved = await this.tradeRepo.save(newTrade);

        // Invalidate Dashboard Cache
        await this.dashboardService.invalidateUserCache(userId);

        // Broadcast manual trade as history update
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
        });

        return saved;
    }

    async saveTick(data: any) {
        // data = { mt5_id, tick: { symbol, bid, ask, last, volume, time } }
        const { tick, mt5_id } = data;

        if (!tick || !tick.symbol) return;

        try {
            await this.tickRepo.save({
                timestamp: new Date(Number(tick.time)), // Ensure millis
                symbol: tick.symbol,
                bid: tick.bid,
                ask: tick.ask,
                last: tick.last || 0,
                volume: tick.volume || 0,
                mt5Id: mt5_id
            });
        } catch (e) {
            // Log only critical errors, ignore duplicate/benign for high freq
            if (e.code !== '23505') {
                // this.logger.error(`Tick Save Error: ${e.message}`);
            }
        }
    }


    async getImportHistory(userId: string) {
        return this.importLogRepo.find({
            where: { userId },
            order: { createdAt: 'DESC' },
            take: 20
        });
    }

    async revertImport(logId: number, userId: string) {
        const log = await this.importLogRepo.findOne({ where: { id: logId, userId } });
        if (!log) {
            throw new Error('Import log not found');
        }

        // Delete associated trades
        await this.tradeRepo.delete({ importLogId: logId });

        // Remove the import log entry
        await this.importLogRepo.delete(logId);

        // Optionally trigger a history broadcast update if connected
        this.mt5Gateway.broadcastHistoryUpdate({ count: 0, trades: [] }); // simple trigger

        return { success: true, message: 'Import reverted successfully' };
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
