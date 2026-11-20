import { Test, TestingModule } from '@nestjs/testing';
import { DerivService } from './deriv.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DerivAuthEntity } from './entities/deriv-auth.entity';
import { DerivTransactionEntity } from './entities/deriv-transaction.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { ConfigService } from '@nestjs/config';
import { Mt5Service } from '../mt5/mt5.service';
import { NormalizationService } from '../import/normalization/normalization.service';
import { DerivAdapter } from '../import/normalization/adapters/deriv.adapter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

describe('DerivService (Unit Tests)', () => {
    let service: DerivService;
    const derivAdapter = new DerivAdapter();

    const mockRepo = {
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
    };

    const mockMt5Service = {
        safeDate: jest.fn((d) => (d ? new Date(typeof d === 'number' ? d * 1000 : d) : null)),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DerivService,
                { provide: getRepositoryToken(DerivAuthEntity), useValue: mockRepo },
                { provide: getRepositoryToken(DerivTransactionEntity), useValue: mockRepo },
                { provide: getRepositoryToken(TradeEntity), useValue: mockRepo },
                { provide: getRepositoryToken(AccountEntity), useValue: mockRepo },
                { provide: ConfigService, useValue: { get: jest.fn() } },
                { provide: Mt5Service, useValue: mockMt5Service },
                NormalizationService,
                { provide: DataSource, useValue: {} },
                { provide: EventEmitter2, useValue: { emit: jest.fn() } },
            ],
        }).compile();

        service = module.get<DerivService>(DerivService);
    });

    describe('DerivAdapter extractSymbol', () => {
        it('should extract R_100 from CALL_R_100_10_... shortcode', () => {
            const t = { shortcode: 'CALL_R_100_10_1740763200_1740763260_S0P_0' };
            expect(derivAdapter['extractSymbol'](t)).toBe('Volatility 100 Index');
        });

        it('should extract EURUSD from MULT_FRXEURUSD_10_... shortcode', () => {
            const t = { shortcode: 'MULT_FRXEURUSD_10_1740763200' };
            expect(derivAdapter['extractSymbol'](t)).toBe('EURUSD');
        });

        it('should use underlying if present', () => {
            const t = { underlying: 'r_50' };
            expect(derivAdapter['extractSymbol'](t)).toBe('Volatility 50 Index');
        });

        it('should use shortcode from transaction if contract details lacks it', () => {
            const rawTx = { shortcode: 'CALL_R_10_100_0' };
            expect(derivAdapter['extractSymbol'](rawTx)).toBe('Volatility 10 Index');
        });

        it('should handle display_name as fallback', () => {
            const t = { display_name: 'Volatility 100 Index' };
            expect(derivAdapter['extractSymbol'](t)).toBe('Volatility 100 Index');
        });
    });

    describe('Process Deduplication', () => {
        it('should deduplicate multiple fast calls to processTradeSync', () => {
            service['accountIds'].set('user1:VRTC1001', 'acc1');
            service['clients'].set('user1:VRTC1001', { request: jest.fn() } as any);

            const queueSpy = jest.spyOn(service as any, 'processEnrichmentQueue').mockImplementation(async () => {});

            service['processTradeSync']('user1', 'VRTC1001', '12345');
            expect(service['pendingEnrichmentSet'].has('acc1:12345')).toBe(true);
            expect(service['enrichmentQueue'].length).toBe(1);

            service['processTradeSync']('user1', 'VRTC1001', '12345');
            expect(service['enrichmentQueue'].length).toBe(1);
            expect(queueSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('PnL Consolidation Logic', () => {
        it('should calculate PnL using contract profit if available', async () => {
            const txDate = new Date('2026-11-10T10:00:00Z');
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -10, transactionId: 'buy_1', transactionTime: txDate, raw: { barrier: '1.2345' } },
                { action: 'sell', amount: 15, transactionId: 'sell_2', transactionTime: txDate, raw: { barrier: '1.2350' } },
            ]);
            mockRepo.findOne.mockResolvedValue({ id: 'acc1', currency: 'USD' });

            const contractDetails = {
                profit: 5,
                status: 'closed',
                buy_price: 10,
                payout: 15,
                entry_spot: 1.2345,
                exit_spot: 1.235,
                underlying: 'EURUSD',
                purchase_time: Math.floor(txDate.getTime() / 1000),
                sell_time: Math.floor(txDate.getTime() / 1000),
            };

            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.profit).toBe(5);
            expect(savedData.ticket).toBe('12345');
            expect(savedData.status).toBe('CLOSED');
            expect(savedData.qualityFlags.missing_close_time).toBeUndefined();
        });

        it('should flag missing_close_time when closed contract lacks sell_time and fallback sell tx', async () => {
            const txDate = new Date('2026-11-10T10:00:00Z');
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -10, transactionId: 'buy_1', transactionTime: txDate },
            ]);
            mockRepo.findOne.mockResolvedValue({ id: 'acc1' });

            const contractDetails = {
                profit: -5,
                is_sold: 1,
                status: 'closed',
                underlying: 'EURUSD',
                purchase_time: Math.floor(txDate.getTime() / 1000),
            };

            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.qualityFlags.missing_close_time).toBe(true);
            expect(savedData.dataQuality).toBe('partial');
        });

        it('should consolidate OPEN trade correctly and estimate bid profit when missing_sell', async () => {
            const txDate = new Date('2026-11-10T10:00:00Z');
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -10, transactionId: 'buy_1', transactionTime: txDate },
            ]);
            mockRepo.findOne.mockResolvedValue({ id: 'acc1' });

            const contractDetails = {
                status: 'open',
                is_sold: 0,
                bid_price: 12,
                underlying: 'EURUSD',
                purchase_time: Math.floor(txDate.getTime() / 1000),
            };

            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.status).toBe('OPEN');
            expect(savedData.profit).toBe(2);
        });

        it('should map entry/exit spot prices separately from stake volume', async () => {
            const txDate = new Date('2026-11-10T10:00:00Z');
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -100, transactionId: 'txn_1', transactionTime: txDate },
                { action: 'sell', amount: 150, transactionId: 'txn_2', transactionTime: txDate },
            ]);
            mockRepo.findOne.mockResolvedValue({ id: 'acc1', currency: 'USD' });

            const contractDetails = {
                buy_price: 100,
                sell_price: 150,
                entry_spot: 1.1234,
                exit_spot: 1.125,
                status: 'closed',
                is_sold: 1,
                profit: 50,
                underlying: 'EURUSD',
                purchase_time: Math.floor(txDate.getTime() / 1000),
                sell_time: Math.floor(txDate.getTime() / 1000),
            };

            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.volume).toBe(100);
            expect(savedData.openPrice).toBe(1.1234);
            expect(savedData.closePrice).toBe(1.125);
            expect(savedData.profit).toBe(50);
        });
    });
});
