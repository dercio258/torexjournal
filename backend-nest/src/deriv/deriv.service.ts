import { Injectable, Logger, OnModuleInit, OnModuleDestroy, NotFoundException } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import axios from 'axios';
import { DerivAuthEntity } from './entities/deriv-auth.entity';
import { DerivTransactionEntity } from './entities/deriv-transaction.entity';
import { DerivClient } from './deriv.client';
import { CryptoUtil } from '../common/utils/crypto.util';
import { ConfigService } from '@nestjs/config';
import { Mt5Service } from '../mt5/mt5.service';
import { ImportMethod } from '../mt5/import-log.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity, AccountType } from '../account/account.entity';
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
        if (this.configService.get('MT5_DEDICATED_SERVER') === 'true' || this.configService.get('DERIV_ENABLED') === 'false') {
            this.logger.log('Deriv integration desativada neste servidor.');
            return;
        }
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

    private getEncryptionKey(): string {
        const key = this.configService.get<string>('DERIV_ENCRYPTION_KEY');
        if (key && key.trim().length > 0) return key.trim();

        const jwtSecret = this.configService.get<string>('JWT_SECRET');
        if (jwtSecret && jwtSecret.trim().length > 0) {
            this.logger.warn('DERIV_ENCRYPTION_KEY not set; using derived key from JWT_SECRET');
            return `deriv-sec-${jwtSecret.trim()}`;
        }

        return 'cossa-trading-deriv-default-secret-key-32b';
    }

    private async discoverAccountsViaRest(token: string): Promise<any[] | null> {
        const appId = this.configService.get<string>('DERIV_APP_ID') || '1089';
        try {
            const res = await axios.get('https://api.derivws.com/trading/v1/options/accounts', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Deriv-App-ID': appId,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            });
            if (res.data?.data && Array.isArray(res.data.data) && res.data.data.length > 0) {
                this.logger.log(`Discovered ${res.data.data.length} accounts via modern Deriv REST API`);
                return res.data.data;
            }
        } catch (err) {
            this.logger.debug(`Modern REST account discovery not available: ${err.message}. Using standard WS auth.`);
        }
        return null;
    }

    private async getOtpWebSocketUrl(token: string, accountId: string): Promise<string | null> {
        const appId = this.configService.get<string>('DERIV_APP_ID') || '1089';
        try {
            const res = await axios.post(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {}, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Deriv-App-ID': appId,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            });
            if (res.data?.data?.url) {
                this.logger.log(`Obtained pre-authenticated OTP WebSocket URL for account ${accountId}`);
                return res.data.data.url;
            }
        } catch (err) {
            this.logger.debug(`OTP WebSocket URL request not available for ${accountId}: ${err.message}`);
        }
        return null;
    }

    async connect(userId: string, token: string) {
        // Disconnect existing client for this user if any
        if (this.clients.has(userId)) {
            this.clients.get(userId).disconnect();
            this.clients.delete(userId);
            this.accountIds.delete(userId);
        }

        const client = new DerivClient();

        // 1. Try modern REST discovery per developers.deriv.com/llms.txt
        const restAccounts = await this.discoverAccountsViaRest(token);
        let otpUrl: string | null = null;
        let selectedRestAccount: any = null;

        if (restAccounts && restAccounts.length > 0) {
            selectedRestAccount = restAccounts.find(a => a.account_type === 'real' && a.status === 'active') || restAccounts[0];
            if (selectedRestAccount?.account_id) {
                otpUrl = await this.getOtpWebSocketUrl(token, selectedRestAccount.account_id);
            }
        }

        try {
            let accountData: any = null;

            if (otpUrl && selectedRestAccount) {
                // Connect via pre-authenticated OTP gateway URL
                await client.connect(otpUrl);
                accountData = {
                    loginid: selectedRestAccount.account_id,
                    currency: selectedRestAccount.currency,
                    balance: selectedRestAccount.balance,
                    is_virtual: selectedRestAccount.account_type === 'demo' ? 1 : 0
                };
            } else {
                // Standard WebSocket authorize handshake
                await client.connect();
                const authResponse: any = await client.request({ authorize: token }, 'authorize');
                client.setAuthorized(true);
                accountData = authResponse.authorize;
            }

            const encryptionKey = this.getEncryptionKey();
            const encryptedToken = CryptoUtil.encrypt(token, encryptionKey);

            let auth = await this.derivAuthRepo.findOne({ where: { userId, accountId: accountData.loginid } });
            if (auth) {
                auth.encryptedToken = encryptedToken;
                auth.isActive = true;
                auth.currency = accountData.currency;
                auth.metadata = accountData;
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

            const platformAccount = await this.ensureAccountExists(
                userId,
                accountData.loginid,
                accountData.currency,
                parseFloat(accountData.balance) || 0,
                accountData.is_virtual === 1
            );

            auth.accountEntityId = platformAccount.id;
            await this.derivAuthRepo.save(auth);

            this.accountIds.set(userId, platformAccount.id);
            this.clients.set(userId, client);
            this.setupSubscriptions(userId, client);
            this.syncHistory(userId, client);

            return { 
                success: true, 
                account: accountData.loginid,
                currency: accountData.currency,
                balance: parseFloat(accountData.balance) || 0,
                accountEntityId: platformAccount.id
            };
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

        const encryptionKey = this.getEncryptionKey();
        const token = CryptoUtil.decrypt(auth.encryptedToken, encryptionKey);

        const client = new DerivClient();

        // Try OTP URL if available
        const otpUrl = await this.getOtpWebSocketUrl(token, auth.accountId);

        try {
            let accountData: any = auth.metadata || {};

            if (otpUrl) {
                await client.connect(otpUrl);
            } else {
                await client.connect();
                const authRes: any = await client.request({ authorize: token }, 'authorize', 45000);
                client.setAuthorized(true);
                accountData = authRes?.authorize || auth.metadata || {};
            }

            const platformAccount = await this.ensureAccountExists(
                auth.userId,
                auth.accountId,
                auth.currency || accountData.currency,
                parseFloat(accountData.balance) || 0,
                accountData.is_virtual === 1
            );

            if (auth.accountEntityId !== platformAccount.id) {
                auth.accountEntityId = platformAccount.id;
                await this.derivAuthRepo.update({ id: auth.id }, { accountEntityId: platformAccount.id });
            }

            this.accountIds.set(auth.userId, platformAccount.id);
            this.clients.set(auth.userId, client);
            this.setupSubscriptions(auth.userId, client);
            this.syncHistory(auth.userId, client);
        } catch (err) {
            this.logger.error(`Initial authorization failed for user ${auth.userId}: ${err.message}`);
            client.disconnect();
            const errorMsg = err.message?.toLowerCase() || '';
            if (
                errorMsg.includes('invalidtoken') || 
                errorMsg.includes('authorization') || 
                errorMsg.includes('disabled') || 
                errorMsg.includes('disable') ||
                errorMsg.includes('invalid') ||
                errorMsg.includes('rejected')
            ) {
                this.logger.warn(`Disabling DerivAuth for user ${auth.userId} due to authorization/status error.`);
                await this.derivAuthRepo.update({ userId: auth.userId, accountId: auth.accountId }, { isActive: false });
            }
            return;
        }

        // Handle re-authorization and re-subscriptions on reconnection
        client.onConnectionChange().subscribe(async isConnected => {
            if (isConnected) {
                this.logger.log(`Deriv client reconnected for user ${auth.userId}. Re-authorizing...`);
                try {
                    const refreshedOtpUrl = await this.getOtpWebSocketUrl(token, auth.accountId);
                    if (!refreshedOtpUrl) {
                        await client.request({ authorize: token }, 'authorize', 45000);
                        client.setAuthorized(true);
                    }
                    this.setupSubscriptions(auth.userId, client);
                } catch (err) {
                    this.logger.error(`Re-authorization failed for user ${auth.userId}: ${err.message}`);
                }
            }
        });
    }

    private async ensureAccountExists(
        userId: string, 
        platformId: string, 
        currency: string,
        initialBalance: number = 0,
        isVirtual: boolean = false
    ) {
        let account = await this.accountRepo.findOne({ where: { userId, mt5Id: platformId } });
        const accountType = isVirtual ? AccountType.DEMO : AccountType.LIVE;
        const accountName = `Deriv (${platformId})`;

        if (!account) {
            this.logger.log(`Creating AccountEntity for Deriv account ${platformId} (user: ${userId})`);
            account = this.accountRepo.create({
                userId,
                mt5Id: platformId,
                name: accountName,
                broker: 'Deriv',
                type: accountType,
                currency: currency || 'USD',
                balance: initialBalance || 0,
                equity: initialBalance || 0,
                initialBalance: initialBalance || 0,
                margin: 0,
                marginFree: 0,
                marginLevel: 0,
                isConnected: true,
                lastSeen: new Date()
            });
            await this.accountRepo.save(account);
        } else {
            account.broker = 'Deriv';
            if (account.name === 'Conta Principal' || !account.name) {
                account.name = accountName;
            }
            if (currency) account.currency = currency;
            if (initialBalance > 0 && Number(account.balance) === 0) {
                account.balance = initialBalance;
                account.equity = initialBalance;
            }
            account.isConnected = true;
            account.lastSeen = new Date();
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

            const compositeSub = new Subscription();

            // 1. Live transactions (trades open & close)
            client.send({ transaction: 1, subscribe: 1 });
            const txSub = client.onMessage('transaction').subscribe((msg: any) => {
                try {
                    if (msg.transaction && msg.transaction.action) {
                        this.handleTransaction(userId, msg.transaction);
                    }
                } catch (err) {
                    this.logger.error(`Error handling transaction for user ${userId}: ${err.message}`);
                }
            });
            compositeSub.add(txSub);

            // 2. Live balance stream
            client.send({ balance: 1, subscribe: 1 });
            const balSub = client.onMessage('balance').subscribe((msg: any) => {
                try {
                    if (msg.balance) {
                        this.handleBalanceUpdate(userId, msg.balance);
                    }
                } catch (err) {
                    this.logger.error(`Error handling balance update for user ${userId}: ${err.message}`);
                }
            });
            compositeSub.add(balSub);

            // 3. Live open contracts stream (proposal_open_contract) for real-time trade ticks and settlements
            client.send({ proposal_open_contract: 1, subscribe: 1 });
            const pocSub = client.onMessage('proposal_open_contract').subscribe((msg: any) => {
                try {
                    if (msg.proposal_open_contract && msg.proposal_open_contract.contract_id) {
                        this.handleProposalOpenContract(userId, msg.proposal_open_contract);
                    }
                } catch (err) {
                    this.logger.error(`Error handling proposal_open_contract for user ${userId}: ${err.message}`);
                }
            });
            compositeSub.add(pocSub);

            this.subscriptions.set(userId, compositeSub);
            this.logger.log(`Subscriptions (transaction, balance & open contracts) active for user ${userId}`);
        } catch (err) {
            this.logger.error(`Failed to setup subscriptions for user ${userId}: ${err.message}`);
        }
    }

    private async handleProposalOpenContract(userId: string, contract: any) {
        const accountId = this.accountIds.get(userId);
        if (!accountId || !contract?.contract_id) return;

        const contractId = contract.contract_id.toString();
        this.logger.debug(`Live proposal_open_contract update for ${contractId}: status=${contract.status}, profit=${contract.profit}`);

        try {
            await this.consolidateTrade(userId, accountId, contractId, contract);

            if (contract.is_sold === 1 || contract.is_expired === 1) {
                const client = this.clients.get(userId);
                if (client) {
                    client.send({ balance: 1 });
                }
            }
        } catch (err) {
            this.logger.warn(`Failed to process live contract update ${contractId}: ${err.message}`);
        }
    }

    private async handleBalanceUpdate(userId: string, balanceData: any) {
        const accountId = this.accountIds.get(userId);
        if (!accountId) return;

        const newBalance = parseFloat(balanceData.balance) || 0;
        await this.accountRepo.update({ id: accountId }, {
            balance: newBalance,
            equity: newBalance,
            lastSeen: new Date(),
            isConnected: true
        });
    }

    private async handleTransaction(userId: string, transaction: any) {
        if (!transaction?.id || !transaction?.action) {
            return;
        }

        const accountId = this.accountIds.get(userId);
        if (!accountId) {
            this.logger.warn(`No AccountEntity ID for user ${userId}, dropping transaction ${transaction.id}`);
            return;
        }

        const realTxId = (transaction.transaction_id || transaction.id).toString();
        this.logger.log(`New transaction for user ${userId} (Account: ${accountId}): ${transaction.action} | ID: ${realTxId}`);

        // 1. Save raw transaction
        const txDate = this.mt5Service.safeDate(transaction.transaction_time);
        await this.transactionRepo.upsert({
            transactionId: realTxId,
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
                        description: 1,
                        limit: 100,
                        offset
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
                        description: 1,
                        limit: 100,
                        offset,
                        sort: 'DESC'
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

            // 6. Record last sync timestamp
            await this.derivAuthRepo.update({ userId, isActive: true }, { lastSyncAt: new Date() });
            this.logger.log(`History sync successfully finalized for user ${userId}`);
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

    async getStatus(userId: string) {
        const auth = await this.derivAuthRepo.findOne({ where: { userId, isActive: true } });
        if (!auth) {
            return {
                isConnected: false,
                isStreaming: false,
                accountId: null,
                currency: null,
                balance: 0,
                equity: 0,
                accountName: null,
                accountEntityId: null,
                lastSyncAt: null
            };
        }

        const accountId = auth.accountEntityId || this.accountIds.get(userId);
        let account: AccountEntity | null = null;
        if (accountId) {
            account = await this.accountRepo.findOne({ where: { id: accountId } });
        }
        if (!account) {
            account = await this.accountRepo.findOne({ where: { userId, mt5Id: auth.accountId } });
        }

        const isWsConnected = this.clients.get(userId)?.getIsAuthorized() || false;

        return {
            isConnected: true,
            isStreaming: isWsConnected,
            accountId: auth.accountId,
            currency: account?.currency || auth.currency || 'USD',
            balance: account ? Number(account.balance) : (auth.metadata?.balance || 0),
            equity: account ? Number(account.equity) : (auth.metadata?.balance || 0),
            accountName: account?.name || `Deriv (${auth.accountId})`,
            accountEntityId: account?.id || auth.accountEntityId,
            lastSyncAt: auth.lastSyncAt || account?.lastSeen || auth.updatedAt
        };
    }

    async triggerSync(userId: string) {
        const auth = await this.derivAuthRepo.findOne({ where: { userId, isActive: true } });
        if (!auth) {
            throw new NotFoundException('Nenhuma conta Deriv ativa vinculada a este usuário');
        }

        let client = this.clients.get(userId);
        if (!client || !client.getIsAuthorized()) {
            await this.connectAccount(auth);
            client = this.clients.get(userId);
        }

        if (client) {
            this.syncHistory(userId, client).catch(err => {
                this.logger.error(`Error during triggerSync for user ${userId}: ${err.message}`);
            });
            return { success: true, message: 'Sincronização de histórico iniciada em segundo plano' };
        }

        throw new Error('Não foi possível conectar com o servidor da Deriv');
    }

    async disconnect(userId: string) {
        if (this.subscriptions.has(userId)) {
            this.subscriptions.get(userId).unsubscribe();
            this.subscriptions.delete(userId);
        }

        const client = this.clients.get(userId);
        if (client) {
            client.disconnect();
            this.clients.delete(userId);
        }

        const accountId = this.accountIds.get(userId);
        if (accountId) {
            await this.accountRepo.update({ id: accountId }, { isConnected: false });
        }
        this.accountIds.delete(userId);

        await this.derivAuthRepo.update({ userId }, { isActive: false });
        this.logger.log(`Deriv account disconnected successfully for user ${userId}`);
        return { success: true };
    }
}
