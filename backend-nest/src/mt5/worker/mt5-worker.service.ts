import { Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy, Optional, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';
import { AccountEntity, AccountType } from '../../account/account.entity';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { getMt5CredentialSecret } from '../../common/security/security.config';
import { UserEntity } from '../../users/user.entity';
import { PositionEntity } from '../position.entity';
import { TradeEntity } from '../trade.entity';
import { Mt5Service } from '../mt5.service';
import { Mt5Gateway } from '../mt5.gateway';
import { ImportLog, ImportMethod, ImportStatus } from '../import-log.entity';
import { DashboardService } from '../../dashboard/dashboard.service';
import { TradingViewService } from '../../tradingview/tradingview.service';
import { EconomicCalendarService } from '../../economic-calendar/economic-calendar.service';
import { EmailProducerService } from '../../email/email-producer.service';
import { TelemetryService } from '../../common/observability/telemetry.service';
import { Mt5ClusterBalancerService, humanizeClientSyncMessage } from './mt5-cluster-balancer.service';

export enum WorkerTaskType {
    START_ACCOUNT = 'START_ACCOUNT',
    STOP_ACCOUNT = 'STOP_ACCOUNT',
    SYNC_ACCOUNT = 'SYNC_ACCOUNT',
    FORCE_FULL_SYNC = 'FORCE_FULL_SYNC',
    RESTART_TERMINAL = 'RESTART_TERMINAL',
    FETCH_MARKET_BATCHES = 'FETCH_MARKET_BATCHES',
    SYNC_CALENDAR = 'SYNC_CALENDAR',
}

export enum WorkerTaskStatus {
    RECEIVED = 'RECEIVED',
    IN_PROGRESS = 'IN_PROGRESS',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED'
}

export interface WorkerTask {
    id: string;
    type: WorkerTaskType;
    priority: number;
    accountId: number;
    accountUuid?: string;
    targetWorkerId?: string;
    leaseEpoch?: number;
    login: string;
    server: string;
    credentialToken?: string;
    from?: string | null;
    options?: Record<string, any>;
    status: WorkerTaskStatus;
    message?: string;
    details?: Record<string, any>;
    createdAt: Date;
    dispatchedAt?: Date;
    completedAt?: Date;
    errorMessage?: string;
}

export interface TemporaryCredential {
    taskId?: string;
    accountId?: number;
    login: string;
    server: string;
    password: string;
    expiresAt: number;
}

export interface WorkerNodeState {
    workerId: string;
    capacity: number;
    systemInfo: Record<string, any>;
    lastHeartbeat?: Date;
    cpuPercent?: number;
    memoryPercent?: number;
    memoryUsedMb?: number;
    memoryTotalMb?: number;
    memoryAvailableMb?: number;
    diskFreeGb?: number;
    activeTerminals?: number;
    monitoredAccounts?: number[];
    isDraining?: boolean;
    registrationOrder?: number;
    isOnline: boolean;
}

export interface AccountLiveTelemetry {
    login: string;
    server: string;
    company?: string;
    accountHolderName?: string;
    tradeMode?: string;
    tradeAllowed?: boolean;
    tradeExpert?: boolean;
    credit?: number;
    pingMs?: number;
    terminalBuild?: number;
    connected: boolean;
    connectionState: 'CONNECTING' | 'CONNECTED' | 'SYNCING' | 'DISCONNECTED' | 'AUTH_FAILED';
    statusMessage?: string;
    lastError?: string | null;
    lastSyncAt?: string;
    openPositionsCount?: number;
    pendingOrdersCount?: number;
    lastDealTicket?: number;
    lastSyncedTradesCount?: number;
    orders?: any[];
}

export interface WorkerEventRecord {
    id: string;
    workerId: string;
    accountId?: number;
    login?: string;
    server?: string;
    eventType: string;
    severity: string;
    message: string;
    metadata?: Record<string, any>;
    timestamp: string;
}

@Injectable()
export class Mt5WorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(Mt5WorkerService.name);
    private readonly auditLogger = new Logger('MT5AuditTrail');

    // In-memory queues & telemetry state (hydrated from PostgreSQL on startup)
    private pendingTasks: Map<string, WorkerTask> = new Map();
    private credentialsStore: Map<string, TemporaryCredential> = new Map();
    private workers: Map<string, WorkerNodeState> = new Map();
    private accountTelemetry: Map<string, AccountLiveTelemetry> = new Map();
    private loginToUserMap: Map<string, { userId: string; accountUuid?: string; server?: string }> = new Map();
    private recentEvents: WorkerEventRecord[] = [];
    private initialFullSyncDispatched: Set<string> = new Set();
    private lastHeartbeatDbTouch: Map<string, number> = new Map();
    private accountToWorkerCache: Map<string, string> = new Map();
    private workerRegistrationCounter = 0;
    private calendarSyncTimer: NodeJS.Timeout | null = null;
    private sharedDemoFeedConfig: {
        login: string;
        password?: string;
        server: string;
        accountUuid?: string;
        userId?: string;
        updatedAt: string;
    } | null = null;

    constructor(
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        @InjectRepository(PositionEntity)
        private readonly positionRepo: Repository<PositionEntity>,
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        @InjectRepository(ImportLog)
        private readonly importLogRepo: Repository<ImportLog>,
        private readonly mt5Service: Mt5Service,
        private readonly mt5Gateway: Mt5Gateway,
        private readonly dashboardService: DashboardService,
        private readonly emailProducer: EmailProducerService,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        @Optional() private readonly telemetry?: TelemetryService,
        @Optional() private readonly tradingViewService?: TradingViewService,
        @Optional() private readonly economicCalendarService?: EconomicCalendarService,
        @Optional() private readonly configService?: ConfigService,
        @Optional() @Inject(forwardRef(() => Mt5ClusterBalancerService))
        private readonly clusterBalancer?: Mt5ClusterBalancerService,
    ) { }

    private getCredentialEncryptionKey(): string {
        return getMt5CredentialSecret(this.configService);
    }

    async onModuleInit() {
        const envDemoLogin = (process.env.MT5_DEMO_FEED_LOGIN || '').trim();
        const envDemoPass = (process.env.MT5_DEMO_FEED_PASSWORD || '').trim();
        const envDemoServer = this.normalizeBrokerServer((process.env.MT5_DEMO_FEED_SERVER || 'MetaQuotes-Demo').trim());
        if (envDemoLogin) {
            this.sharedDemoFeedConfig = {
                login: envDemoLogin,
                password: envDemoPass || undefined,
                server: envDemoServer || 'MetaQuotes-Demo',
                updatedAt: new Date().toISOString(),
            };
            this.logger.log(`[MT5-DEMO-ENV] Conta Demo Global carregada do .env: #${envDemoLogin} (${envDemoServer})`);
        }
        try {
            const mt5Accounts = await this.accountRepo.find({
                where: { isArchived: false }
            });
            let hydratedCount = 0;
            for (const acc of mt5Accounts) {
                const cleanLogin = (acc.mt5Id || '').toString().trim();
                if (!cleanLogin || !acc.userId) continue;
                const existing = this.loginToUserMap.get(cleanLogin);
                if (!existing || acc.isConnected) {
                    this.loginToUserMap.set(cleanLogin, {
                        userId: acc.userId,
                        accountUuid: acc.id,
                        server: acc.broker || '',
                    });
                    if (acc.assignedWorkerId) {
                        this.accountToWorkerCache.set(cleanLogin, acc.assignedWorkerId);
                    }
                }
                if (!this.accountTelemetry.has(cleanLogin)) {
                    this.accountTelemetry.set(cleanLogin, {
                        login: cleanLogin,
                        server: acc.broker || '',
                        connected: Boolean(acc.isConnected),
                        connectionState: acc.isConnected ? 'CONNECTED' : 'DISCONNECTED',
                        lastSyncAt: acc.lastSeen ? new Date(acc.lastSeen).toISOString() : undefined,
                    });
                }
                hydratedCount++;
            }
            this.logger.log(`Hydrated ${hydratedCount} MT5 account mappings from PostgreSQL on startup.`);
        } catch (err) {
            this.logger.warn(`Failed to hydrate MT5 account mappings on startup: ${err.message}`);
        }

        // Ciclo automático a cada 10 minutos (600.000 ms) para consultar e importar novas notícias do Calendário no MT5 usando a Conta Demo
        if (this.calendarSyncTimer) {
            clearInterval(this.calendarSyncTimer);
            this.calendarSyncTimer = null;
        }
        if (process.env.MT5_DEDICATED_SERVER !== 'true') {
            this.logger.log(
                `[MT5-CALENDAR-SCHEDULER] Agendador automático de notícias do Calendário MT5 iniciado (ciclo: a cada 10 minutos via Conta Demo #${this.sharedDemoFeedConfig?.login || 'DEMO_FEED'}).`,
            );
            setTimeout(() => {
                this.logger.log('[MT5-CALENDAR-SCHEDULER] Executando sincronização inicial de notícias do Calendário MT5 pós-startup...');
                this.triggerMt5CalendarSync().catch(() => {});
            }, 15_000);
            this.calendarSyncTimer = setInterval(() => {
                this.logger.log('[MT5-CALENDAR-SCHEDULER] Ciclo de 10 minutos atingido: consultando novas notícias no MT5 via Conta Demo...');
                this.triggerMt5CalendarSync().catch((err) => {
                    this.logger.warn(`[MT5-CALENDAR-SCHEDULER] Falha ao agendar sync periódico de 10min do calendário MT5: ${err?.message || err}`);
                });
            }, 10 * 60 * 1000);
        }
    }

    onModuleDestroy() {
        if (this.calendarSyncTimer) {
            clearInterval(this.calendarSyncTimer);
            this.calendarSyncTimer = null;
        }
    }

    public deriveNumericAccountId(login: string, fallback?: number): number {
        if (fallback && fallback > 0) return fallback;
        const digitsOnly = (login || '').replace(/\D/g, '');
        const parsed = parseInt(digitsOnly, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
        let hash = 5381;
        for (let i = 0; i < (login || '').length; i++) {
            hash = ((hash << 5) + hash) + login.charCodeAt(i);
            hash = hash & 0x7fffffff;
        }
        return hash > 0 ? hash : 1;
    }

    public normalizeBrokerServer(server: string): string {
        const s = (server || '').trim();
        if (!s) return s;
        const lower = s.toLowerCase();

        // Normalização dinâmica para clusters numerados (Exness, XM, HFM, IC Markets, Pepperstone, Vantage, Prop Firms, etc.)
        const exnessMatch = lower.match(/^exness(ke|za|eu|uk)?[\s_-]*mt5[\s_-]*(real[a-z]?|trial[a-z]?|demo)[\s_-]*(\d*)$/);
        if (exnessMatch) {
            const region = (exnessMatch[1] || '').toUpperCase();
            const kind = exnessMatch[2].startsWith('real') ? 'Real' : 'Trial';
            const rawNum = exnessMatch[3] ? parseInt(exnessMatch[3], 10) : 0;
            const suffix = rawNum > 1 ? String(rawNum) : '';
            return `Exness${region}-MT5${kind}${suffix}`;
        }

        const xmMatch = lower.match(/^xmglobal[\s_-]*mt5(?:[\s_-]*(\d+))?$/);
        if (xmMatch) {
            const rawNum = xmMatch[1] ? parseInt(xmMatch[1], 10) : 0;
            return rawNum > 1 ? `XMGlobal-MT5 ${rawNum}` : 'XMGlobal-MT5';
        }

        const hfmGlobalLiveMatch = lower.match(/^hfmarketsglobal[\s_-]*live[\s_-]*(\d+)$/);
        if (hfmGlobalLiveMatch) {
            return `HFMarketsGlobal-Live${parseInt(hfmGlobalLiveMatch[1], 10)}`;
        }
        if (/^hfmarketsglobal[\s_-]*demo$/.test(lower)) return 'HFMarketsGlobal-Demo';

        const hfmRegMatch = lower.match(/^hfmarkets(sv|sa|ke)[\s_-]*(live|demo)[\s_-]*(\d*)$/);
        if (hfmRegMatch) {
            const reg = hfmRegMatch[1].toUpperCase();
            const kind = hfmRegMatch[2] === 'live' ? 'Live' : 'Demo';
            const rawNum = hfmRegMatch[3] ? parseInt(hfmRegMatch[3], 10) : 0;
            return `HFMarkets${reg}-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const icmMatch = lower.match(/^icmarkets(sc|eu|au)[\s_-]*(mt5|demo)(?:[\s_-]*(\d+))?$/);
        if (icmMatch) {
            const reg = icmMatch[1].toUpperCase();
            if (icmMatch[2] === 'demo') return `ICMarkets${reg}-Demo`;
            const rawNum = icmMatch[3] ? parseInt(icmMatch[3], 10) : 0;
            return rawNum > 1 ? `ICMarkets${reg}-MT5-${rawNum}` : `ICMarkets${reg}-MT5`;
        }

        const pepLiveMatch = lower.match(/^pepperstone[\s_-]*mt5[\s_-]*live[\s_-]*(\d+)$/);
        if (pepLiveMatch) {
            return `Pepperstone-MT5-Live${String(parseInt(pepLiveMatch[1], 10)).padStart(2, '0')}`;
        }

        const vantageMatch = lower.match(/^vantageinternational[\s_-]*(live|demo)(?:[\s_-]*(\d+))?$/);
        if (vantageMatch) {
            if (vantageMatch[1] === 'demo') return 'VantageInternational-Demo';
            const rawNum = vantageMatch[2] ? parseInt(vantageMatch[2], 10) : 0;
            return rawNum > 1 ? `VantageInternational-Live ${rawNum}` : 'VantageInternational-Live';
        }

        const justMarketsMatch = lower.match(/^justmarkets[\s_-]*(live|demo)[\s_-]*(\d*)$/);
        if (justMarketsMatch) {
            const kind = justMarketsMatch[1] === 'live' ? 'Live' : 'Demo';
            const rawNum = justMarketsMatch[2] ? parseInt(justMarketsMatch[2], 10) : 0;
            return `JustMarkets-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const fxgtMatch = lower.match(/^fxgt[\s_-]*(live|demo)[\s_-]*(\d*)$/);
        if (fxgtMatch) {
            const kind = fxgtMatch[1] === 'live' ? 'Live' : 'Demo';
            const rawNum = fxgtMatch[2] ? parseInt(fxgtMatch[2], 10) : 0;
            return `FXGT-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const puPrimeMatch = lower.match(/^puprime[\s_-]*(live|demo)[\s_-]*(\d*)$/);
        if (puPrimeMatch) {
            const kind = puPrimeMatch[1] === 'live' ? 'Live' : 'Demo';
            const rawNum = puPrimeMatch[2] ? parseInt(puPrimeMatch[2], 10) : 0;
            return `PUPrime-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const dooPrimeMatch = lower.match(/^dooprime[\s_-]*(live|demo)(?:[\s_-]*(\d+))?$/);
        if (dooPrimeMatch) {
            if (dooPrimeMatch[1] === 'demo') return 'DooPrime-Demo';
            const rawNum = dooPrimeMatch[2] ? parseInt(dooPrimeMatch[2], 10) : 0;
            return rawNum > 1 ? `DooPrime-Live ${rawNum}` : 'DooPrime-Live';
        }

        const swissLiveMatch = lower.match(/^swissquote[\s_-]*live[\s_-]*(\d+)$/);
        if (swissLiveMatch) {
            return `Swissquote-Live${parseInt(swissLiveMatch[1], 10)}`;
        }

        const cptLiveMatch = lower.match(/^cptmarkets[\s_-]*live[\s_-]*(\d+)$/);
        if (cptLiveMatch) {
            return `CPTMarkets-Live${String(parseInt(cptLiveMatch[1], 10)).padStart(2, '0')}`;
        }

        const valetaxMatch = lower.match(/^valetaxintl[\s_-]*(live|demo)[\s_-]*(\d*)$/);
        if (valetaxMatch) {
            const kind = valetaxMatch[1] === 'live' ? 'Live' : 'Demo';
            const rawNum = valetaxMatch[2] ? parseInt(valetaxMatch[2], 10) : 0;
            return `ValetaxIntl-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const ftmoMatch = lower.match(/^ftmo[\s_-]*(server|demo)[\s_-]*(\d*)$/);
        if (ftmoMatch) {
            const kind = ftmoMatch[1] === 'server' ? 'Server' : 'Demo';
            const rawNum = ftmoMatch[2] ? parseInt(ftmoMatch[2], 10) : 0;
            return `FTMO-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const fundedNextMatch = lower.match(/^fundednext[\s_-]*(server|trial)[\s_-]*(\d*)$/);
        if (fundedNextMatch) {
            const rawNum = fundedNextMatch[2] ? parseInt(fundedNextMatch[2], 10) : 0;
            if (fundedNextMatch[1] === 'trial') {
                return `FundedNext-Trial${rawNum > 1 ? rawNum : ''}`;
            }
            return rawNum > 1 ? `FundedNext-Server ${rawNum}` : 'FundedNext-Server';
        }

        const fundingPipsMatch = lower.match(/^fundingpips[\s_-]*(server|demo)[\s_-]*(\d*)$/);
        if (fundingPipsMatch) {
            const kind = fundingPipsMatch[1] === 'server' ? 'Server' : 'Demo';
            const rawNum = fundingPipsMatch[2] ? parseInt(fundingPipsMatch[2], 10) : 0;
            return `FundingPips-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const goatMatch = lower.match(/^goatfunded[\s_-]*(server|demo)[\s_-]*(\d*)$/);
        if (goatMatch) {
            const kind = goatMatch[1] === 'server' ? 'Server' : 'Demo';
            const rawNum = goatMatch[2] ? parseInt(goatMatch[2], 10) : 0;
            return `GoatFunded-${kind}${rawNum > 1 ? rawNum : ''}`;
        }

        const typoMap: Record<string, string> = {
            'deric-demo': 'Deriv-Demo',
            'deriv-demo': 'Deriv-Demo',
            'deric-server': 'Deriv-Server',
            'deriv-server': 'Deriv-Server',
            'deric-server-02': 'Deriv-Server-02',
            'deriv-server-02': 'Deriv-Server-02',
            'deriv-server-03': 'Deriv-Server-03',
            'goatfundedtrader-server': 'GoatFundedTrader-Server',
            'goatfundedtrader-server2': 'GoatFundedTrader-Server2',
            'fivepercentonline-real': 'FivePercentOnline-Real',
            'fivepercentonline-demo': 'FivePercentOnline-Demo',
            'fivepercentonline-server': 'FivePercentOnline-Server',
            'alphacapitalgroup-server': 'AlphaCapitalGroup-Server',
            'alphacapitalgroup-server2': 'AlphaCapitalGroup-Server2',
            'alphacapitalgroup-demo': 'AlphaCapitalGroup-Demo',
            'acgmarkets-live': 'ACGMarkets-Live',
            'acgmarkets-demo': 'ACGMarkets-Demo',
            'maven-server': 'Maven-Server',
            'maven-server2': 'Maven-Server2',
            'maven-demo': 'Maven-Demo',
            'maventrade-server': 'MavenTrade-Server',
            'e8markets-server': 'E8Markets-Server',
            'e8markets-demo': 'E8Markets-Demo',
            'e8funding-server': 'E8Funding-Server',
            'blueguardian-server': 'BlueGuardian-Server',
            'blueguardian-server2': 'BlueGuardian-Server2',
            'blueguardian-demo': 'BlueGuardian-Demo',
            'fxify-server': 'FXIFY-Server',
            'fxify-demo': 'FXIFY-Demo',
            'fundedtradingplus-live': 'FundedTradingPlus-Live',
            'fundedtradingplus-demo': 'FundedTradingPlus-Demo',
            'fttrading-server': 'fttrading-server',
            'fortraders-demo': 'ForTraders-Demo',
            'fundingtradersgroup-server': 'FundingTradersGroup-Server',
            'fundingtraders-demo': 'FundingTraders-Demo',
            'thefundedtrader-server': 'TheFundedTrader-Server',
            'thefundedtrader-demo': 'TheFundedTrader-Demo',
            'dnafunded-live': 'DNAFunded-Live',
            'dnafunded-demo': 'DNAFunded-Demo',
            'oandaproptrader-live': 'OANDAPropTrader-Live',
            'oandaproptrader-demo': 'OANDAPropTrader-Demo',
            'xm.com-mt5': 'XM.COM-MT5',
            'xmmena-mt5': 'XMMena-MT5',
            'fbs-demo': 'FBS-Demo',
            'fbs-real': 'FBS-Real',
            'octafx-demo': 'OctaFX-Demo',
            'octafx-real': 'OctaFX-Real',
            'octafx-real2': 'OctaFX-Real2',
            'octafx-real3': 'OctaFX-Real3',
            'octamarkets-demo': 'OctaMarkets-Demo',
            'octamarkets-real': 'OctaMarkets-Real',
            'tickmill-demo': 'Tickmill-Demo',
            'tickmill-live': 'Tickmill-Live',
            'tickmill-live02': 'Tickmill-Live02',
            'tickmilluk-demo': 'TickmillUK-Demo',
            'tickmilluk-live': 'TickmillUK-Live',
            'fusionmarkets-demo': 'FusionMarkets-Demo',
            'fusionmarkets-demo 2': 'FusionMarkets-Demo 2',
            'fusionmarkets-live': 'FusionMarkets-Live',
            'fusionmarkets-live 2': 'FusionMarkets-Live 2',
            'fusionmarkets-live 3': 'FusionMarkets-Live 3',
            'forextimefxtm-demo01': 'ForexTimeFXTM-Demo01',
            'forextimefxtm-demo02': 'ForexTimeFXTM-Demo02',
            'forextimefxtm-live01': 'ForexTimeFXTM-Live01',
            'forextimefxtm-live02': 'ForexTimeFXTM-Live02',
            'startrader-demo': 'STARTRADER-Demo',
            'startrader-live': 'STARTRADER-Live',
            'startrader-live2': 'STARTRADER-Live2',
            'startrader-live3': 'STARTRADER-Live3',
            'startrader-live4': 'STARTRADER-Live4',
            'startraderfinancial-demo': 'STARTRADERFinancial-Demo',
            'startraderfinancial-live': 'STARTRADERFinancial-Live',
            'dprimevu-demo': 'DPrimeVU-Demo',
            'monetamarkets-demo': 'MonetaMarkets-Demo',
            'monetamarkets-live': 'MonetaMarkets-Live',
            'monetamarkets-live 2': 'MonetaMarkets-Live 2',
            'activtrades-demo': 'ActivTrades-Demo',
            'activtrades-live': 'ActivTrades-Live',
            'activtradescorp-demo': 'ActivTradesCorp-Demo',
            'activtradescorp-live': 'ActivTradesCorp-Live',
            'equitibrokeragesc-demo': 'EquitiBrokerageSC-Demo',
            'equitibrokeragesc-live': 'EquitiBrokerageSC-Live',
            'equitigroupltd-live': 'EquitiGroupLtd-Live',
            'mexatlantic-demo': 'MEXAtlantic-Demo',
            'mexatlantic-real': 'MEXAtlantic-Real',
            'mexatlantic-real-2': 'MEXAtlantic-Real-2',
            'mexgroup-demo': 'MEXGroup-Demo',
            'mexgroup-live': 'MEXGroup-Live',
            'atfx-demo': 'ATFX-Demo',
            'atfx-live': 'ATFX-Live',
            'atfxgm-demo': 'ATFXGM-Demo',
            'atfxgm-live': 'ATFXGM-Live',
            'alpari-mt5-demo': 'Alpari-MT5-Demo',
            'alpari-mt5': 'Alpari-MT5',
            'amarkets-demo': 'AMarkets-Demo',
            'amarkets-real': 'AMarkets-Real',
            'infinoxlimited-mt5demo': 'InfinoxLimited-MT5Demo',
            'infinoxlimited-mt5live': 'InfinoxLimited-MT5Live',
            'swissquote-demo': 'Swissquote-Demo',
            'swissquote-server': 'Swissquote-Server',
            'swissquote-real': 'Swissquote-Real',
            'swissquotebankeu-server': 'SwissquoteBankEU-Server',
            'darwinex-demo': 'Darwinex-Demo',
            'darwinex-live': 'Darwinex-Live',
            'globalprime-demo': 'GlobalPrime-Demo',
            'globalprime-trade': 'GlobalPrime-Trade',
            'gomarkets-demo': 'GOMarkets-Demo',
            'gomarkets-live': 'GOMarkets-Live',
            'cptmarkets-demo': 'CPTMarkets-Demo',
            'cptmarketsuklimited-trading-live': 'CPTMarketsUKLimited-Trading-Live',
            'scopemarkets-demo': 'ScopeMarkets-Demo',
            'scopemarkets-live': 'ScopeMarkets-Live',
            'capitalpointtrading-demo': 'CapitalPointTrading-Demo',
            'capitalpointtrading-mt5': 'CapitalPointTrading-MT5',
            'capitalpointtrading-mt5-6': 'CapitalPointTrading-MT5-6',
            'libertex-demo': 'Libertex-Demo',
            'libertex-real': 'Libertex-Real',
            'instaforex-demo': 'InstaForex-Demo',
            'instaforex-server': 'InstaForex-Server',
            'instaforex-europe': 'InstaForex-Europe',
            'instaforex-asia': 'InstaForex-Asia',
            'freshforex-mt5-demo': 'FreshForex-MT5-Demo',
            'freshforex-mt5': 'FreshForex-MT5',
            'nordfx-demo': 'NordFX-Demo',
            'nordfx-real': 'NordFX-Real',
            'cmtrading-demo': 'CMTrading-Demo',
            'cmtrading-live': 'CMTrading-Live',
            'bdswissglobal-demo': 'BDSwissGlobal-Demo',
            'bdswissglobal-live': 'BDSwissGlobal-Live',
            'cfifinancial-demo': 'CFIFinancial-Demo',
            'cfifinancial-live': 'CFIFinancial-Live',
            'btgpactual-demo': 'BTGPactual-Demo',
            'btgpactual-prd': 'BTGPactual-PRD',
            'xpinvestimentos-demo': 'XPInvestimentos-Demo',
            'xpinvestimentos-prd': 'XPInvestimentos-PRD',
        };
        return typoMap[lower] || s;
    }

    // ==========================================
    // 1. WORKER REGISTRATION & TELEMETRY
    // ==========================================
    registerWorker(workerId: string, capacity: number, systemInfo: Record<string, any>) {
        const prev = this.workers.get(workerId);
        const regOrder = prev?.registrationOrder ?? ++this.workerRegistrationCounter;
        this.logger.log(`Worker conectado e registrado: [${workerId}] (Capacidade: ${capacity} contas, ordem=#${regOrder})`);
        this.workers.set(workerId, {
            workerId,
            capacity,
            systemInfo: systemInfo || {},
            lastHeartbeat: new Date(),
            isDraining: Boolean(this.clusterBalancer?.isWorkerDraining(workerId)),
            registrationOrder: regOrder,
            isOnline: true
        });
        return { success: true, workerId, registeredAt: new Date().toISOString() };
    }

    recordHeartbeat(heartbeat: {
        workerId: string;
        cpuPercent: number;
        memoryPercent: number;
        memoryUsedMb?: number;
        memoryTotalMb?: number;
        memoryAvailableMb?: number;
        diskFreeGb?: number;
        activeTerminals: number;
        monitoredAccounts: number[];
        timestamp?: string;
    }) {
        this.telemetry?.recordMt5Metric('workerHeartbeats', 1);
        const existing = this.workers.get(heartbeat.workerId);
        const monitoredList = heartbeat.monitoredAccounts || [];
        const regOrder = existing?.registrationOrder ?? ++this.workerRegistrationCounter;
        const isDraining = Boolean(this.clusterBalancer?.isWorkerDraining(heartbeat.workerId));
        this.workers.set(heartbeat.workerId, {
            workerId: heartbeat.workerId,
            capacity: existing?.capacity || 10,
            systemInfo: existing?.systemInfo || {},
            lastHeartbeat: new Date(),
            cpuPercent: heartbeat.cpuPercent,
            memoryPercent: heartbeat.memoryPercent,
            memoryUsedMb: heartbeat.memoryUsedMb,
            memoryTotalMb: heartbeat.memoryTotalMb,
            memoryAvailableMb: heartbeat.memoryAvailableMb,
            diskFreeGb: heartbeat.diskFreeGb,
            activeTerminals: heartbeat.activeTerminals,
            monitoredAccounts: monitoredList,
            isDraining,
            registrationOrder: regOrder,
            isOnline: true
        });

        // Refresh `lastSeen` (throttled once per 60s per account) for all accounts actively held by the worker
        // so accounts on 30-min sticky-session idle cooldown never falsely trigger stale disconnection!
        if (monitoredList.length > 0) {
            const nowMs = Date.now();
            const loginsToTouch: string[] = [];
            for (const rawId of monitoredList) {
                const loginStr = String(rawId || '').trim();
                if (!loginStr) continue;
                const tel = this.accountTelemetry.get(loginStr);
                if (tel?.connectionState === 'AUTH_FAILED') continue;

                const lastTouch = this.lastHeartbeatDbTouch.get(loginStr) || 0;
                if (nowMs - lastTouch >= 60_000) {
                    this.lastHeartbeatDbTouch.set(loginStr, nowMs);
                    loginsToTouch.push(loginStr);
                }
            }

            if (loginsToTouch.length > 0) {
                this.telemetry?.recordMt5Metric('accountsTouched', loginsToTouch.length);
                this.accountRepo
                    .update(
                        { mt5Id: In(loginsToTouch), isArchived: false },
                        { lastSeen: new Date(), isConnected: true },
                    )
                    .catch((err) =>
                        this.logger.debug(
                            `Heartbeat batch touch warning: ${err?.message || err}`,
                        ),
                    );
            }
        }

        const evictLogins = this.clusterBalancer?.consumeEvictionsForWorker(heartbeat.workerId) || [];
        return { success: true, evictLogins, isDraining };
    }

    getWorkerStatus(workerId?: string, includeSensitive = false) {
        const now = Date.now();
        const checkWorker = (w: WorkerNodeState) => {
            const lastHb = w.lastHeartbeat ? new Date(w.lastHeartbeat).getTime() : 0;
            const isOnline = lastHb > 0 && (now - lastHb < 45000);
            const isDraining = Boolean(w.isDraining || this.clusterBalancer?.isWorkerDraining(w.workerId));
            if (includeSensitive) {
                return {
                    ...w,
                    isDraining,
                    isOnline,
                };
            }
            const { monitoredAccounts, ...safeWorker } = w;
            return {
                ...safeWorker,
                monitoredAccountsCount: Array.isArray(monitoredAccounts) ? monitoredAccounts.length : 0,
                isDraining,
                isOnline,
            };
        };

        if (workerId) {
            const w = this.workers.get(workerId);
            return w ? checkWorker(w) : null;
        }
        return Array.from(this.workers.values()).map(checkWorker);
    }

    // ==========================================
    // 2. TASK QUEUE & CREDENTIALS
    // ==========================================
    private getDefaultPriority(type: WorkerTaskType): number {
        switch (type) {
            case WorkerTaskType.START_ACCOUNT:
            case WorkerTaskType.STOP_ACCOUNT:
                return 1;
            case WorkerTaskType.RESTART_TERMINAL:
                return 2;
            case WorkerTaskType.FORCE_FULL_SYNC:
                return 3;
            case WorkerTaskType.SYNC_ACCOUNT:
            default:
                return 5;
        }
    }

    createAccountTask(
        type: WorkerTaskType,
        login: string,
        server: string,
        password?: string,
        accountIdNum?: number,
        options: Record<string, any> = {}
    ): WorkerTask {
        const cleanLogin = (login || '').toString().trim();
        const cleanServer = this.normalizeBrokerServer(server);

        // Supersede older queued (unclaimed) tasks for the same login & type
        for (const [existingId, existingTask] of this.pendingTasks.entries()) {
            if (
                existingTask.login === cleanLogin &&
                existingTask.status === WorkerTaskStatus.RECEIVED &&
                (existingTask.type === type || type === WorkerTaskType.STOP_ACCOUNT)
            ) {
                this.pendingTasks.delete(existingId);
            }
        }

        const taskId = randomUUID();
        const numericAccId = this.deriveNumericAccountId(cleanLogin, accountIdNum);

        let credentialToken: string | undefined = undefined;
        if (password) {
            credentialToken = `token_${randomUUID().replace(/-/g, '')}`;
            this.credentialsStore.set(credentialToken, {
                taskId,
                accountId: numericAccId,
                login: cleanLogin,
                server: cleanServer,
                password: CryptoUtil.encrypt(password, this.getCredentialEncryptionKey()),
                expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes TTL
            });
        }

        const initialMsg = type === WorkerTaskType.START_ACCOUNT
            ? `Ligação solicitada! Estamos a conectar e sincronizar a sua conta.`
            : `A atualizar os dados da sua conta...`;

        const explicitTargetWorker = options?.targetWorkerId ? String(options.targetWorkerId).trim() : undefined;
        const cachedWorker = cleanLogin ? this.accountToWorkerCache.get(cleanLogin) : undefined;
        const targetWorkerId = explicitTargetWorker || cachedWorker || undefined;

        if (targetWorkerId && cleanLogin && type !== WorkerTaskType.SYNC_CALENDAR) {
            this.accountToWorkerCache.set(cleanLogin, targetWorkerId);
        }

        const task: WorkerTask = {
            id: taskId,
            type,
            priority: options?.priority ?? this.getDefaultPriority(type),
            accountId: numericAccId,
            accountUuid: options?.accountUuid,
            targetWorkerId,
            leaseEpoch: options?.leaseEpoch,
            login: cleanLogin,
            server: cleanServer,
            credentialToken,
            from: options?.from || null,
            options,
            status: WorkerTaskStatus.RECEIVED,
            message: initialMsg,
            details: {},
            createdAt: new Date()
        };

        this.pendingTasks.set(taskId, task);

        if (cleanLogin && options?.userId && type !== WorkerTaskType.START_ACCOUNT) {
            const existingOwner = this.loginToUserMap.get(cleanLogin);
            // Para START_ACCOUNT o mapeamento é gravado apenas após WorkerTaskStatus.SUCCESS (autenticação verificada)
            if (!existingOwner || existingOwner.userId === options.userId) {
                this.loginToUserMap.set(cleanLogin, {
                    userId: options.userId,
                    accountUuid: options.accountUuid,
                    server: cleanServer,
                });
            }
        }

        if (type === WorkerTaskType.START_ACCOUNT && cleanLogin) {
            const existingTel = this.accountTelemetry.get(cleanLogin);
            this.accountTelemetry.set(cleanLogin, {
                ...(existingTel || { login: cleanLogin, server: cleanServer, connected: false }),
                server: cleanServer || existingTel?.server || '',
                connectionState: 'CONNECTING',
                statusMessage: initialMsg,
                lastError: null,
            });
        }

        // Record audit event for connection/sync request
        this.recentEvents.unshift({
            id: randomUUID(),
            workerId: targetWorkerId || 'BACKEND-API',
            accountId: numericAccId,
            login: cleanLogin,
            server: cleanServer,
            eventType: type === WorkerTaskType.START_ACCOUNT ? 'CONNECTION_REQUESTED' : `TASK_${type}_REQUESTED`,
            severity: 'INFO',
            message: initialMsg,
            metadata: { taskId, type, priority: task.priority },
            timestamp: new Date().toISOString(),
        });
        if (this.recentEvents.length > 100) this.recentEvents.length = 100;

        this.auditLogger.log(
            `[AUDIT] Solicitação ${type} criada para conta MT5 ${cleanLogin}@${cleanServer} (TaskID: ${taskId}, Target: ${targetWorkerId || 'ANY'}, Prioridade: P${task.priority})`
        );
        return task;
    }

    getPendingTasks(claim: boolean = true, workerId?: string): WorkerTask[] {
        const now = Date.now();
        const requesterId = workerId ? String(workerId).trim() : undefined;
        const requesterDraining = Boolean(requesterId && this.clusterBalancer?.isWorkerDraining(requesterId));
        const tasks: WorkerTask[] = [];
        for (const task of this.pendingTasks.values()) {
            if (requesterId) {
                if (task.targetWorkerId && task.targetWorkerId !== requesterId) {
                    continue;
                }
                if (!task.targetWorkerId && requesterDraining) {
                    continue;
                }
            }

            const refTime = task.dispatchedAt
                ? new Date(task.dispatchedAt).getTime()
                : (task.createdAt ? new Date(task.createdAt).getTime() : now);
            const ageMs = now - refTime;

            if (
                task.status === WorkerTaskStatus.RECEIVED ||
                (task.status === WorkerTaskStatus.IN_PROGRESS && ageMs > 90000)
            ) {
                if (claim) {
                    task.status = WorkerTaskStatus.IN_PROGRESS;
                    task.dispatchedAt = new Date();
                    if (!task.targetWorkerId && requesterId) {
                        task.targetWorkerId = requesterId;
                        if (task.login && task.type !== WorkerTaskType.SYNC_CALENDAR) {
                            this.accountToWorkerCache.set(task.login, requesterId);
                        }
                    }
                    if (!task.message || task.message.startsWith('Aguardando') || task.message.startsWith('Solicitação') || task.message.startsWith('Ligação solicitada')) {
                        task.message = `A conectar e sincronizar os dados da sua conta em segurança...`;
                    }
                    this.auditLogger.log(
                        `[AUDIT] Worker [${requesterId || 'GENERIC'}] reivindicou tarefa [${task.id}] (${task.type}) para conta ${task.login}@${task.server}`
                    );
                }
                tasks.push(task);
            }
        }

        tasks.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });

        return tasks;
    }

    getTaskById(taskId: string): WorkerTask | null {
        return this.pendingTasks.get(taskId) || null;
    }

    getLatestTaskForLogin(login: string): WorkerTask | null {
        const cleanLogin = (login || '').toString().trim();
        if (!cleanLogin) return null;
        const matching = Array.from(this.pendingTasks.values()).filter(t => t.login === cleanLogin);
        if (matching.length === 0) return null;
        matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return matching[0];
    }

    ackTask(taskId: string, status: WorkerTaskStatus, message?: string, details?: Record<string, any>) {
        const task = this.pendingTasks.get(taskId);
        if (!task) {
            return { success: false, message: 'Task not found' };
        }
        task.status = status;
        if (message) task.message = message;
        if (details && Object.keys(details).length > 0) {
            task.details = { ...(task.details || {}), ...details };
        }
        if (status === WorkerTaskStatus.SUCCESS || status === WorkerTaskStatus.FAILED) {
            task.completedAt = new Date();
        }
        if (status === WorkerTaskStatus.FAILED && message) {
            task.errorMessage = message;
        }
        this.auditLogger.log(
            `[AUDIT] Tarefa [${taskId}] (${task.type} - ${task.login}@${task.server}) -> Status: ${status} | Msg: ${message || 'N/A'} | Details: ${JSON.stringify(task.details || {})}`
        );

        // Update live telemetry state for real numeric MT5 logins only (never SYNC_CALENDAR or synthetic keys)
        const isNumericLogin = Boolean(task.login && /^\d+$/.test(task.login.trim()));
        if (task.login && isNumericLogin && task.type !== WorkerTaskType.SYNC_CALENDAR) {
            const cleanLogin = task.login.trim();
            const existingTel = this.accountTelemetry.get(cleanLogin) || {
                login: cleanLogin,
                server: task.server,
                connected: false,
                connectionState: 'CONNECTING' as const,
            };

            if (status === WorkerTaskStatus.IN_PROGRESS) {
                existingTel.connectionState = task.type === WorkerTaskType.START_ACCOUNT ? 'CONNECTING' : 'SYNCING';
                existingTel.statusMessage = message || existingTel.statusMessage;
                if (details?.step === 'SYNCING_DATA' && task.options?.userId) {
                    this.loginToUserMap.set(cleanLogin, {
                        userId: task.options.userId,
                        accountUuid: task.options.accountUuid || task.accountUuid,
                        server: task.server,
                    });
                }
            } else if (status === WorkerTaskStatus.SUCCESS) {
                if (task.type === WorkerTaskType.STOP_ACCOUNT) {
                    existingTel.connected = false;
                    existingTel.connectionState = 'DISCONNECTED';
                    existingTel.statusMessage = message || 'Conta desconectada.';
                } else {
                    if (task.options?.userId) {
                        this.loginToUserMap.set(cleanLogin, {
                            userId: task.options.userId,
                            accountUuid: task.options.accountUuid,
                            server: task.server,
                        });
                    }
                    existingTel.connected = true;
                    existingTel.connectionState = 'CONNECTED';
                    existingTel.statusMessage = message || 'Conectado e sincronizado.';
                    existingTel.lastError = null;
                    existingTel.lastSyncAt = new Date().toISOString();
                    if (task.details?.syncedTradesCount !== undefined) {
                        existingTel.lastSyncedTradesCount = Number(task.details.syncedTradesCount) || 0;
                    }
                }
            } else if (status === WorkerTaskStatus.FAILED) {
                if (task.type === WorkerTaskType.START_ACCOUNT) {
                    existingTel.connected = false;
                    existingTel.connectionState = 'AUTH_FAILED';
                }
                existingTel.lastError = message || 'Falha na execução da tarefa no MT5.';
                existingTel.statusMessage = message;
            }
            this.accountTelemetry.set(cleanLogin, existingTel);
        }

        // Persist database audit log (ImportLog) and update AccountEntity on completion
        if (status === WorkerTaskStatus.SUCCESS || status === WorkerTaskStatus.FAILED) {
            this.persistTaskAuditLog(task, status, message).catch((err) => {
                this.logger.warn(`Erro ao gravar log de auditoria para tarefa ${taskId}: ${err.message}`);
            });

            // Keep task in memory for 15 minutes so frontend polling can read final result
            setTimeout(() => {
                this.pendingTasks.delete(taskId);
            }, 900000);
        }
        return { success: true };
    }

    private async persistTaskAuditLog(task: WorkerTask, status: WorkerTaskStatus, message?: string) {
        if (task.options?.isSharedDemoFeed) return;
        const acc = await this.findAccountByLoginOrId(task.login, task.accountId);
        if (!acc) return;

        if (
            (task.type === WorkerTaskType.STOP_ACCOUNT && status === WorkerTaskStatus.SUCCESS) ||
            (task.type === WorkerTaskType.START_ACCOUNT && status === WorkerTaskStatus.FAILED)
        ) {
            if (acc.isConnected) {
                acc.isConnected = false;
                await this.accountRepo.save(acc);
                try {
                    this.mt5Gateway.broadcastConnectionStatus(
                        { isConnected: false, accountId: acc.id, mt5Id: acc.mt5Id },
                        acc.userId,
                    );
                } catch { }
            }
        }

        // Create persistent ImportLog audit record for connection/sync attempts
        const isSyncTask =
            task.type === WorkerTaskType.START_ACCOUNT ||
            task.type === WorkerTaskType.SYNC_ACCOUNT ||
            task.type === WorkerTaskType.FORCE_FULL_SYNC;

        if (!isSyncTask) return;

        if (status === WorkerTaskStatus.SUCCESS) {
            let accChanged = false;
            if (!acc.isConnected) { acc.isConnected = true; accChanged = true; }
            if (acc.isArchived) { acc.isArchived = false; acc.archivedAt = null; accChanged = true; }
            if (!acc.name || acc.name === 'Conta Principal') { acc.name = `MT5 ${task.login}`; accChanged = true; }
            acc.lastSeen = new Date();
            if (accChanged) {
                await this.accountRepo.save(acc);
            }
        }

        const syncedTradesCount = Number(task.details?.syncedTradesCount || 0);

        if (status === WorkerTaskStatus.FAILED) {
            const failLog = this.importLogRepo.create({
                userId: acc.userId,
                accountId: acc.id,
                method: ImportMethod.AUTO_SYNC,
                status: ImportStatus.FAILED,
                tradesCount: 0,
                details: message || task.errorMessage || `Falha na conexão/autenticação com o servidor MT5 (${task.login}@${task.server || acc.broker})`,
            });
            await this.importLogRepo.save(failLog);
            this.auditLogger.warn(
                `[AUDIT-DB] Log de falha persistido (ImportLog #${failLog.id}) para conta ${task.login}: ${failLog.details}`
            );
        } else if (status === WorkerTaskStatus.SUCCESS && syncedTradesCount === 0) {
            // When syncedTradesCount > 0, Mt5Service.saveHistory already persisted an ImportLog record.
            // When syncedTradesCount === 0, we still record a SUCCESS connection/sync audit entry so the user has full auditability.
            const totalExistingTrades = await this.tradeRepo.count({ where: { accountId: acc.id } });
            const okLog = this.importLogRepo.create({
                userId: acc.userId,
                accountId: acc.id,
                method: ImportMethod.AUTO_SYNC,
                status: ImportStatus.SUCCESS,
                tradesCount: 0,
                details: message || `Conexão MT5 Cloud (${task.login}@${task.details?.server || task.server || acc.broker}) autenticada e sincronizada (${totalExistingTrades} trades no histórico)`,
            });
            await this.importLogRepo.save(okLog);
            this.auditLogger.log(
                `[AUDIT-DB] Log de sincronização sem novos negócios persistido (ImportLog #${okLog.id}) para conta ${task.login}`
            );
        }
    }

    exchangeCredential(taskId: string, accountId: number, credentialToken: string) {
        const now = Date.now();
        for (const [k, v] of this.credentialsStore.entries()) {
            if (now > v.expiresAt) {
                this.credentialsStore.delete(k);
            }
        }

        const cred = this.credentialsStore.get(credentialToken);
        if (!cred) {
            this.logger.warn(`Tentativa de resgate com token expirado ou inválido: ${credentialToken}`);
            throw new NotFoundException('Credential token invalid or expired');
        }

        if (
            (cred.taskId && cred.taskId !== taskId) ||
            (cred.accountId !== undefined && Number(cred.accountId) !== Number(accountId))
        ) {
            this.logger.warn(
                `Tentativa de resgate de credencial com divergência de tarefa/conta (tokenTask=${cred.taskId}, reqTask=${taskId}, tokenAcc=${cred.accountId}, reqAcc=${accountId})`,
            );
            throw new NotFoundException('Credential token mismatch or invalid');
        }

        // Single-use token: delete immediately from RAM after validation
        this.credentialsStore.delete(credentialToken);

        const decryptedPassword = cred.password?.includes(':')
            ? CryptoUtil.decrypt(cred.password, this.getCredentialEncryptionKey())
            : cred.password;

        const result = {
            login: cred.login,
            server: cred.server,
            password: decryptedPassword,
            expiresInSeconds: 60
        };

        return result;
    }

    // ==========================================
    // 3. SYNCHRONIZATION DATA PROCESSING
    // ==========================================
    async syncAccountMetrics(accountInfo: {
        accountId: number;
        login: string;
        server: string;
        currency: string;
        balance: number;
        equity: number;
        margin: number;
        freeMargin: number;
        marginLevel?: number;
        leverage: number;
        profit?: number;
        credit?: number;
        company?: string;
        name?: string;
        tradeMode?: string;
        tradeAllowed?: boolean;
        tradeExpert?: boolean;
        pingMs?: number;
        terminalBuild?: number;
        connected?: boolean;
    }, reqWorkerId?: string) {
        const cleanLogin = (accountInfo.login || accountInfo.accountId || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountInfo.accountId, accountInfo.server);
        if (!account) {
            this.logger.warn(`Conta MT5 ${cleanLogin} não encontrada no banco de dados para sync de métricas.`);
            return { success: false, message: 'Account not found' };
        }

        if (reqWorkerId && account.assignedWorkerId && account.assignedWorkerId !== reqWorkerId) {
            this.logger.warn(
                `[FENCING] Sync rejeitado para conta ${cleanLogin}: worker=${reqWorkerId} obsoleto (dono atual=${account.assignedWorkerId}).`,
            );
            return { success: false, message: 'STALE_WORKER_LEASE', evict: true };
        }

        const balanceNum = Number(accountInfo.balance) || 0;
        const equityNum = Number(accountInfo.equity) || 0;

        account.balance = balanceNum;
        account.equity = equityNum;
        account.margin = Number(accountInfo.margin) || 0;
        account.marginFree = Number(accountInfo.freeMargin) || 0;
        account.marginLevel = Number(accountInfo.marginLevel) || 0;
        account.leverage = Number(accountInfo.leverage) || 1;
        if (reqWorkerId && !account.assignedWorkerId) {
            account.assignedWorkerId = reqWorkerId;
            if (cleanLogin) this.accountToWorkerCache.set(cleanLogin, reqWorkerId);
        }
        if (balanceNum > 0 || equityNum > 0) {
            account.zeroBalanceSince = null;
            account.inactivityWarnedAt = null;
            account.inactivityDisconnectAt = null;
            if (!account.mt5SyncTier || account.mt5SyncTier === 'COLD') {
                account.mt5SyncTier = 'HOT';
            }
        } else if (!account.zeroBalanceSince && account.type !== AccountType.CUSTOM) {
            const openPos = await this.positionRepo.count({ where: { accountId: account.id } }).catch(() => 0);
            if (openPos === 0) {
                account.zeroBalanceSince = new Date();
                account.mt5SyncTier = 'COLD';
            }
        }
        if (accountInfo.currency) account.currency = accountInfo.currency;
        if (Number(account.initialBalance) === 0 && balanceNum > 0) {
            const closedPnlRes = await this.tradeRepo
                .createQueryBuilder('t')
                .select('COALESCE(SUM(COALESCE(t.profit, 0) + COALESCE(t.commission, 0) + COALESCE(t.swap, 0)), 0)', 'closedPnl')
                .where('t.accountId = :accountId', { accountId: account.id })
                .andWhere('t.status = :status', { status: 'CLOSED' })
                .getRawOne();
            const closedPnl = Number(closedPnlRes?.closedPnl) || 0;
            const derivedInitial = Number((balanceNum - closedPnl).toFixed(2));
            account.initialBalance = derivedInitial > 0 ? derivedInitial : balanceNum;
        }
        if (accountInfo.server || accountInfo.company) {
            account.broker = accountInfo.server || accountInfo.company || account.broker;
        }
        if (accountInfo.tradeMode) {
            account.type = accountInfo.tradeMode.toUpperCase() === 'DEMO' ? AccountType.DEMO : AccountType.LIVE;
        }
        if (!account.name || account.name === 'Conta Principal') {
            account.name = `MT5 ${cleanLogin}`;
        }
        account.isArchived = false;
        account.archivedAt = null;
        account.isConnected = accountInfo.connected !== false;
        account.lastSeen = new Date();

        await this.accountRepo.save(account);

        // Store rich live telemetry in memory
        const existingTel = this.accountTelemetry.get(cleanLogin);
        this.accountTelemetry.set(cleanLogin, {
            ...(existingTel || {}),
            login: cleanLogin,
            server: accountInfo.server || existingTel?.server || account.broker,
            company: accountInfo.company || existingTel?.company || '',
            accountHolderName: accountInfo.name || existingTel?.accountHolderName || '',
            tradeMode: accountInfo.tradeMode || existingTel?.tradeMode || 'DEMO',
            tradeAllowed: accountInfo.tradeAllowed ?? true,
            tradeExpert: accountInfo.tradeExpert ?? true,
            credit: Number(accountInfo.credit) || 0,
            pingMs: Number(accountInfo.pingMs) || 0,
            terminalBuild: accountInfo.terminalBuild || existingTel?.terminalBuild,
            connected: account.isConnected,
            connectionState: account.isConnected ? 'CONNECTED' : 'DISCONNECTED',
            statusMessage: `Sincronizado com sucesso (${accountInfo.server || account.broker})`,
            lastError: null,
            lastSyncAt: new Date().toISOString(),
        });

        // Garante reconciliação completa (FORCE_FULL_SYNC -> last_deal_ticket=0) no primeiro sync após reinício do backend
        // para recuperar quaisquer trades fechados que tenham sido pulados anteriormente pelo watermark do worker.
        if (cleanLogin && !this.initialFullSyncDispatched.has(cleanLogin)) {
            this.initialFullSyncDispatched.add(cleanLogin);
            const activeForLogin = Array.from(this.pendingTasks.values()).some(
                t => t.login === cleanLogin && (t.status === WorkerTaskStatus.RECEIVED || t.status === WorkerTaskStatus.IN_PROGRESS)
            );
            if (!activeForLogin) {
                this.createAccountTask(
                    WorkerTaskType.FORCE_FULL_SYNC,
                    cleanLogin,
                    accountInfo.server || account.broker || '',
                    undefined,
                    accountInfo.accountId,
                    { priority: 2, accountUuid: account.id }
                );
                this.logger.log(`[AUTO-RECONCILE] Enfileirado FORCE_FULL_SYNC automático para recuperar todo o histórico da conta ${cleanLogin}.`);
            }
        }

        // Broadcast to connected frontend clients via WebSocket (strictly scoped to account.userId)
        try {
            if (account.userId) {
                this.mt5Gateway.broadcastAccountUpdate({
                    balance: account.balance,
                    equity: account.equity,
                    margin: account.margin,
                    marginFree: account.marginFree,
                    marginLevel: account.marginLevel
                }, account.userId);
                this.mt5Gateway.broadcastConnectionStatus({ isConnected: account.isConnected }, account.userId);
            }
        } catch (err) {
            // Ignore socket broadcast errors
        }

        return {
            success: true,
            accountId: account.id,
            mt5Id: account.mt5Id,
            balance: account.balance,
            equity: account.equity,
            isConnected: account.isConnected
        };
    }

    async syncPositions(accountIdNum: number, login: string, positions: any[], server?: string) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountIdNum, server);
        if (!account) {
            return { success: false, message: 'Account not found' };
        }

        await this.positionRepo.manager.transaction(async (manager) => {
            if (!positions || positions.length === 0) {
                await manager.delete(PositionEntity, { accountId: account.id });
                return;
            }

            const existingPositions = await manager.find(PositionEntity, {
                where: { accountId: account.id }
            });
            const existingMap = new Map<string, PositionEntity>();
            existingPositions.forEach(p => existingMap.set((p.ticket || '').toString(), p));

            const incomingTickets: string[] = [];
            const positionsToSave: PositionEntity[] = [];

            for (const p of positions) {
                const ticketStr = (p.ticket || '').toString();
                if (!ticketStr) continue;
                incomingTickets.push(ticketStr);

                let entity = existingMap.get(ticketStr);
                const parsedPosOpenTime = p.time ? new Date(p.time) : null;
                if (entity) {
                    entity.symbol = p.symbol || entity.symbol || 'Unknown';
                    entity.type = p.type || entity.type || 'BUY';
                    entity.volume = Number(p.volume) || 0;
                    entity.openPrice = Number(p.priceOpen ?? p.openPrice) || entity.openPrice || 0;
                    entity.currentPrice = Number(p.priceCurrent ?? p.currentPrice) || 0;
                    entity.profit = Number(p.profit) || 0;
                    entity.sl = Number(p.sl) > 0 ? Number(p.sl) : 0;
                    entity.tp = Number(p.tp) > 0 ? Number(p.tp) : 0;
                    if (parsedPosOpenTime && !isNaN(parsedPosOpenTime.getTime())) {
                        entity.openTime = parsedPosOpenTime;
                    }
                    positionsToSave.push(entity);
                } else {
                    positionsToSave.push(
                        this.positionRepo.create({
                            accountId: account.id,
                            ticket: ticketStr,
                            symbol: p.symbol || 'Unknown',
                            type: p.type || 'BUY',
                            volume: Number(p.volume) || 0,
                            openPrice: Number(p.priceOpen ?? p.openPrice) || 0,
                            currentPrice: Number(p.priceCurrent ?? p.currentPrice) || 0,
                            profit: Number(p.profit) || 0,
                            sl: Number(p.sl) > 0 ? Number(p.sl) : 0,
                            tp: Number(p.tp) > 0 ? Number(p.tp) : 0,
                            openTime: parsedPosOpenTime && !isNaN(parsedPosOpenTime.getTime()) ? parsedPosOpenTime : new Date()
                        })
                    );
                }
            }

            if (positionsToSave.length > 0) {
                await manager.save(PositionEntity, positionsToSave);
            }

            if (incomingTickets.length > 0) {
                await manager
                    .createQueryBuilder()
                    .delete()
                    .from(PositionEntity)
                    .where('account_id = :accountId', { accountId: account.id })
                    .andWhere('ticket NOT IN (:...tickets)', { tickets: incomingTickets })
                    .execute();
            } else {
                await manager.delete(PositionEntity, { accountId: account.id });
            }
        });

        const existingTel = this.accountTelemetry.get(cleanLogin);
        if (existingTel) {
            existingTel.openPositionsCount = positions ? positions.length : 0;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }

        return { success: true, count: positions ? positions.length : 0 };
    }

    async syncOrders(accountIdNum: number, login: string, orders: any[]) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const existingTel = this.accountTelemetry.get(cleanLogin);
        if (existingTel) {
            existingTel.orders = orders || [];
            existingTel.pendingOrdersCount = orders ? orders.length : 0;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }
        return { success: true, count: orders ? orders.length : 0 };
    }

    private isUsDstAtServerEpochMs(serverEpochMs: number): boolean {
        const dt = new Date(serverEpochMs);
        const m = dt.getUTCMonth() + 1; // 1..12
        if (m < 3 || m > 11) return false;
        if (m > 3 && m < 11) return true;
        const year = dt.getUTCFullYear();
        const day = dt.getUTCDate();
        const hour = dt.getUTCHours();
        if (m === 3) {
            const firstDow = new Date(Date.UTC(year, 2, 1)).getUTCDay(); // 0=Sun..6=Sat
            const firstSun = 1 + ((7 - firstDow) % 7);
            const secondSun = firstSun + 7;
            return day > secondSun || (day === secondSun && hour >= 2);
        }
        const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
        const firstSun = 1 + ((7 - firstDow) % 7);
        return day < firstSun || (day === firstSun && hour < 2);
    }

    /**
     * Se o Worker Python já enviou `serverTzOffsetSec` (mesmo `0` para Deriv/Exness), os horários
     * já chegam convertidos para UTC real. Caso um worker legado ainda não atualizado envie sem
     * `serverTzOffsetSec`, normalizamos o deslocamento do servidor MT5 (ex: GMT+2 inverno / GMT+3 verão US-DST).
     */
    private normalizeDealDateToUtc(
        rawDate: any,
        server?: string,
        workerProvidedOffsetSec?: number,
    ): Date | null {
        if (!rawDate) return null;
        const parsed = new Date(rawDate);
        if (isNaN(parsed.getTime())) return null;

        if (typeof workerProvidedOffsetSec === 'number' && Number.isFinite(workerProvidedOffsetSec)) {
            return parsed;
        }

        const srvLower = (server || '').trim().toLowerCase();
        if (!srvLower) return parsed;
        if (
            srvLower.includes('deriv') ||
            srvLower.includes('exness') ||
            srvLower.includes('binance') ||
            srvLower.includes('bybit')
        ) {
            return parsed;
        }

        const offsetSec = this.isUsDstAtServerEpochMs(parsed.getTime()) ? 10800 : 7200;
        return new Date(parsed.getTime() - offsetSec * 1000);
    }

    private computeCanonicalUtcSession(openDate: Date): string {
        if (!openDate || isNaN(openDate.getTime())) return 'Unknown';
        const h = openDate.getUTCHours();
        const sessions: string[] = [];
        if (h >= 22 || h < 7) sessions.push('Sydney');
        if (h >= 0 && h < 9) sessions.push('Tokyo');
        if (h >= 8 && h < 17) sessions.push('London');
        if (h >= 13 && h < 22) sessions.push('New York');
        return sessions.length > 0 ? sessions.join(' / ') : 'Off-Hours';
    }

    async syncTrades(
        accountIdNum: number,
        login: string,
        deals: any[],
        lastDealTicket?: number,
        server?: string,
        serverTzOffsetSec?: number,
    ) {
        const cleanLogin = (login || accountIdNum || '').toString().trim();
        const account = await this.findAccountByLoginOrId(cleanLogin, accountIdNum, server);
        if (!account) {
            this.logger.warn(`Conta ${cleanLogin} não encontrada para inserção de trades.`);
            return { success: false, message: 'Account not found' };
        }

        const effectiveServer = (server || account.broker || '').trim();
        const existingTel = this.accountTelemetry.get(cleanLogin);
        if (existingTel && lastDealTicket) {
            existingTel.lastDealTicket = lastDealTicket;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }

        if (!deals || deals.length === 0) {
            return { success: true, count: 0 };
        }

        const tradingDeals = deals.filter((d) => {
            const dealType = (d.type || '').toUpperCase();
            return !dealType.includes('BALANCE') && !dealType.includes('CREDIT');
        });

        if (tradingDeals.length === 0) {
            return { success: true, count: 0, lastTicket: lastDealTicket };
        }

        const normalizedTrades = tradingDeals.map((deal) => {
            const rawDealTicket = (deal.ticket || '').toString().trim();
            const positionId = (deal.positionId || deal.orderTicket || deal.ticket || '').toString().trim();
            // No MT5, o Ticket exibido na aba "Posições" e em "Histórico -> Posições" é o position_id (positionId).
            // O deal.ticket é apenas o ID interno do evento de saída (DEAL_ENTRY_OUT).
            // Usamos positionId como ticket principal para que o número do Ticket no Torex seja idêntico ao do MT5!
            const ticket = positionId || rawDealTicket;
            const dealTime =
                this.normalizeDealDateToUtc(deal.time, effectiveServer, serverTzOffsetSec) || new Date();
            const parsedOpenTime = this.normalizeDealDateToUtc(
                deal.openTime,
                effectiveServer,
                serverTzOffsetSec,
            );
            const hasValidOpenTime = Boolean(parsedOpenTime && !isNaN(parsedOpenTime.getTime()));
            const finalOpenTime = hasValidOpenTime ? parsedOpenTime! : dealTime;

            const isOut = (deal.entry || '').toUpperCase().includes('OUT');
            const profit = Number(deal.profit) || 0;
            const commission = Number(deal.commission) || 0;
            const swap = Number(deal.swap) || 0;
            const closePrice = Number(deal.price) || 0;
            const hasExplicitOpenPrice = deal.openPrice !== undefined && deal.openPrice !== null && Number(deal.openPrice) > 0;
            const openPrice = hasExplicitOpenPrice ? Number(deal.openPrice) : closePrice;

            return {
                ticket: ticket,
                dealTicket: rawDealTicket,
                positionId: positionId || ticket,
                contractId: positionId || ticket,
                symbol: deal.symbol || 'Unknown',
                type: (deal.type || '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL',
                volume: Number(deal.volume) || 0,
                openPrice: openPrice,
                closePrice: closePrice,
                profit: profit,
                commission: commission,
                swap: swap,
                netPnl: profit + commission + swap,
                sl: Number(deal.sl) > 0 ? Number(deal.sl) : null,
                tp: Number(deal.tp) > 0 ? Number(deal.tp) : null,
                openTime: finalOpenTime,
                closeTime: isOut || profit !== 0 ? dealTime : null,
                session: this.computeCanonicalUtcSession(finalOpenTime),
                status: isOut || profit !== 0 ? 'CLOSED' : 'OPEN',
                dataQuality: hasValidOpenTime && (!isOut || hasExplicitOpenPrice) ? 'ok' : 'partial',
                comment: deal.comment || '',
                magic: Number(deal.magic) || 0
            };
        });

        this.logger.log(`Salvando ${normalizedTrades.length} trades para conta ${account.mt5Id || account.name} via AUTO_SYNC`);
        let savedCount = 0;
        let updatedCount = 0;
        try {
            const result = await this.mt5Service.saveHistory(
                normalizedTrades,
                ImportMethod.AUTO_SYNC,
                account.userId,
                account.id
            );
            savedCount = result?.count || 0;
        } catch (saveErr) {
            this.logger.error(`[FALLBACK SQL] saveHistory falhou para conta ${cleanLogin}: ${saveErr.message}`, saveErr.stack);
            const fallbackLookupKeys = Array.from(
                new Set(
                    normalizedTrades
                        .flatMap((tr) => [tr.ticket, tr.contractId, tr.dealTicket])
                        .filter(Boolean)
                        .map(String)
                )
            );
            const existingFallbackRows: Array<{ ticket?: string; contractId?: string }> =
                fallbackLookupKeys.length > 0
                    ? await this.accountRepo.manager
                          .query(
                              `SELECT ticket, "contractId"
                               FROM trades
                               WHERE account_id = $1
                                 AND (ticket = ANY($2::text[]) OR "contractId" = ANY($2::text[]))`,
                              [account.id, fallbackLookupKeys]
                          )
                          .catch(() => [])
                    : [];
            const existingKeySet = new Set<string>();
            for (const row of existingFallbackRows) {
                if (row.ticket) existingKeySet.add(String(row.ticket));
                if (row.contractId) existingKeySet.add(String(row.contractId));
            }

            for (const tr of normalizedTrades) {
                try {
                    const checkKeys = [tr.ticket, tr.contractId, tr.dealTicket || tr.ticket]
                        .filter(Boolean)
                        .map(String);
                    if (checkKeys.some((k) => existingKeySet.has(k))) {
                        continue;
                    }
                    const rawMagic = Number(tr.magic) || 0;
                    const safeMagic = rawMagic >= -2147483648 && rawMagic <= 2147483647 ? Math.trunc(rawMagic) : 0;
                    await this.accountRepo.manager.query(
                        `INSERT INTO trades (
                            account_id, ticket, "contractId", symbol, type,
                            volume, open_price, close_price, profit, commission,
                            swap, "netPnl", sl, tp, open_time, close_time,
                            status, magic, comment
                        ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8, $9, $10,
                            $11, $12, $13, $14, $15, $16,
                            $17, $18, $19
                        )`,
                        [
                            account.id,
                            tr.ticket,
                            tr.contractId,
                            tr.symbol || 'Unknown',
                            tr.type || 'BUY',
                            Number(tr.volume || 0),
                            Number(tr.openPrice || 0),
                            Number(tr.closePrice || 0),
                            Number(tr.profit || 0),
                            Number(tr.commission || 0),
                            Number(tr.swap || 0),
                            Number(tr.netPnl || 0),
                            tr.sl ?? null,
                            tr.tp ?? null,
                            tr.openTime,
                            tr.closeTime ?? null,
                            tr.status || 'CLOSED',
                            safeMagic,
                            tr.comment || '',
                        ]
                    );
                    checkKeys.forEach((k) => existingKeySet.add(k));
                    savedCount++;
                } catch (innerErr) {
                    this.logger.warn(`[FALLBACK SQL] Falha ao inserir trade ${tr.ticket} na conta ${cleanLogin}: ${innerErr.message}`);
                }
            }
        }

        // Reconciliação autoritativa em lote (1 único SELECT indexado por account_id + ANY em vez de N queries com account_id::text)
        const reconcileKeys = Array.from(
            new Set(
                normalizedTrades
                    .flatMap((tr) => [tr.ticket, tr.contractId, tr.dealTicket || tr.ticket])
                    .filter(Boolean)
                    .map(String)
            )
        );
        const preloadedRows: any[] =
            reconcileKeys.length > 0
                ? await this.accountRepo.manager
                      .query(
                          `SELECT id, ticket, "contractId", profit, commission, swap, "netPnl", open_price, close_price, open_time, close_time, session
                           FROM trades
                           WHERE account_id = $1
                             AND (ticket = ANY($2::text[]) OR "contractId" = ANY($2::text[]))`,
                          [account.id, reconcileKeys]
                      )
                      .catch(() => [])
                : [];

        const existingByKey = new Map<string, any>();
        for (const row of preloadedRows) {
            if (row.ticket) existingByKey.set(String(row.ticket), row);
            if (row.contractId) existingByKey.set(String(row.contractId), row);
        }

        for (const tr of normalizedTrades) {
            try {
                const ex =
                    (tr.ticket && existingByKey.get(String(tr.ticket))) ||
                    (tr.contractId && existingByKey.get(String(tr.contractId))) ||
                    (tr.dealTicket && existingByKey.get(String(tr.dealTicket))) ||
                    null;
                if (ex) {
                    const dbOpenMs = ex.open_time ? new Date(ex.open_time).getTime() : 0;
                    const dbCloseMs = ex.close_time ? new Date(ex.close_time).getTime() : 0;
                    const newOpenMs = tr.openTime ? new Date(tr.openTime).getTime() : 0;
                    const newCloseMs = tr.closeTime ? new Date(tr.closeTime).getTime() : 0;

                    const needsUpdate =
                        String(ex.ticket) !== String(tr.ticket) ||
                        Math.abs(Number(ex.profit || 0) - Number(tr.profit || 0)) > 0.001 ||
                        Math.abs(Number(ex.commission || 0) - Number(tr.commission || 0)) > 0.001 ||
                        Math.abs(Number(ex.swap || 0) - Number(tr.swap || 0)) > 0.001 ||
                        Math.abs(Number(ex.netPnl || 0) - Number(tr.netPnl || 0)) > 0.001 ||
                        Math.abs(Number(ex.open_price || 0) - Number(tr.openPrice || 0)) > 0.00001 ||
                        Math.abs(Number(ex.close_price || 0) - Number(tr.closePrice || 0)) > 0.00001 ||
                        (newOpenMs > 0 && Math.abs(dbOpenMs - newOpenMs) > 1000) ||
                        (newCloseMs > 0 && Math.abs(dbCloseMs - newCloseMs) > 1000) ||
                        (tr.session && String(ex.session || '') !== String(tr.session));

                    if (needsUpdate) {
                        await this.accountRepo.manager.query(
                            `UPDATE trades
                             SET ticket = $1,
                                 "contractId" = $2,
                                 type = $3,
                                 volume = $4,
                                 open_price = $5,
                                 close_price = $6,
                                 profit = $7,
                                 commission = $8,
                                 swap = $9,
                                 "netPnl" = $10,
                                 open_time = $11,
                                 close_time = $12,
                                 status = $13,
                                 session = $14
                             WHERE id = $15`,
                            [
                                tr.ticket,
                                tr.contractId,
                                tr.type || 'BUY',
                                Number(tr.volume || 0),
                                Number(tr.openPrice || 0),
                                Number(tr.closePrice || 0),
                                Number(tr.profit || 0),
                                Number(tr.commission || 0),
                                Number(tr.swap || 0),
                                Number(tr.netPnl || 0),
                                tr.openTime,
                                tr.closeTime ?? tr.openTime,
                                tr.status || 'CLOSED',
                                tr.session || null,
                                ex.id,
                            ]
                        );
                        updatedCount++;
                    }
                }
            } catch (recErr) {
                this.logger.warn(`[RECONCILE] Falha ao atualizar trade ${tr.ticket} na conta ${cleanLogin}: ${recErr.message}`);
            }
        }

        if (updatedCount > 0) {
            this.logger.log(`[RECONCILE] ${updatedCount} trade(s) existente(s) na conta ${cleanLogin} foram reconciliados com valores/horários exatos do MT5.`);
            if (account.userId) {
                this.dashboardService.invalidateUserCache(account.userId).catch(() => {});
            }
        }

        if (existingTel) {
            existingTel.lastSyncedTradesCount = (existingTel.lastSyncedTradesCount || 0) + savedCount;
            this.accountTelemetry.set(cleanLogin, existingTel);
        }

        // Automatically pull historical 500-candle OHLCV batches ONLY when new trades were persisted
        // (avoids spawning redundant FETCH_MARKET_BATCHES terminal switches on startup reconciliation when savedCount === 0).
        if (savedCount > 0) {
            this.prefetchCandleBatchesForSyncedTrades(
                cleanLogin,
                server || account.broker || '',
                accountIdNum,
                normalizedTrades,
                account.id,
            ).catch((err) => {
                this.logger.debug(`Background OHLCV batch prefetch after trade sync: ${err.message}`);
            });
        }

        return { success: true, saved: savedCount, lastTicket: lastDealTicket };
    }

    /**
     * Automatically pulls 500-candle historical OHLCV batches whenever new trades are synchronized,
     * both from the MT5 terminal (via FETCH_MARKET_BATCHES task) and into the Redis batch cache.
     */
    private async prefetchCandleBatchesForSyncedTrades(
        login: string,
        server: string,
        accountIdNum: number,
        trades: Array<{ symbol: string; openTime?: Date | null; closeTime?: Date | null }>,
        accountUuid?: string,
    ) {
        if (!trades || trades.length === 0) return;

        // Preserva o casing exato do símbolo da corretora no MT5 (ex.: 'EURUSDm', 'NAS100.x'),
        // pois mt5.symbol_select / copy_rates são case-sensitive; deduplica ignorando caixa.
        const seenUpper = new Set<string>();
        const uniqueSymbols: string[] = [];
        for (const t of trades) {
            const exactSym = (t.symbol || '').trim();
            const upperKey = exactSym.toUpperCase();
            if (!exactSym || upperKey === 'UNKNOWN' || seenUpper.has(upperKey)) continue;
            seenUpper.add(upperKey);
            uniqueSymbols.push(exactSym);
            if (uniqueSymbols.length >= 6) break;
        }

        if (uniqueSymbols.length === 0) return;

        const timestamps: number[] = [];
        for (const t of trades) {
            if (t.openTime) {
                const ms = new Date(t.openTime).getTime();
                if (Number.isFinite(ms) && ms > 0) timestamps.push(ms);
            }
            if (t.closeTime) {
                const ms = new Date(t.closeTime).getTime();
                if (Number.isFinite(ms) && ms > 0) timestamps.push(ms);
            }
        }

        const minTs = timestamps.length > 0 ? Math.min(...timestamps) - 48 * 3600_000 : Date.now() - 14 * 86400_000;
        const maxTs = timestamps.length > 0 ? Math.min(Date.now(), Math.max(...timestamps) + 12 * 3600_000) : Date.now();

        // 1. Enqueue MT5 Worker task to extract native OHLCV batches (`copy_rates_range` / `copy_rates_from`)
        if (login) {
            this.createAccountTask(
                WorkerTaskType.FETCH_MARKET_BATCHES,
                login,
                server,
                undefined,
                accountIdNum,
                {
                    priority: 4,
                    accountUuid,
                    symbols: uniqueSymbols,
                    timeframes: ['15m', '5m', '1h'],
                    fromTs: minTs,
                    toTs: maxTs,
                    chunkSize: 500,
                },
            );
        }

        // 2. Also warm server Redis batch cache immediately so Backtesting & Replay have 500-candle batches ready
        if (this.tradingViewService) {
            for (const sym of uniqueSymbols) {
                for (const tf of ['15m', '5m', '1h']) {
                    try {
                        await this.tradingViewService.getCandlesBatch(sym, tf, {
                            chunkSize: 500,
                            chunkIndex: 0,
                            cursorTo: maxTs,
                            fromTs: minTs,
                            toTs: maxTs,
                        });
                    } catch (_) {}
                }
            }
        }
    }

    /**
     * Receives 500-candle OHLCV batches extracted directly from MetaTrader 5 by the Python Worker.
     */
    async syncCandlesBatch(body: {
        accountId?: number;
        login?: string;
        server?: string;
        batches: Array<{
            symbol: string;
            timeframe: string;
            candles: Array<{
                timestamp?: number;
                time?: number;
                open: number;
                high: number;
                low: number;
                close: number;
                volume?: number;
            }>;
        }>;
    }) {
        if (!this.tradingViewService || !Array.isArray(body?.batches)) {
            return { success: false, storedBatches: 0 };
        }
        let storedBatches = 0;
        let totalCandles = 0;
        for (const batch of body.batches) {
            if (!batch?.symbol || !Array.isArray(batch.candles) || batch.candles.length === 0) continue;
            const res = await this.tradingViewService.ingestMt5CandleBatch(
                batch.symbol,
                batch.timeframe || '15m',
                batch.candles,
            );
            if (res.stored > 0) {
                storedBatches++;
                totalCandles += batch.candles.length;
            }
        }
        this.logger.log(
            `[MT5-CANDLES-SYNC] Conta #${body.login || body.accountId || 'DEMO'} (${body.server || 'MT5'}): ${storedBatches} lotes históricos (${totalCandles} velas) sincronizados e salvos no cache.`,
        );
        return { success: true, storedBatches, totalCandles };
    }

    /**
     * Receives Economic Calendar events extracted from MetaTrader 5 (MQL5 CalendarValueHistory / Python Worker).
     */
    async syncEconomicCalendar(body: {
        login?: string;
        server?: string;
        events: Array<{
            externalId?: string;
            title: string;
            currency: string;
            country?: string;
            eventDate: string | number;
            impact?: string;
            category?: string;
            actual?: string | null;
            forecast?: string | null;
            previous?: string | null;
            unit?: string | null;
            description?: string | null;
        }>;
    }) {
        if (!this.economicCalendarService || !Array.isArray(body?.events)) {
            this.logger.warn('[MT5-CALENDAR-SYNC] Payload de eventos do calendário vazio ou serviço indisponível.');
            return { success: false, synced: 0 };
        }
        this.logger.log(
            `[MT5-CALENDAR-SYNC] Recebendo ${body.events.length} notícias do MT5 via conta #${body.login || 'DEMO_FEED'} (${body.server || 'MetaQuotes-Demo'})...`,
        );
        const res = await this.economicCalendarService.syncMt5CalendarEvents(
            body.events,
            body.server ? `MT5 (${body.server})` : 'MT5_CALENDAR',
        );
        this.logger.log(
            `[MT5-CALENDAR-SYNC] Processamento concluído (Conta #${body.login || 'DEMO_FEED'}): ${res.created} novas notícias criadas, ${res.updated} atualizadas (Total sincronizado: ${res.synced}).`,
        );
        return { success: true, ...res };
    }

    // ==========================================
    // 4. SHARED MT5 DEMO ACCOUNT FOR BACKTEST SESSIONS
    // ==========================================

    async getSharedDemoFeedAccount(userId?: string) {
        const envDemoLogin = (process.env.MT5_DEMO_FEED_LOGIN || '').trim();
        const envDemoPass = (process.env.MT5_DEMO_FEED_PASSWORD || '').trim();
        const envDemoServer = this.normalizeBrokerServer((process.env.MT5_DEMO_FEED_SERVER || 'MetaQuotes-Demo').trim());

        if (!this.sharedDemoFeedConfig && envDemoLogin) {
            this.sharedDemoFeedConfig = {
                login: envDemoLogin,
                password: envDemoPass || undefined,
                server: envDemoServer || 'MetaQuotes-Demo',
                updatedAt: new Date().toISOString(),
            };
        }

        const login = this.sharedDemoFeedConfig?.login || '';
        const server = this.sharedDemoFeedConfig?.server || 'MetaQuotes-Demo';
        const isOwner = Boolean(
            userId && this.sharedDemoFeedConfig?.userId && this.sharedDemoFeedConfig.userId === userId,
        );
        const tel = login ? this.accountTelemetry.get(login) : null;
        const workersList = this.getWorkerStatus() as WorkerNodeState[];
        const primaryWorker = Array.isArray(workersList) && workersList.length > 0 ? workersList[0] : null;

        return {
            configured: Boolean(login),
            ...(isOwner ? { login, accountUuid: this.sharedDemoFeedConfig?.accountUuid || null } : {}),
            server: server ? (tel?.server || server) : 'MetaQuotes-Demo',
            connected: Boolean(tel?.connected),
            connectionState: tel?.connectionState || (login ? 'CONNECTED' : 'DISCONNECTED'),
            statusMessage:
                tel?.statusMessage ||
                (login
                    ? `Feed Demo compartilhado (${tel?.server || server}) ativo para sessões de Backtest`
                    : 'Configure MT5_DEMO_FEED_LOGIN para ativar o feed Demo dedicado'),
            lastSyncAt: tel?.lastSyncAt || this.sharedDemoFeedConfig?.updatedAt || null,
            workerOnline: Boolean(primaryWorker?.isOnline),
        };
    }

    async saveSharedDemoFeedAccount(
        userId: string,
        dto: { login: string; pass?: string; server: string },
    ) {
        const cleanLogin = (dto.login || '').toString().trim();
        const cleanServer = this.normalizeBrokerServer((dto.server || 'MetaQuotes-Demo').toString().trim());

        let account = await this.accountRepo.findOne({
            where: { mt5Id: cleanLogin, userId },
        });

        if (!account) {
            const created = this.accountRepo.create({
                userId,
                mt5Id: cleanLogin,
                broker: cleanServer,
                name: `MT5 Demo Feed (${cleanLogin})`,
                type: AccountType.DEMO,
                currency: 'USD',
                isPrimary: false,
                isArchived: false,
                archivedAt: null,
                isConnected: false,
                initialBalance: 100000,
                balance: 100000,
                equity: 100000,
                appToken: randomUUID().replace(/-/g, '').toUpperCase(),
            });
            account = await this.accountRepo.save(created);
        } else {
            account.broker = cleanServer;
            account.type = AccountType.DEMO;
            account.isArchived = false;
            account = await this.accountRepo.save(account);
        }

        const envDemoLogin = (process.env.MT5_DEMO_FEED_LOGIN || '').trim();
        if (!envDemoLogin && (!this.sharedDemoFeedConfig || this.sharedDemoFeedConfig.userId === userId)) {
            this.sharedDemoFeedConfig = {
                login: cleanLogin,
                server: cleanServer,
                accountUuid: account.id,
                userId,
                updatedAt: new Date().toISOString(),
            };
        }

        const numId = this.deriveNumericAccountId(cleanLogin);
        const task = this.createAccountTask(
            dto.pass ? WorkerTaskType.START_ACCOUNT : WorkerTaskType.SYNC_ACCOUNT,
            cleanLogin,
            cleanServer,
            dto.pass,
            numId,
            {
                userId,
                accountUuid: account.id,
                isSharedDemoFeed: true,
                priority: 1,
            },
        );

        return {
            success: true,
            message: `Conta Demo MT5 #${cleanLogin} (${cleanServer}) salva para a sua conta!`,
            demoAccount: await this.getSharedDemoFeedAccount(userId),
            taskId: task.id,
        };
    }

    /**
     * Called when a user creates or opens a Backtest Session:
     * Logs into the saved Shared MT5 Demo Account (if configured) and pulls 500-candle historical
     * batches for the session's symbols, timeframe, and date window.
     */
    async prefetchSessionWithDemoAccount(
        userId: string,
        dto: {
            sessionId?: string;
            symbols: string[];
            timeframe: string;
            fromDate?: string;
            toDate?: string;
            demoLogin?: string;
            demoPass?: string;
            demoServer?: string;
        },
    ) {
        const demoStatus = await this.getSharedDemoFeedAccount(userId);
        const feedLogin = this.sharedDemoFeedConfig?.login || '';
        const feedServer = this.sharedDemoFeedConfig?.server || 'MetaQuotes-Demo';
        const feedUuid = this.sharedDemoFeedConfig?.accountUuid;
        const envDemoPass = (process.env.MT5_DEMO_FEED_PASSWORD || '').trim();
        const effectivePass = this.sharedDemoFeedConfig?.password || envDemoPass || undefined;
        const symbols = Array.from(
            new Set((dto.symbols || ['XAUUSD']).map((s) => s.trim().toUpperCase()).filter(Boolean)),
        ).slice(0, 8);
        const tf = dto.timeframe || '5m';
        const multiTimeframes = Array.from(new Set([tf, '1m', '5m', '15m', '1h', '4h', '1D']));
        const fromTs = dto.fromDate ? new Date(dto.fromDate).getTime() : Date.now() - 15 * 86400_000;
        const toTs = dto.toDate
            ? Math.min(Date.now(), new Date(dto.toDate).getTime() + 86400_000)
            : Date.now();

        let workerTaskId: string | null = null;
        if (feedLogin) {
            const numId = this.deriveNumericAccountId(feedLogin);
            this.logger.log(
                `[MT5-DEMO-SESSION-PREFETCH] Sessão ${dto.sessionId || 'NOVA'}: Solicitando lotes para [${symbols.join(', ')}] nos timeframes [${multiTimeframes.join(', ')}]...`,
            );
            // Ensure the global demo account is logged in on the MT5 Worker and pulls multi-timeframe batches
            if (effectivePass && demoStatus.connectionState !== 'CONNECTED') {
                this.createAccountTask(
                    WorkerTaskType.START_ACCOUNT,
                    feedLogin,
                    feedServer,
                    effectivePass,
                    numId,
                    {
                        priority: 1,
                        accountUuid: feedUuid,
                        isSharedDemoFeed: true,
                    },
                );
            }
            const task = this.createAccountTask(
                WorkerTaskType.FETCH_MARKET_BATCHES,
                feedLogin,
                feedServer,
                effectivePass,
                numId,
                {
                    priority: 1,
                    accountUuid: feedUuid,
                    sessionId: dto.sessionId,
                    isSharedDemoFeed: true,
                    symbols,
                    timeframes: multiTimeframes,
                    fromTs,
                    toTs,
                    chunkSize: 500,
                },
            );
            workerTaskId = task.id;
        }

        const tvService = this.tradingViewService;
        if (tvService) {
            const warmupTfs = Array.from(new Set([dto.timeframe || '15m', '1h', '4h']));
            const pairs: Array<{ sym: string; tf: string }> = [];
            for (const sym of symbols.slice(0, 3)) {
                for (const tf of warmupTfs) {
                    pairs.push({ sym, tf });
                }
            }
            setImmediate(() => {
                void (async () => {
                    const concurrency = 3;
                    for (let i = 0; i < pairs.length; i += concurrency) {
                        const chunk = pairs.slice(i, i + concurrency);
                        await Promise.allSettled(
                            chunk.map(({ sym, tf }) =>
                                tvService.getCandlesBatch(sym, tf, {
                                    chunkSize: 500,
                                    chunkIndex: 0,
                                    cursorTo: toTs,
                                    fromTs,
                                    toTs,
                                })
                            )
                        );
                    }
                })().catch((err) => {
                    this.logger.debug(`[MT5-DEMO-PREFETCH] Background warmup finished with warning: ${err?.message}`);
                });
            });
        }

        return {
            success: true,
            queued: true,
            demoAccount: demoStatus,
            workerTaskId,
            prefetchedBatches: [],
        };
    }

    async triggerMt5CalendarSync(userId?: string) {
        const demoStatus = await this.getSharedDemoFeedAccount(userId);
        const envDemoLogin = (process.env.MT5_DEMO_FEED_LOGIN || '').trim();
        const envDemoPass = (process.env.MT5_DEMO_FEED_PASSWORD || '').trim();
        const envDemoServer = this.normalizeBrokerServer((process.env.MT5_DEMO_FEED_SERVER || 'MetaQuotes-Demo').trim());

        const targetLogin = (demoStatus.login || envDemoLogin || '').trim();
        if (!targetLogin) {
            this.logger.warn('[MT5-CALENDAR] Sincronização ignorada: nenhuma conta MT5/Demo Feed configurada.');
            return {
                success: false,
                skipped: true,
                demoAccount: demoStatus,
                pollIntervalMinutes: 10,
                message: 'Nenhuma conta MT5/Demo Feed configurada ou ativa para sincronizar o Calendário Econômico.',
            };
        }

        const targetServer = demoStatus.server || envDemoServer || 'MetaQuotes-Demo';
        const effectivePass = this.sharedDemoFeedConfig?.password || envDemoPass || undefined;
        const numId = this.deriveNumericAccountId(targetLogin);

        // Evita duplicar tarefas SYNC_CALENDAR pendentes na fila
        const existingPending = Array.from(this.pendingTasks.values()).find(
            (t) =>
                t.type === WorkerTaskType.SYNC_CALENDAR &&
                (t.status === WorkerTaskStatus.RECEIVED || t.status === WorkerTaskStatus.IN_PROGRESS),
        );
        if (existingPending) {
            return {
                success: true,
                taskId: existingPending.id,
                demoAccount: demoStatus,
                pollIntervalMinutes: 10,
                message: `Sincronização do Calendário Econômico MT5 já em andamento via conta Demo #${targetLogin} (${targetServer}).`,
            };
        }

        const task = this.createAccountTask(
            WorkerTaskType.SYNC_CALENDAR,
            targetLogin,
            targetServer,
            effectivePass,
            numId,
            {
                priority: 2,
                userId,
                isSharedDemoFeed: true,
                pollIntervalMinutes: 10,
                daysBack: 7,
                daysAhead: 14,
            },
        );

        this.logger.log(
            `[MT5-CALENDAR-10MIN] Consulta de novas notícias do Calendário Econômico enfileirada via Conta Demo #${targetLogin} (${targetServer}).`,
        );

        return {
            success: true,
            taskId: task.id,
            demoAccount: demoStatus,
            pollIntervalMinutes: 10,
            message: `Sincronização do Calendário Econômico MT5 (ciclo 10 min) solicitada via conta Demo #${targetLogin} (${targetServer}).`,
        };
    }

    async recordWorkerEvent(event: {
        workerId: string;
        accountId?: number;
        login?: string;
        server?: string;
        eventType: string;
        severity: string;
        message: string;
        metadata?: Record<string, any>;
        timestamp?: string;
    }) {
        const cleanLogin = (event.login || event.accountId || '').toString().trim();
        const record: WorkerEventRecord = {
            id: randomUUID(),
            workerId: event.workerId,
            accountId: event.accountId,
            login: cleanLogin || undefined,
            server: event.server,
            eventType: event.eventType,
            severity: event.severity || 'INFO',
            message: event.message,
            metadata: event.metadata || {},
            timestamp: event.timestamp || new Date().toISOString(),
        };

        this.recentEvents.unshift(record);
        if (this.recentEvents.length > 100) {
            this.recentEvents.length = 100;
        }

        if (cleanLogin) {
            const existingTel = this.accountTelemetry.get(cleanLogin) || {
                login: cleanLogin,
                server: event.server || '',
                connected: false,
                connectionState: 'DISCONNECTED' as const,
            };

            if (event.eventType === 'ACCOUNT_CONNECTING') {
                existingTel.connectionState = 'CONNECTING';
                existingTel.statusMessage = event.message;
                existingTel.lastError = null;
            } else if (event.eventType === 'ACCOUNT_CONNECTED') {
                existingTel.connected = true;
                existingTel.connectionState = 'CONNECTED';
                existingTel.statusMessage = event.message;
                existingTel.lastError = null;
                existingTel.lastSyncAt = new Date().toISOString();
            } else if (event.eventType === 'ACCOUNT_LOGIN_FAILED') {
                existingTel.connected = false;
                existingTel.connectionState = 'AUTH_FAILED';
                existingTel.lastError = event.message;
                existingTel.statusMessage = event.message;
            } else if (event.eventType === 'ACCOUNT_DISCONNECTED' || event.eventType === 'ACCOUNT_STOPPED') {
                existingTel.connected = false;
                existingTel.connectionState = 'DISCONNECTED';
                existingTel.statusMessage = event.message;
                if (event.eventType === 'ACCOUNT_DISCONNECTED') {
                    existingTel.lastError = event.message;
                }
            }
            this.accountTelemetry.set(cleanLogin, existingTel);

            if (
                event.eventType === 'ACCOUNT_LOGIN_FAILED' ||
                event.eventType === 'ACCOUNT_DISCONNECTED' ||
                event.eventType === 'ACCOUNT_STOPPED'
            ) {
                const isSharedFeedAccount =
                    this.sharedDemoFeedConfig?.login === cleanLogin &&
                    !this.loginToUserMap.has(cleanLogin);
                if (!isSharedFeedAccount) {
                    const acc = await this.findAccountByLoginOrId(cleanLogin, event.accountId);
                    if (acc) {
                        if (acc.isConnected) {
                            acc.isConnected = false;
                            await this.accountRepo.save(acc);
                            try {
                                this.mt5Gateway.broadcastConnectionStatus(
                                    { isConnected: false, accountId: acc.id, mt5Id: acc.mt5Id },
                                    acc.userId,
                                );
                            } catch {}
                        }

                        // Notify user via Redis email queue ONLY on permanent credential rejection (12h cooldown)
                        if (
                            event.eventType === 'ACCOUNT_LOGIN_FAILED' &&
                            acc.userId &&
                            acc.notificationsEnabled !== false
                        ) {
                            const authCooldownKey = `mt5:auth_fail_notified:${acc.id}`;
                            const alreadySent = await this.cacheManager
                                .get(authCooldownKey)
                                .catch(() => null);
                            if (!alreadySent) {
                                const user = await this.accountRepo.manager
                                    .getRepository(UserEntity)
                                    .findOne({ where: { id: acc.userId } });
                                if (user?.email) {
                                    await this.cacheManager
                                        .set(authCooldownKey, '1', 12 * 60 * 60 * 1000)
                                        .catch(() => {});
                                    await this.emailProducer.enqueue(user.email, 'MT5_STATUS', {
                                        userName: user.name || undefined,
                                        mt5Id: acc.mt5Id || cleanLogin,
                                        server: event.server || acc.broker,
                                        status: 'AUTH_FAILED',
                                        reason: event.message,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        this.auditLogger.log(`Evento Worker [${event.workerId}] (${event.eventType} - ${cleanLogin || 'GLOBAL'}): ${event.message}`);
        return { success: true };
    }

    private isValidUuid(id?: string): boolean {
        return !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    }

    async getCloudConnectionStatus(userId: string, accountId?: string, login?: string) {
        const workersList = this.getWorkerStatus() as WorkerNodeState[];
        const primaryWorker = Array.isArray(workersList) && workersList.length > 0 ? workersList[0] : null;

        // 1. Carrega todas as contas não arquivadas do usuário em 1 única query e resolve em memória (M7)
        const userAccounts = await this.accountRepo.find({
            where: { userId, isArchived: false },
            order: { updatedAt: 'DESC' }
        });

        let account: AccountEntity | null = null;
        if (login && login.trim()) {
            const cleanLogin = login.trim();
            account = userAccounts.find(a => a.mt5Id === cleanLogin) || null;
        }
        if (!account && this.isValidUuid(accountId)) {
            const byId = userAccounts.find(a => a.id === accountId!.trim()) || null;
            if (byId && byId.mt5Id) {
                account = byId;
            } else if (byId) {
                account = userAccounts.find(a => !!a.mt5Id && a.isConnected)
                    || userAccounts.find(a => !!a.mt5Id)
                    || byId;
            }
        }
        if (!account) {
            account = userAccounts.find(a => !!a.mt5Id && a.isConnected)
                || userAccounts.find(a => !!a.mt5Id)
                || userAccounts[0]
                || null;
        }

        const mt5Accounts = userAccounts
            .filter(a => !!a.mt5Id)
            .map(a => {
                const tel = a.mt5Id ? this.accountTelemetry.get(a.mt5Id) : null;
                return {
                    id: a.id,
                    name: a.name,
                    mt5Id: a.mt5Id,
                    broker: tel?.server || a.broker,
                    type: a.type,
                    currency: a.currency,
                    balance: Number(a.balance) || 0,
                    equity: Number(a.equity) || 0,
                    isConnected: a.isConnected || tel?.connectionState === 'CONNECTED',
                    connectionState: tel?.connectionState || (a.isConnected ? 'CONNECTED' : 'DISCONNECTED'),
                    lastSeen: a.lastSeen,
                };
            });

        // Usa estritamente o mt5Id da própria conta encontrada para evitar misturar telemetria/eventos de logins diferentes
        const mt5Login = account?.mt5Id || (login && !account ? login.trim() : '');
        const telemetry = mt5Login ? this.accountTelemetry.get(mt5Login) || null : null;
        const rawActiveTask = mt5Login ? this.getLatestTaskForLogin(mt5Login) : null;
        const activeTask = rawActiveTask ? (() => {
            const { credentialToken, targetWorkerId: _w, leaseEpoch: _e, ...safeTask } = rawActiveTask;
            return {
                ...safeTask,
                message: safeTask.message ? humanizeClientSyncMessage(safeTask.message) : safeTask.message,
                errorMessage: safeTask.errorMessage ? humanizeClientSyncMessage(safeTask.errorMessage) : safeTask.errorMessage,
            };
        })() : null;

        const [positions, totalTradesCount, recentTrades, auditLogs] = account
            ? await Promise.all([
                this.positionRepo.find({ where: { accountId: account.id } }),
                this.tradeRepo.count({ where: { accountId: account.id } }),
                this.tradeRepo.find({
                    where: { accountId: account.id },
                    order: { closeTime: 'DESC', openTime: 'DESC' },
                    take: 15,
                }),
                this.importLogRepo.find({
                    where: { accountId: account.id },
                    order: { createdAt: 'DESC' },
                    take: 10,
                }),
            ])
            : [[], 0, [], []];

        const rawAccountEvents = mt5Login
            ? this.recentEvents.filter(e => e.login === mt5Login || (e.accountId && e.accountId.toString() === mt5Login)).slice(0, 12)
            : this.recentEvents.slice(0, 6);
        const accountEvents = rawAccountEvents.map((ev) => ({
            ...ev,
            message: humanizeClientSyncMessage(ev.message),
        }));

        return {
            worker: {
                isOnline: primaryWorker ? primaryWorker.isOnline : false,
                workerId: primaryWorker?.workerId || null,
                cpuPercent: primaryWorker?.cpuPercent ?? 0,
                memoryPercent: primaryWorker?.memoryPercent ?? 0,
                memoryUsedMb: primaryWorker?.memoryUsedMb ?? null,
                memoryTotalMb: primaryWorker?.memoryTotalMb ?? null,
                activeTerminals: primaryWorker?.activeTerminals ?? 0,
                monitoredAccounts: primaryWorker?.monitoredAccounts || [],
                lastHeartbeat: primaryWorker?.lastHeartbeat || null,
            },
            account: account ? {
                id: account.id,
                name: account.name,
                mt5Id: account.mt5Id,
                broker: account.broker,
                type: account.type,
                currency: account.currency,
                balance: Number(account.balance) || 0,
                equity: Number(account.equity) || 0,
                margin: Number(account.margin) || 0,
                marginFree: Number(account.marginFree) || 0,
                marginLevel: Number(account.marginLevel) || 0,
                leverage: account.leverage || 1,
                isConnected: account.isConnected,
                lastSeen: account.lastSeen,
                zeroBalanceSince: account.zeroBalanceSince || null,
                inactivityDisconnectAt: account.inactivityDisconnectAt || null,
                // Live telemetry from MT5 Worker
                server: telemetry?.server || account.broker,
                company: telemetry?.company || null,
                accountHolderName: telemetry?.accountHolderName || null,
                tradeMode: telemetry?.tradeMode || (account.type === AccountType.DEMO ? 'DEMO' : 'REAL'),
                tradeAllowed: telemetry?.tradeAllowed ?? true,
                pingMs: telemetry?.pingMs ?? 0,
                terminalBuild: telemetry?.terminalBuild ?? null,
                connectionState: telemetry?.connectionState || (account.isConnected ? 'CONNECTED' : 'DISCONNECTED'),
                statusMessage: telemetry?.statusMessage ? humanizeClientSyncMessage(telemetry.statusMessage) : null,
                lastError: telemetry?.lastError ? humanizeClientSyncMessage(telemetry.lastError) : null,
                lastSyncAt: telemetry?.lastSyncAt || (account.lastSeen ? account.lastSeen.toISOString() : null),
                openPositionsCount: positions.length,
                pendingOrdersCount: telemetry?.pendingOrdersCount ?? 0,
                lastDealTicket: telemetry?.lastDealTicket ?? 0,
                lastSyncedTradesCount: telemetry?.lastSyncedTradesCount ?? 0,
                totalTradesCount,
            } : null,
            positions,
            orders: telemetry?.orders || [],
            recentTrades,
            totalTradesCount,
            auditLogs,
            activeTask,
            recentEvents: accountEvents,
            mt5Accounts,
        };
    }

    private async findAccountByLoginOrId(login: string, accountIdNum?: number, fallbackServer?: string): Promise<AccountEntity | null> {
        const loginStr = (login || accountIdNum || '').toString().trim();
        if (!loginStr) return null;

        const mappedOwner = this.loginToUserMap.get(loginStr);

        // 1. Se houver accountUuid mapeado da tarefa, valida estritamente id + mt5Id + userId (sem nunca alterar userId!)
        if (mappedOwner?.accountUuid && this.isValidUuid(mappedOwner.accountUuid)) {
            const whereByUuid: any = { id: mappedOwner.accountUuid, mt5Id: loginStr };
            if (mappedOwner.userId) whereByUuid.userId = mappedOwner.userId;
            const byUuid = await this.accountRepo.findOne({ where: whereByUuid });
            if (byUuid) {
                let changed = false;
                if (!byUuid.name || byUuid.name === 'Conta Principal') { byUuid.name = `MT5 ${loginStr}`; changed = true; }
                if (byUuid.isArchived) { byUuid.isArchived = false; byUuid.archivedAt = null; changed = true; }
                if (changed) await this.accountRepo.save(byUuid);
                return byUuid;
            }
        }

        // 2. Busca por (mt5Id, userId) se o usuário estiver mapeado na tarefa ativa
        let account: AccountEntity | null = null;
        if (mappedOwner?.userId) {
            account = await this.accountRepo.findOne({
                where: { mt5Id: loginStr, userId: mappedOwner.userId }
            });
            if (!account) {
                return null;
            }
        }

        // 3. Busca por (mt5Id, broker) quando o servidor da corretora foi informado
        if (!account && fallbackServer) {
            const matchesByServer = await this.accountRepo.find({
                where: { mt5Id: loginStr, broker: fallbackServer }
            });
            if (matchesByServer.length === 1) {
                account = matchesByServer[0];
            }
        }

        // 4. Busca por mt5Id apenas se for único no banco (sem ambiguidade entre tenants)
        if (!account) {
            const matchesByLogin = await this.accountRepo.find({
                where: { mt5Id: loginStr }
            });
            if (matchesByLogin.length === 1) {
                account = matchesByLogin[0];
            } else if (matchesByLogin.length > 1) {
                this.logger.warn(
                    `[ISOLAMENTO MULTI-TENANT] Múltiplas contas encontradas para mt5Id=${loginStr} sem escopo de tarefa/servidor. Ignorando sync ambíguo.`
                );
                return null;
            }
        }

        // 5. Se loginStr for um UUID válido da própria conta
        if (!account && this.isValidUuid(loginStr)) {
            account = await this.accountRepo.findOne({
                where: { id: loginStr }
            });
        }

        if (account) {
            let changed = false;
            if (account.isArchived) {
                account.isArchived = false;
                account.archivedAt = null;
                changed = true;
            }
            if (!account.name || account.name === 'Conta Principal') {
                account.name = `MT5 ${loginStr}`;
                changed = true;
            }
            if (changed) {
                account = await this.accountRepo.save(account);
            }
        }

        return account;
    }

    /**
     * Retorna apenas telemetria técnica anonimizada de uma conta MT5 para o painel Admin,
     * sem expor login completo, nome do titular, saldo, equity ou caminhos locais.
     */
    public getAnonymizedAccountTelemetry(login: string, fallbackConnected = false) {
        const cleanLogin = String(login || '').trim();
        const tel = cleanLogin ? this.accountTelemetry.get(cleanLogin) : undefined;
        const connectionState: AccountLiveTelemetry['connectionState'] =
            tel?.connectionState || (fallbackConnected ? 'CONNECTED' : 'DISCONNECTED');

        const rawFeedback = tel?.lastError || tel?.statusMessage || null;
        const sanitizedFeedback = rawFeedback
            ? String(rawFeedback)
                  .replace(/[A-Za-z]:\\[^\s'"]+|\/(?:home|root|var|tmp|Users)\/[^\s'"]+/g, '[path]')
                  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
                  .replace(/\b\d{5,12}\b/g, '••••')
                  .slice(0, 180)
            : null;

        return {
            connectionState,
            connected: tel ? Boolean(tel.connected) : Boolean(fallbackConnected),
            lastSyncAt: tel?.lastSyncAt || null,
            pingMs: typeof tel?.pingMs === 'number' ? tel.pingMs : null,
            terminalBuild: typeof tel?.terminalBuild === 'number' ? tel.terminalBuild : null,
            openPositionsCount: typeof tel?.openPositionsCount === 'number' ? tel.openPositionsCount : null,
            pendingOrdersCount: typeof tel?.pendingOrdersCount === 'number' ? tel.pendingOrdersCount : null,
            feedback: sanitizedFeedback,
        };
    }
}
