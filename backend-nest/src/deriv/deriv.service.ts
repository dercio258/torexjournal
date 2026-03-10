import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DerivAuthEntity } from './entities/deriv-auth.entity';
import { DerivTransactionEntity } from './entities/deriv-transaction.entity';
import { DerivClient } from './deriv.client';
import { CryptoUtil } from '../common/utils/crypto.util';
import { ConfigService } from '@nestjs/config';
import { Mt5Service } from '../mt5/mt5.service';
import { ImportMethod } from '../mt5/import-log.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { NormalizationService } from '../import/normalization/normalization.service';

@Injectable()
export class DerivService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DerivService.name);
    private clients: Map<string, DerivClient> = new Map(); // userId -> DerivClient
    private contractCache: Map<string, { data: any, timestamp: number }> = new Map();
    private enrichmentQueue: Array<{ contractId: string, userId: string, client: DerivClient }> = [];
    private pendingEnrichmentSet: Set<string> = new Set(); // accountId:contractId
    private isProcessingQueue = false;
    private subscriptions: Map<string, Subscription> = new Map(); // userId -> Subscription
    private accountIds: Map<string, string> = new Map(); // userId -> AccountEntity.id

    constructor(
        @InjectRepository(DerivAuthEntity)
        private readonly derivAuthRepo: Repository<DerivAuthEntity>,
        @InjectRepository(DerivTransactionEntity)
        private readonly transactionRepo: Repository<DerivTransactionEntity>,
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        private readonly configService: ConfigService,
        private readonly mt5Service: Mt5Service,
        private readonly normalizationService: NormalizationService
    ) { }

    async onModuleInit() {
        this.logger.log('Initializing Deriv Service - Auto-connecting active accounts');
        const activeAuths = await this.derivAuthRepo.find({ where: { isActive: true } });
        for (const auth of activeAuths) {
            this.connectAccount(auth).catch(err => {
                this.logger.error(`Failed to auto-connect Deriv account for user ${auth.userId}`, err.stack);
            });
        }
    }

    onModuleDestroy() {
        for (const sub of this.subscriptions.values()) {
            sub.unsubscribe();
        }
        this.subscriptions.clear();
        this.accountIds.clear();

        for (const client of this.clients.values()) {
            client.disconnect();
        }
        this.clients.clear();
    }

    async connect(userId: string, token: string) {
        // Disconnect existing client for this user if any
        if (this.clients.has(userId)) {
            this.clients.get(userId).disconnect();
            this.clients.delete(userId);
            this.accountIds.delete(userId);
        }

        const client = new DerivClient();
        await client.connect();

        try {
            const authResponse: any = await client.request({ authorize: token }, 'authorize');
            client.setAuthorized(true);
            const accountData = authResponse.authorize;

            const encryptionKey = this.configService.get<string>('DERIV_ENCRYPTION_KEY');
            if (!encryptionKey) throw new Error('DERIV_ENCRYPTION_KEY not set');

            const encryptedToken = CryptoUtil.encrypt(token, encryptionKey);

            let auth = await this.derivAuthRepo.findOne({ where: { userId, accountId: accountData.loginid } });
            if (auth) {
                auth.encryptedToken = encryptedToken;
                auth.isActive = true;
            } else {
                auth = this.derivAuthRepo.create({
                    userId,
                    accountId: accountData.loginid,
                    encryptedToken,
                    currency: accountData.currency,
                    isActive: true,
                    metadata: accountData
                });
            }

            await this.derivAuthRepo.save(auth);

            const platformAccount = await this.ensureAccountExists(userId, accountData.loginid, accountData.currency);
            this.accountIds.set(userId, platformAccount.id);

            this.clients.set(userId, client);
            this.setupSubscriptions(userId, client);
            this.syncHistory(userId, client);

            return { success: true, account: accountData.loginid };
        } catch (e) {
            client.disconnect();
            throw e;
        }
    }

    private async connectAccount(auth: DerivAuthEntity) {
        // Disconnect existing client for this user if any
        if (this.clients.has(auth.userId)) {
            this.clients.get(auth.userId).disconnect();
            this.clients.delete(auth.userId);
            this.accountIds.delete(auth.userId);
        }

        const encryptionKey = this.configService.get<string>('DERIV_ENCRYPTION_KEY');
        const token = CryptoUtil.decrypt(auth.encryptedToken, encryptionKey);

        const client = new DerivClient();
        await client.connect();

        try {
            await client.request({ authorize: token }, 'authorize', 45000); // Increased timeout for auth
            client.setAuthorized(true);

            await this.ensureAccountExists(auth.userId, auth.accountId, auth.currency);

            this.clients.set(auth.userId, client);
            this.setupSubscriptions(auth.userId, client);
            this.syncHistory(auth.userId, client);
        } catch (err) {
            this.logger.error(`Initial authorization failed for user ${auth.userId}: ${err.message}`);
            client.disconnect();
            if (err.message?.toLowerCase().includes('invalidtoken') || err.message?.toLowerCase().includes('authorization')) {
                this.logger.warn(`Disabling DerivAuth for user ${auth.userId} due to authorization error.`);
                await this.derivAuthRepo.update({ userId: auth.userId, accountId: auth.accountId }, { isActive: false });
            }
            return;
        }

        // Handle re-authorization and re-subscriptions on reconnection
        client.onConnectionChange().subscribe(async isConnected => {
            if (isConnected) {
                this.logger.log(`Deriv client reconnected for user ${auth.userId}. Re-authorizing...`);
                try {
                    await client.request({ authorize: token }, 'authorize', 45000);
                    client.setAuthorized(true);
                    this.setupSubscriptions(auth.userId, client);
                } catch (err) {
                    this.logger.error(`Re-authorization failed for user ${auth.userId}: ${err.message}`);
                }
            }
        });
    }

    private async ensureAccountExists(userId: string, platformId: string, currency: string) {
        let account = await this.accountRepo.findOne({ where: { mt5Id: platformId } });
        if (!account) {
            this.logger.log(`Creating shadow AccountEntity for Deriv account ${platformId}`);
            account = this.accountRepo.create({
                userId,
                mt5Id: platformId,
                balance: 0,
                equity: 0,
                margin: 0,
                marginFree: 0,
                marginLevel: 0,
                isConnected: true,
                lastSeen: new Date()
            });
            await this.accountRepo.save(account);
        } else if (account.userId !== userId) {
            // Re-assign if needed (e.g. account moved between internal users)
            account.userId = userId;
            await this.accountRepo.save(account);
        }
        return account;
    }

    private setupSubscriptions(userId: string, client: DerivClient) {
        try {
            if (this.subscriptions.has(userId)) {
                this.subscriptions.get(userId).unsubscribe();
                this.subscriptions.delete(userId);
            }

            client.send({ transaction: 1, subscribe: 1 });

            const sub = client.onMessage('transaction').subscribe((msg: any) => {
                try {
                    if (msg.transaction) {
                        this.handleTransaction(userId, msg.transaction);
                    }
                } catch (err) {
                    this.logger.error(`Error handling transaction for user ${userId}: ${err.message}`);
                }
            });

            this.subscriptions.set(userId, sub);
            this.logger.log(`Subscriptions setup for user ${userId}`);
        } catch (err) {
            this.logger.error(`Failed to setup subscriptions for user ${userId}: ${err.message}`);
        }
    }

    private async handleTransaction(userId: string, transaction: any) {
        if (!transaction?.id) {
            this.logger.debug(`Ignoring sparse transaction message for user ${userId}: ${JSON.stringify(transaction)}`);
            return;
        }

        const accountId = this.accountIds.get(userId);
        if (!accountId) {
            this.logger.warn(`No AccountEntity ID for user ${userId}, dropping transaction ${transaction.id}`);
            return;
        }

        this.logger.log(`New transaction for user ${userId} (Account: ${accountId}): ${transaction.action || 'unknown'} | ID: ${transaction.id}`);

        // 1. Save raw transaction
        const txDate = this.mt5Service.safeDate(transaction.transaction_time);
        await this.transactionRepo.upsert({
            transactionId: transaction.id.toString(),
            contractId: transaction.contract_id?.toString(),
            userId,
            action: transaction.action as any,
            amount: parseFloat(transaction.amount) || 0,
            balance: parseFloat(transaction.balance) || 0,
            currency: transaction.currency,
            transactionTime: txDate || new Date(),
            raw: transaction
        }, ['transactionId']);

        // 2. Identify if it's a trade-related action
        if (transaction.action && ['buy', 'sell'].includes(transaction.action) && transaction.contract_id) {
            this.processTradeSync(userId, transaction.contract_id.toString());
        }
    }

    private processTradeSync(userId: string, contractId: string) {
        const client = this.clients.get(userId);
        const accountId = this.accountIds.get(userId);
        if (!client || !accountId) return;

        const dedupeKey = `${accountId}:${contractId}`;
        if (this.pendingEnrichmentSet.has(dedupeKey)) return;

        this.pendingEnrichmentSet.add(dedupeKey);
        this.enrichmentQueue.push({ contractId, userId, client });
        this.processEnrichmentQueue();
    }

    private async processEnrichmentQueue() {
        if (this.isProcessingQueue || this.enrichmentQueue.length === 0) return;
        this.isProcessingQueue = true;

        while (this.enrichmentQueue.length > 0) {
            const item = this.enrichmentQueue[0]; // Peek at first item
            const { contractId, userId, client } = item;
            const accountId = this.accountIds.get(userId);
            const dedupeKey = `${accountId}:${contractId}`;
            let success = true;

            try {
                if (accountId) {
                    success = await this.enrichTrade(userId, accountId, contractId);
                }
            } catch (err) {
                this.logger.error(`Failed to enrich trade ${contractId} for user ${userId}: ${err.message}`);
                success = true; // Skip if fatal unexpected error wrapper
            } finally {
                if (!success) {
                    // Rate limit hit, wait longer and leave item in queue for next loop
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    // Success or permanent failure, remove from queue
                    this.enrichmentQueue.shift();
                    this.pendingEnrichmentSet.delete(dedupeKey);
                    // Standard rate delay
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        this.isProcessingQueue = false;
    }

    private async enrichTrade(userId: string, accountId: string, contractId: string): Promise<boolean> {
        const client = this.clients.get(userId);
        if (!client) return true; // Stop trying if client disconnected

        try {
            const cache = this.contractCache.get(contractId);
            if (cache && (Date.now() - cache.timestamp < 300000)) {
                await this.consolidateTrade(userId, accountId, contractId, cache.data);
                return true;
            }

            const apiContractId = isNaN(Number(contractId)) ? contractId : parseInt(contractId);

            const contractRes: any = await client.request({ proposal_open_contract: 1, contract_id: apiContractId }, 'proposal_open_contract');
            const contract = contractRes.proposal_open_contract;

            if (contract) {
                this.contractCache.set(contractId, { data: contract, timestamp: Date.now() });
                await this.consolidateTrade(userId, accountId, contractId, contract);
                return true;
            } else {
                await this.consolidateTrade(userId, accountId, contractId, null);
                return true;
            }
        } catch (err) {
            const msg = err.message?.toLowerCase() || '';
            if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('too many') || msg.includes('disconnect')) {
                this.logger.warn(`Rate limit or connection issue fetching contract ${contractId}: ${err.message}. Will retry.`);
                return false; // Tells queue to wait and retry
            }

            this.logger.warn(`Could not get contract details for ${contractId}: ${err.message}. Falling back to basic profit table.`);
            await this.consolidateTrade(userId, accountId, contractId, null);
            return true;
        }
    }

    private async consolidateTrade(userId: string, accountId: string, contractId: string, contractDetails: any) {
        const transactions = await this.transactionRepo.find({
            where: { contractId, userId },
            order: { transactionTime: 'ASC' }
        });

        if (transactions.length === 0 && !contractDetails) {
            this.logger.debug(`No data for trade ${contractId}, skipping consolidation.`);
            return;
        }

        const buyTx = transactions.find(tx => tx.action === 'buy');
        const sellTxs = transactions.filter(tx => tx.action === 'sell');

        // We will build a composite payload that closely mimics contractDetails 
        // to pass to our DerivAdapter
        let rawPayload = { ...contractDetails };

        // Fallbacks using our internal transaction data if contractDetails is missing fields
        if (!rawPayload.contract_id) rawPayload.contract_id = contractId;

        if (buyTx) {
            rawPayload.purchase_time = rawPayload.purchase_time || buyTx.transactionTime.getTime() / 1000;
            if (!rawPayload.buy_price) rawPayload.buy_price = Math.abs(buyTx.amount);
            if (!rawPayload.transaction_ids) rawPayload.transaction_ids = {};
            rawPayload.transaction_ids.buy = buyTx.transactionId.replace('buy_', '');
            rawPayload.currency = rawPayload.currency || buyTx.currency;
            if (buyTx.raw?.shortcode) rawPayload.shortcode = rawPayload.shortcode || buyTx.raw.shortcode;
            if (buyTx.raw?.symbol) rawPayload.underlying = rawPayload.underlying || buyTx.raw.symbol;
        }

        if (sellTxs.length > 0) {
            const lastSell = sellTxs[sellTxs.length - 1];
            rawPayload.sell_time = rawPayload.sell_time || lastSell.transactionTime.getTime() / 1000;
            const totalPayout = sellTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
            if (!rawPayload.sell_price) rawPayload.sell_price = totalPayout;
            if (!rawPayload.transaction_ids) rawPayload.transaction_ids = {};
            rawPayload.transaction_ids.sell = lastSell.transactionId.replace('sell_', '');
            rawPayload.status = 'closed';
        }

        // Normalize using DerivAdapter via NormalizationService
        const normalizedList = this.normalizationService.normalizeBatch([rawPayload], ImportMethod.DERIV);

        if (normalizedList.length === 0) {
            this.logger.warn(`Failed to normalize Deriv trade ${contractId} for user ${userId}`);
            return;
        }

        const normalizedTrade = normalizedList[0];

        const tradeData: Partial<TradeEntity> = {
            accountId: accountId,
            ticket: normalizedTrade.ticket,
            contractId: normalizedTrade.contractId,
            symbol: normalizedTrade.symbol,
            type: normalizedTrade.type,
            volume: normalizedTrade.volume,
            openPrice: normalizedTrade.openPrice,
            closePrice: normalizedTrade.closePrice,
            profit: normalizedTrade.profit,
            grossResult: normalizedTrade.profit,
            netPnl: normalizedTrade.profit,
            currency: rawPayload.currency || 'USD',
            buyTransactionId: normalizedTrade.buyTransactionId,
            sellTransactionId: normalizedTrade.sellTransactionId,
            status: normalizedTrade.status,
            qualityFlags: normalizedTrade.qualityFlags,
            dataQuality: normalizedTrade.dataQuality,
            comment: normalizedTrade.comment,
            openTime: normalizedTrade.openTime,
            closeTime: normalizedTrade.closeTime,
            syntheticTxid: !normalizedTrade.buyTransactionId && !normalizedTrade.contractId,
            session: normalizedTrade.session
        };

        await this.tradeRepo.upsert(tradeData, ['accountId', 'contractId']);
        this.logger.debug(`Consolidated and Normalized trade ${contractId} via Adapter. PnL: ${normalizedTrade.profit}`);
    }

    private async syncHistory(userId: string, client: DerivClient) {
        this.logger.log(`Starting robust history sync for user ${userId}`);
        const accountId = this.accountIds.get(userId);
        if (!accountId) {
            this.logger.error(`No official account ID for user ${userId}, cancelling history sync`);
            return;
        }

        try {
            const contractsToEnrich = new Set<string>();

            // 1. Fetch Open Positions (Portfolio)
            try {
                this.logger.log(`Fetching portfolio for open positions (user ${userId})`);
                const portfolioRes: any = await client.request({ portfolio: 1 }, 'portfolio');
                const openPositions = portfolioRes.portfolio?.contracts || [];

                for (const pos of openPositions) {
                    const contractId = pos.contract_id?.toString();
                    if (!contractId) continue;

                    const buyId = `buy_${pos.transaction_id}`;
                    const buyDate = this.mt5Service.safeDate(pos.purchase_time);

                    await this.transactionRepo.upsert({
                        transactionId: buyId,
                        contractId: contractId,
                        userId,
                        action: 'buy',
                        amount: -Math.abs(pos.buy_price),
                        currency: pos.currency || 'USD',
                        transactionTime: buyDate || new Date(),
                        raw: pos
                    }, ['transactionId']);

                    contractsToEnrich.add(contractId);
                }
            } catch (e) {
                this.logger.warn(`Failed to fetch portfolio for user ${userId}: ${e.message}`);
            }

            const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

            // 2. Fetch Statement (Broad reconciliation) with pagination
            try {
                this.logger.log(`Fetching statement for history reconciliation (user ${userId})`);
                let offset = 0;
                let hasMore = true;
                let loops = 0;

                while (hasMore && loops < 50) { // Safety ceiling: 50 pages * 100 = 5000 txs
                    loops++;
                    const statementRes: any = await client.request({
                        statement: 1,
                        limit: 100,
                        offset,
                        date_from: thirtyDaysAgo
                    }, 'statement');

                    const statementTxs = statementRes.statement?.transactions || [];
                    if (statementTxs.length === 0) {
                        hasMore = false;
                        break;
                    }

                    for (const t of statementTxs) {
                        const contractId = t.contract_id?.toString();
                        if (!contractId || !['buy', 'sell'].includes(t.action_type)) continue;

                        const txId = `${t.action_type}_${t.transaction_id}`;
                        const txDate = this.mt5Service.safeDate(t.transaction_time);

                        await this.transactionRepo.upsert({
                            transactionId: txId,
                            contractId: contractId,
                            userId,
                            action: t.action_type as any,
                            amount: parseFloat(t.amount.toString()),
                            balance: parseFloat(t.balance_after?.toString() || '0'),
                            currency: t.currency || 'USD',
                            transactionTime: txDate || new Date(),
                            raw: t
                        }, ['transactionId']);

                        contractsToEnrich.add(contractId);
                    }

                    if (statementTxs.length < 100) hasMore = false;
                    offset += 100;
                    await new Promise(resolve => setTimeout(resolve, 200)); // Respect rate limits
                }
                this.logger.log(`Finished statement pagination for user ${userId} in ${loops} pages.`);
            } catch (e) {
                this.logger.warn(`Failed to fetch statement for user ${userId}: ${e.message}`);
            }

            // 3. Fetch Profit Table (Closed P&L accurate metadata) with pagination
            try {
                this.logger.log(`Fetching profit_table for finished trades (user ${userId})`);
                let offset = 0;
                let hasMore = true;
                let loops = 0;

                while (hasMore && loops < 50) {
                    loops++;
                    const profitTableRes: any = await client.request({
                        profit_table: 1,
                        limit: 100,
                        offset,
                        sort: 'DESC',
                        date_from: thirtyDaysAgo
                    }, 'profit_table');

                    const transactions = profitTableRes.profit_table?.transactions || [];
                    if (transactions.length === 0) {
                        hasMore = false;
                        break;
                    }

                    for (const t of transactions) {
                        const contractId = (t.contract_id || t.transaction_id).toString();
                        const buyId = `buy_${t.transaction_id}`;
                        const sellId = `sell_${t.transaction_id}`;

                        const buyDate = this.mt5Service.safeDate(t.purchase_time);
                        const sellDate = this.mt5Service.safeDate(t.sell_time);

                        // Save Buy Transaction if missing
                        await this.transactionRepo.upsert({
                            transactionId: buyId,
                            contractId: contractId,
                            userId,
                            action: 'buy',
                            amount: -Math.abs(t.buy_price),
                            currency: t.currency || 'USD',
                            transactionTime: buyDate || new Date(),
                            raw: t
                        }, ['transactionId']);

                        // Save Sell Transaction
                        await this.transactionRepo.upsert({
                            transactionId: sellId,
                            contractId: contractId,
                            userId,
                            action: 'sell',
                            amount: Math.abs(t.payout),
                            currency: t.currency || 'USD',
                            transactionTime: sellDate || buyDate || new Date(),
                            raw: t
                        }, ['transactionId']);

                        contractsToEnrich.add(contractId);
                    }

                    if (transactions.length < 100) hasMore = false;
                    offset += 100;
                    await new Promise(resolve => setTimeout(resolve, 200)); // Respect rate limits
                }
                this.logger.log(`Finished profit_table pagination for user ${userId} in ${loops} pages.`);
            } catch (e) {
                this.logger.warn(`Failed to fetch profit_table for user ${userId}: ${e.message}`);
            }

            // 4. Enqueue all discovered contracts for full detail enrichment
            if (contractsToEnrich.size > 0) {
                for (const contractId of Array.from(contractsToEnrich)) {
                    this.processTradeSync(userId, contractId);
                }
                this.logger.log(`Enqueued ${contractsToEnrich.size} unique contracts for enrichment for user ${userId}`);
            }

            // 5. Immediate repair for existing malformed trades
            await this.repairMalformedTrades(userId);
        } catch (e) {
            this.logger.error(`History sync failed completely for user ${userId}`, e.stack);
        }
    }

    async repairMalformedTrades(userId: string) {
        this.logger.log(`Scanning for malformed trades to repair for user ${userId}`);
        const accountId = this.accountIds.get(userId);
        if (!accountId) return;

        const malformed = await this.tradeRepo.createQueryBuilder('trade')
            .where('trade.accountId = :accountId', { accountId })
            .andWhere("(trade.dataQuality = 'broken' OR trade.dataQuality = 'partial')")
            .getMany();

        if (malformed.length > 0) {
            this.logger.log(`Found ${malformed.length} malformed/partial trades for user ${userId} (Account: ${accountId}). Attempting repair...`);
            for (const trade of malformed) {
                if (trade.contractId) {
                    this.processTradeSync(userId, trade.contractId);
                }
            }
        }
    }

    async disconnect(userId: string) {
        const client = this.clients.get(userId);
        if (client) {
            client.disconnect();
            this.clients.delete(userId);
        }
        await this.derivAuthRepo.update({ userId }, { isActive: false });
        return { success: true };
    }
}
