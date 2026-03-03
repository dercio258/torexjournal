import { Test, TestingModule } from '@nestjs/testing';
import { DerivService } from './deriv.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DerivAuthEntity } from './entities/deriv-auth.entity';
import { DerivTransactionEntity } from './entities/deriv-transaction.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { ConfigService } from '@nestjs/config';
import { Mt5Service } from '../mt5/mt5.service';
import { DataSource } from 'typeorm';

describe('DerivService (Unit Tests)', () => {
    let service: DerivService;

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
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DerivService,
                { provide: getRepositoryToken(DerivAuthEntity), useValue: mockRepo },
                { provide: getRepositoryToken(DerivTransactionEntity), useValue: mockRepo },
                { provide: getRepositoryToken(TradeEntity), useValue: mockRepo },
                { provide: getRepositoryToken(AccountEntity), useValue: mockRepo },
                { provide: ConfigService, useValue: { get: jest.fn() } },
                { provide: Mt5Service, useValue: mockMt5Service },
                { provide: DataSource, useValue: {} },
            ],
        }).compile();

        service = module.get<DerivService>(DerivService);
    });

    describe('extractSymbol', () => {
        it('should extract R_100 from CALL_R_100_10_... shortcode', () => {
            const t = { shortcode: 'CALL_R_100_10_1740763200_1740763260_S0P_0' };
            expect(service['extractSymbol'](t)).toBe('R_100');
        });

        it('should extract EURUSD from MULT_FRXEURUSD_10_... shortcode', () => {
            const t = { shortcode: 'MULT_FRXEURUSD_10_1740763200' };
            expect(service['extractSymbol'](t)).toBe('EURUSD');
        });

        it('should use underlying if present', () => {
            const t = { underlying: 'r_50' };
            expect(service['extractSymbol'](t)).toBe('R_50');
        });

        it('should use shortcode from transaction if contract details lacks it', () => {
            const rawTx = { shortcode: 'CALL_R_10_100_0' };
            expect(service['extractSymbol'](rawTx)).toBe('R_10');
        });

        it('should handle display_name as fallback', () => {
            const t = { display_name: 'Volatility 100 Index' };
            expect(service['extractSymbol'](t)).toBe('Volatility 100 Index');
        });
    });

    describe('Process Deduplication', () => {
        it('should deduplicate multiple fast calls to processTradeSync', () => {
            service['accountIds'].set('user1', 'acc1');
            service['clients'].set('user1', { request: jest.fn() } as any);

            // Spy on processEnrichmentQueue to block it from shifting the queue immediately
            const queueSpy = jest.spyOn(service as any, 'processEnrichmentQueue').mockImplementation(async () => { });

            // First call should queue
            service['processTradeSync']('user1', '12345');
            expect(service['pendingEnrichmentSet'].has('acc1:12345')).toBe(true);
            expect(service['enrichmentQueue'].length).toBe(1);

            // Second call should skip queueing
            service['processTradeSync']('user1', '12345');
            expect(service['enrichmentQueue'].length).toBe(1); // Still 1
            expect(queueSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('PnL Consolidation Logic', () => {
        it('should calculate PnL using contract profit if available', async () => {
            // Mock transaction find
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -10, transactionId: '1', raw: { barrier: '1.2345' } },
                { action: 'sell', amount: 15, transactionId: '2', raw: { barrier: '1.2350' } }
            ]);
            mockRepo.findOne.mockResolvedValue({ id: 'acc1', currency: 'USD' });

            const contractDetails = {
                profit: 5,
                status: 'closed',
                buy_price: 10,
                payout: 15,
                entry_spot: 1.2345,
                exit_spot: 1.2350,
                underlying: 'EURUSD'
            };

            // Capture the upsert call
            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.profit).toBe(5);
            expect(savedData.ticket).toBe('12345'); // ticket is now string
            expect(savedData.status).toBe('CLOSED');
            expect(savedData.qualityFlags.inconsistent_pnl).toBeUndefined();
        });

        it('should mark inconsistent_pnl if contract profit differs from stream calc', async () => {
            const txDate = new Date();
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -10, transactionId: '1', transactionTime: txDate },
                { action: 'sell', amount: 20, transactionId: '2', transactionTime: txDate }
            ]);
            mockRepo.findOne.mockResolvedValue({ id: 'acc1' });

            const contractDetails = {
                profit: -5, // Calc says +10 (20-10). Difference is 15 > 0.05
                is_sold: 1,
                status: 'closed',
                underlying: 'EURUSD',
                purchase_time: Math.floor(txDate.getTime() / 1000),
                sell_time: Math.floor(txDate.getTime() / 1000)
            };

            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.qualityFlags.inconsistent_pnl).toBe(true);
            expect(savedData.dataQuality).toBe('partial');
        });

        it('should mark missing_sell and open status correctly', async () => {
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -10, transactionId: '1' }
            ]);
            mockRepo.findOne.mockResolvedValue({ id: 'acc1' });

            const contractDetails = {
                status: 'open',
                is_sold: 0,
                bid_price: 12 // estimate profit +2
            };

            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.qualityFlags.missing_sell).toBe(true);
            expect(savedData.status).toBe('OPEN');
            expect(savedData.profit).toBe(2);
        });

        it('should set spot prices separately from financial prices', async () => {
            mockRepo.find.mockResolvedValue([
                { action: 'buy', amount: -100, transactionId: 'txn_1', transactionTime: new Date() },
                { action: 'sell', amount: 150, transactionId: 'txn_2', transactionTime: new Date() }
            ]);

            const contractDetails = {
                buy_price: 100,
                sell_price: 150,
                entry_spot: 1.1234,
                exit_spot: 1.1250,
                status: 'closed',
                is_sold: 1,
                profit: 50,
                underlying: 'EURUSD',
                purchase_time: Math.floor(Date.now() / 1000),
                sell_time: Math.floor(Date.now() / 1000)
            };

            let savedData: any;
            mockRepo.upsert.mockImplementation((data) => {
                savedData = data;
                return Promise.resolve();
            });

            await service['consolidateTrade']('user1', 'acc1', '12345', contractDetails);

            expect(savedData.buyPrice).toBe(100);
            expect(savedData.sellPrice).toBe(150);
            expect(savedData.entrySpot).toBe(1.1234);
            expect(savedData.exitSpot).toBe(1.1250);
            expect(savedData.dataQuality).toBe('ok');
        });
    });
});
