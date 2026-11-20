import { Injectable, Logger, OnModuleInit, OnModuleDestroy, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subscription } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import axios from 'axios';
import { DerivAuthEntity } from './entities/deriv-auth.entity';
import { DerivTransactionEntity } from './entities/deriv-transaction.entity';
import { DerivClient } from './deriv.client';
import { CryptoUtil } from '../common/utils/crypto.util';
import { getJwtSecret } from '../common/security/security.config';
import { ConfigService } from '@nestjs/config';
import { Mt5Service } from '../mt5/mt5.service';
import { ImportMethod } from '../mt5/import-log.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity, AccountType } from '../account/account.entity';
import { NormalizationService } from '../import/normalization/normalization.service';

@Injectable()
export class DerivService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DerivService.name);
    private clients: Map<string, DerivClient> = new Map(); // connKey (${userId}:${derivAccountId}) -> DerivClient
    private contractCache: Map<string, { data: any, timestamp: number }> = new Map();
    private enrichmentQueue: Array<{ contractId: string, userId: string, derivAccountId: string, connKey: string, client: DerivClient }> = [];
    private pendingEnrichmentSet: Set<string> = new Set(); // accountEntityId:contractId
    private isProcessingQueue = false;
    private subscriptions: Map<string, Subscription> = new Map(); // connKey -> Subscription
    private accountIds: Map<string, string> = new Map(); // connKey -> AccountEntity.id
    private reconnectingConnKeys: Set<string> = new Set();

    private buildConnKey(userId: string, derivAccountId: string): string {
        return `${userId}:${derivAccountId}`;
    }

    private disconnectConnection(connKey: string) {
        if (this.subscriptions.has(connKey)) {
            this.subscriptions.get(connKey)?.unsubscribe();
            this.subscriptions.delete(connKey);
        }
        const existingClient = this.clients.get(connKey);
        if (existingClient) {
            existingClient.disconnect();
            this.clients.delete(connKey);
        }
        this.accountIds.delete(connKey);
        this.reconnectingConnKeys.delete(connKey);
    }

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
        private readonly normalizationService: NormalizationService,
        @Optional() private readonly eventEmitter?: EventEmitter2,
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
        this.contractCache.clear();
        this.enrichmentQueue.length = 0;
        this.pendingEnrichmentSet.clear();
    }

    private setCachedContract(contractId: string, contract: any): void {
        const now = Date.now();
        const ttlMs = 5 * 60_000;
        const maxEntries = 500;
        for (const [key, entry] of this.contractCache.entries()) {
            if (now - entry.timestamp > ttlMs) {
                this.contractCache.delete(key);
            }
        }
        if (this.contractCache.has(contractId)) {
            this.contractCache.delete(contractId);
        }
        while (this.contractCache.size >= maxEntries) {
            const oldestKey = this.contractCache.keys().next().value;
            if (oldestKey === undefined) break;
            this.contractCache.delete(oldestKey);
        }
        this.contractCache.set(contractId, { data: contract, timestamp: now });
    }

    private getEncryptionKey(): string {
        const key = this.configService.get<string>('DERIV_ENCRYPTION_KEY');
        if (key && key.trim().length > 0) return key.trim();

        const jwtSecret = getJwtSecret(this.configService);
        return `deriv-sec-${jwtSecret}`;
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

            const derivAccountId = String(accountData?.loginid || selectedRestAccount?.account_id || '').trim();
            if (!derivAccountId) {
                throw new Error('Conta Deriv inválida retornada na autorização');
            }
            const connKey = this.buildConnKey(userId, derivAccountId);

            // Disconnect only any pre-existing connection for THIS same Deriv account (multi-account safe)
            this.disconnectConnection(connKey);

            const encryptionKey = this.getEncryptionKey();
            const encryptedToken = CryptoUtil.encrypt(token, encryptionKey);

            let auth = await this.derivAuthRepo.findOne({ where: { userId, accountId: derivAccountId } });
            if (auth) {
                auth.encryptedToken = encryptedToken;
                auth.isActive = true;
                auth.currency = accountData.currency;
                auth.metadata = accountData;
            } else {
                auth = this.derivAuthRepo.create({
                    userId,
                    accountId: derivAccountId,
                    encryptedToken,
                    currency: accountData.currency,
                    isActive: true,
                    metadata: accountData
                });
            }

            const platformAccount = await this.ensureAccountExists(
                userId,
                derivAccountId,
                accountData.currency,
                parseFloat(accountData.balance) || 0,
                accountData.is_virtual === 1
            );

            auth.accountEntityId = platformAccount.id;
            await this.derivAuthRepo.save(auth);

            this.accountIds.set(connKey, platformAccount.id);
            this.clients.set(connKey, client);
            this.attachReconnectHandler(auth, token, client, connKey);
            this.setupSubscriptions(userId, derivAccountId, client);
            this.syncHistory(userId, derivAccountId, client);

            return { 
                success: true, 
                account: derivAccountId,
                currency: accountData.currency,
                balance: parseFloat(accountData.balance) || 0,
                accountEntityId: platformAccount.id
            };
        } catch (e) {
            client.disconnect();
            throw e;
        }
    }

    private attachReconnectHandler(
        auth: DerivAuthEntity,
        token: string,
        client: DerivClient,
        connKey: string,
    ) {
        client.setReconnectUrlResolver(() => this.getOtpWebSocketUrl(token, auth.accountId));
        client.onConnectionChange().subscribe(async (isConnected) => {
            if (!isConnected || this.reconnectingConnKeys.has(connKey)) {
                return;
            }
            if (client.getIsAuthorized() && this.subscriptions.has(connKey)) {
                return;
            }
            this.reconnectingConnKeys.add(connKey);
            this.logger.log(`Deriv client reconnected (${connKey}). Re-authorizing...`);
            try {
                if (!client.getIsAuthorized()) {
                    await client.request({ authorize: token }, 'authorize', 45000);
                    client.setAuthorized(true);
                }
                this.setupSubscriptions(auth.userId, auth.accountId, client);
            } catch (err: any) {
                this.logger.error(`Re-authorization failed for ${connKey}: ${err?.message || err}`);
            } finally {
                this.reconnectingConnKeys.delete(connKey);
            }
        });
    }

    private async connectAccount(auth: DerivAuthEntity) {
        const connKey = this.buildConnKey(auth.userId, auth.accountId);
        // Disconnect only existing client for THIS specific Deriv account
        this.disconnectConnection(connKey);

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

            this.accountIds.set(connKey, platformAccount.id);
            this.clients.set(connKey, client);
            this.attachReconnectHandler(auth, token, client, connKey);
            this.setupSubscriptions(auth.userId, auth.accountId, client);
            this.syncHistory(auth.userId, auth.accountId, client);
        } catch (err) {
            this.logger.error(`Initial authorization failed for ${connKey}: ${err.message}`);
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
                this.logger.warn(`Disabling DerivAuth for ${connKey} due to authorization/status error.`);
                await this.derivAuthRepo.update({ userId: auth.userId, accountId: auth.accountId }, { isActive: false });
            }
            return;
        }
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

    private setupSubscriptions(userId: string, derivAccountId: string, client: DerivClient) {
        const connKey = this.buildConnKey(userId, derivAccountId);
        try {
            if (this.subscriptions.has(connKey)) {
                this.subscriptions.get(connKey)?.unsubscribe();
                this.subscriptions.delete(connKey);
            }

            const compositeSub = new Subscription();

            // 1. Live transactions (trades open & close)
            client.send({ transaction: 1, subscribe: 1 });
            const txSub = client.onMessage('transaction').subscribe((msg: any) => {
                try {
                    if (msg.transaction && msg.transaction.action) {
                        this.handleTransaction(userId, derivAccountId, msg.transaction);
                    }
                } catch (err) {
                    this.logger.error(`Error handling transaction for ${connKey}: ${err.message}`);
                }
            });
            compositeSub.add(txSub);

            // 2. Live balance stream
            client.send({ balance: 1, subscribe: 1 });
            const balSub = client.onMessage('balance').subscribe((msg: any) => {
                try {
                    if (msg.balance) {
                        this.handleBalanceUpdate(connKey, msg.balance);
                    }
                } catch (err) {
                    this.logger.error(`Error handling balance update for ${connKey}: ${err.message}`);
                }
            });
            compositeSub.add(balSub);

            // 3. Live open contracts stream (proposal_open_contract) for real-time trade ticks and settlements
            client.send({ proposal_open_contract: 1, subscribe: 1 });
            const pocSub = client.onMessage('proposal_open_contract').subscribe((msg: any) => {
                try {
                    if (msg.proposal_open_contract && msg.proposal_open_contract.contract_id) {
                        this.handleProposalOpenContract(userId, derivAccountId, msg.proposal_open_contract);
                    }
                } catch (err) {
                    this.logger.error(`Error handling proposal_open_contract for ${connKey}: ${err.message}`);
                }
            });
            compositeSub.add(pocSub);

            this.subscriptions.set(connKey, compositeSub);
            this.logger.log(`Subscriptions (transaction, balance & open contracts) active for ${connKey}`);
        } catch (err) {
            this.logger.error(`Failed to setup subscriptions for ${connKey}: ${err.message}`);
        }
    }

    private async handleProposalOpenContract(userId: string, derivAccountId: string, contract: any) {
        const connKey = this.buildConnKey(userId, derivAccountId);
        const accountId = this.accountIds.get(connKey);
        if (!accountId || !contract?.contract_id) return;

        const contractId = contract.contract_id.toString();
        this.logger.debug(`Live proposal_open_contract update for ${contractId}: status=${contract.status}, profit=${contract.profit}`);

        try {
            await this.consolidateTrade(userId, accountId, contractId, contract);

            if (contract.is_sold === 1 || contract.is_expired === 1) {
                const client = this.clients.get(connKey);
                if (client) {
                    client.send({ balance: 1 });
                }
            }
        } catch (err) {
            this.logger.warn(`Failed to process live contract update ${contractId}: ${err.message}`);
        }
    }

    private async handleBalanceUpdate(connKey: string, balanceData: any) {
        const accountId = this.accountIds.get(connKey);
        if (!accountId) return;

        const newBalance = parseFloat(balanceData.balance) || 0;
        await this.accountRepo.update({ id: accountId }, {
            balance: newBalance,
            equity: newBalance,
            lastSeen: new Date(),
            isConnected: true
        });
    }

    private async handleTransaction(userId: string, derivAccountId: string, transaction: any) {
        if (!transaction?.id || !transaction?.action) {
            return;
        }

        const connKey = this.buildConnKey(userId, derivAccountId);
        const accountId = this.accountIds.get(connKey);
        if (!accountId) {
            this.logger.warn(`No AccountEntity ID for ${connKey}, dropping transaction ${transaction.id}`);
            return;
        }

        const realTxId = (transaction.transaction_id || transaction.id).toString();
        this.logger.log(`New transaction for ${connKey} (Account: ${accountId}): ${transaction.action} | ID: ${realTxId}`);

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
            this.processTradeSync(userId, derivAccountId, transaction.contract_id.toString());
        }
    }

    private processTradeSync(userId: string, derivAccountId: string, contractId: string) {
        const connKey = this.buildConnKey(userId, derivAccountId);
        const client = this.clients.get(connKey);
        const accountId = this.accountIds.get(connKey);
        if (!client || !accountId) return;

        const dedupeKey = `${accountId}:${contractId}`;
        if (this.pendingEnrichmentSet.has(dedupeKey)) return;

        this.pendingEnrichmentSet.add(dedupeKey);
        this.enrichmentQueue.push({ contractId, userId, derivAccountId, connKey, client });
        this.processEnrichmentQueue();
    }

    private async processEnrichmentQueue() {
        if (this.isProcessingQueue || this.enrichmentQueue.length === 0) return;
        this.isProcessingQueue = true;

        while (this.enrichmentQueue.length > 0) {
            const item = this.enrichmentQueue[0]; // Peek at first item
            const { contractId, userId, connKey } = item;
            const accountId = this.accountIds.get(connKey);
            const dedupeKey = `${accountId}:${contractId}`;
            let success = true;

            try {
                if (accountId) {
                    success = await this.enrichTrade(userId, connKey, accountId, contractId);
                }
            } catch (err) {
                this.logger.error(`Failed to enrich trade ${contractId} for ${connKey}: ${err.message}`);
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

    private async enrichTrade(userId: string, connKey: string, accountId: string, contractId: string): Promise<boolean> {
        const client = this.clients.get(connKey);
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
                this.setCachedContract(contractId, contract);
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
        if (this.eventEmitter && userId) {
            this.eventEmitter.emit('trades.imported', {
                userId,
                accountId,
                count: 1,
                source: 'deriv',
            });
        }
        this.logger.debug(`Consolidated and Normalized trade ${contractId} via Adapter. PnL: ${normalizedTrade.profit}`);
    }

    private async syncHistory(userId: string, derivAccountId: string, client: DerivClient) {
        const connKey = this.buildConnKey(userId, derivAccountId);
        this.logger.log(`Starting robust history sync for ${connKey}`);
        const accountId = this.accountIds.get(connKey);
        if (!accountId) {
            this.logger.error(`No official account ID for ${connKey}, cancelling history sync`);
            return;
        }

        try {
            const contractsToEnrich = new Set<string>();

            // 1. Fetch Open Positions (Portfolio)
            try {
                this.logger.log(`Fetching portfolio for open positions (user ${userId})`);
                const portfolioRes: any = await client.request({ portfolio: 1 }, 'portfolio');
                const openPositions = portfolioRes.portfolio?.contracts || [];
                const portfolioBatch: any[] = [];

                for (const pos of openPositions) {
                    const contractId = pos.contract_id?.toString();
                    if (!contractId) continue;

                    const buyId = `buy_${pos.transaction_id}`;
                    const buyDate = this.mt5Service.safeDate(pos.purchase_time);

                    portfolioBatch.push({
                        transactionId: buyId,
                        contractId: contractId,
                        userId,
                        action: 'buy',
                        amount: -Math.abs(pos.buy_price),
                        currency: pos.currency || 'USD',
                        transactionTime: buyDate || new Date(),
                        raw: pos
                    });

                    contractsToEnrich.add(contractId);
                }

                if (portfolioBatch.length > 0) {
                    await this.transactionRepo.upsert(portfolioBatch, ['transactionId']);
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

                    const statementBatchByTx = new Map<string, any>();
                    for (const t of statementTxs) {
                        const contractId = t.contract_id?.toString();
                        if (!contractId || !['buy', 'sell'].includes(t.action_type)) continue;

                        const txId = `${t.action_type}_${t.transaction_id}`;
                        const txDate = this.mt5Service.safeDate(t.transaction_time);

                        statementBatchByTx.set(txId, {
                            transactionId: txId,
                            contractId: contractId,
                            userId,
                            action: t.action_type as any,
                            amount: parseFloat(t.amount.toString()),
                            balance: parseFloat(t.balance_after?.toString() || '0'),
                            currency: t.currency || 'USD',
                            transactionTime: txDate || new Date(),
                            raw: t
                        });

                        contractsToEnrich.add(contractId);
                    }

                    if (statementBatchByTx.size > 0) {
                        await this.transactionRepo.upsert(Array.from(statementBatchByTx.values()), ['transactionId']);
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

                    const profitBatchByTx = new Map<string, any>();
                    for (const t of transactions) {
                        const contractId = (t.contract_id || t.transaction_id).toString();
                        const buyId = `buy_${t.transaction_id}`;
                        const sellId = `sell_${t.transaction_id}`;

                        const buyDate = this.mt5Service.safeDate(t.purchase_time);
                        const sellDate = this.mt5Service.safeDate(t.sell_time);

                        profitBatchByTx.set(buyId, {
                            transactionId: buyId,
                            contractId: contractId,
                            userId,
                            action: 'buy',
                            amount: -Math.abs(t.buy_price),
                            currency: t.currency || 'USD',
                            transactionTime: buyDate || new Date(),
                            raw: t
                        });

                        profitBatchByTx.set(sellId, {
                            transactionId: sellId,
                            contractId: contractId,
                            userId,
                            action: 'sell',
                            amount: Math.abs(t.payout),
                            currency: t.currency || 'USD',
                            transactionTime: sellDate || buyDate || new Date(),
                            raw: t
                        });

                        contractsToEnrich.add(contractId);
                    }

                    if (profitBatchByTx.size > 0) {
                        await this.transactionRepo.upsert(Array.from(profitBatchByTx.values()), ['transactionId']);
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
                    this.processTradeSync(userId, derivAccountId, contractId);
                }
                this.logger.log(`Enqueued ${contractsToEnrich.size} unique contracts for enrichment (${connKey})`);
            }

            // 5. Immediate repair for existing malformed trades
            await this.repairMalformedTrades(userId, derivAccountId);

            // 6. Record last sync timestamp for this account
            await this.derivAuthRepo.update({ userId, accountId: derivAccountId, isActive: true }, { lastSyncAt: new Date() });
            this.logger.log(`History sync successfully finalized for ${connKey}`);
        } catch (e) {
            this.logger.error(`History sync failed completely for ${connKey}`, e.stack);
        }
    }

    async repairMalformedTrades(userId: string, derivAccountId: string) {
        const connKey = this.buildConnKey(userId, derivAccountId);
        this.logger.log(`Scanning for malformed trades to repair for ${connKey}`);
        const accountId = this.accountIds.get(connKey);
        if (!accountId) return;

        const malformed = await this.tradeRepo.createQueryBuilder('trade')
            .where('trade.accountId = :accountId', { accountId })
            .andWhere("(trade.dataQuality = 'broken' OR trade.dataQuality = 'partial')")
            .getMany();

        if (malformed.length > 0) {
            this.logger.log(`Found ${malformed.length} malformed/partial trades for ${connKey} (Account: ${accountId}). Attempting repair...`);
            for (const trade of malformed) {
                if (trade.contractId) {
                    this.processTradeSync(userId, derivAccountId, trade.contractId);
                }
            }
        }
    }

    private async findTargetAuths(userId: string, requestedAccountId?: string): Promise<DerivAuthEntity[]> {
        const activeAuths = await this.derivAuthRepo.find({
            where: { userId, isActive: true },
            order: { updatedAt: 'DESC' },
        });
        if (!requestedAccountId || requestedAccountId === 'all') {
            return activeAuths;
        }
        const matched = activeAuths.filter(
            (a) => a.accountEntityId === requestedAccountId || a.accountId === requestedAccountId,
        );
        return matched.length > 0 ? matched : [];
    }

    async getStatus(userId: string, requestedAccountId?: string) {
        const allAuths = await this.derivAuthRepo.find({
            where: { userId, isActive: true },
            order: { updatedAt: 'DESC' },
        });
        if (allAuths.length === 0) {
            return {
                isConnected: false,
                isStreaming: false,
                accountId: null,
                currency: null,
                balance: 0,
                equity: 0,
                accountName: null,
                accountEntityId: null,
                lastSyncAt: null,
                accounts: [],
            };
        }

        const primaryAuth =
            (requestedAccountId && requestedAccountId !== 'all'
                ? allAuths.find((a) => a.accountEntityId === requestedAccountId || a.accountId === requestedAccountId)
                : undefined) || allAuths[0];

        const summarized = await Promise.all(
            allAuths.map(async (auth) => {
                const connKey = this.buildConnKey(userId, auth.accountId);
                const entityId = auth.accountEntityId || this.accountIds.get(connKey);
                let account: AccountEntity | null = null;
                if (entityId) {
                    account = await this.accountRepo.findOne({ where: { id: entityId } });
                }
                if (!account) {
                    account = await this.accountRepo.findOne({ where: { userId, mt5Id: auth.accountId } });
                }
                const isStreaming = this.clients.get(connKey)?.getIsAuthorized() || false;
                return {
                    isConnected: true,
                    isStreaming,
                    accountId: auth.accountId,
                    currency: account?.currency || auth.currency || 'USD',
                    balance: account ? Number(account.balance) : (auth.metadata?.balance || 0),
                    equity: account ? Number(account.equity) : (auth.metadata?.balance || 0),
                    accountName: account?.name || `Deriv (${auth.accountId})`,
                    accountEntityId: account?.id || auth.accountEntityId || null,
                    lastSyncAt: auth.lastSyncAt || account?.lastSeen || auth.updatedAt,
                };
            }),
        );

        const primarySummary =
            summarized.find((s) => s.accountId === primaryAuth.accountId) || summarized[0];

        return {
            ...primarySummary,
            accounts: summarized,
        };
    }

    async triggerSync(userId: string, requestedAccountId?: string) {
        const targets = await this.findTargetAuths(userId, requestedAccountId);
        if (targets.length === 0) {
            throw new NotFoundException('Nenhuma conta Deriv ativa vinculada a este usuário');
        }

        let started = 0;
        for (const auth of targets) {
            const connKey = this.buildConnKey(userId, auth.accountId);
            let client = this.clients.get(connKey);
            if (!client || !client.getIsAuthorized()) {
                await this.connectAccount(auth);
                client = this.clients.get(connKey);
            }
            if (client) {
                started += 1;
                this.syncHistory(userId, auth.accountId, client).catch(err => {
                    this.logger.error(`Error during triggerSync for ${connKey}: ${err.message}`);
                });
            }
        }

        if (started > 0) {
            return { success: true, count: started, message: 'Sincronização de histórico iniciada em segundo plano' };
        }

        throw new Error('Não foi possível conectar com o servidor da Deriv');
    }

    async disconnect(userId: string, requestedAccountId?: string) {
        const targets = await this.findTargetAuths(userId, requestedAccountId);

        if (requestedAccountId && requestedAccountId !== 'all') {
            for (const auth of targets) {
                const connKey = this.buildConnKey(userId, auth.accountId);
                const entityId = auth.accountEntityId || this.accountIds.get(connKey);
                this.disconnectConnection(connKey);
                if (entityId) {
                    await this.accountRepo.update({ id: entityId }, { isConnected: false });
                }
                await this.derivAuthRepo.update({ id: auth.id }, { isActive: false });
                this.logger.log(`Deriv account ${auth.accountId} disconnected for user ${userId}`);
            }
            return { success: true, disconnected: targets.length };
        }

        for (const [connKey] of Array.from(this.clients.entries())) {
            if (connKey.startsWith(`${userId}:`)) {
                const entityId = this.accountIds.get(connKey);
                this.disconnectConnection(connKey);
                if (entityId) {
                    await this.accountRepo.update({ id: entityId }, { isConnected: false });
                }
            }
        }

        await this.derivAuthRepo.update({ userId }, { isActive: false });
        this.logger.log(`All Deriv accounts disconnected successfully for user ${userId}`);
        return { success: true };
    }
}
