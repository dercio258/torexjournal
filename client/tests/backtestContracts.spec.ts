import test from 'node:test';
import assert from 'node:assert/strict';
import {
    OrderStatusSchema,
    ReplayOrderSchema,
    sanitizeValidatedOrders,
    calculateInstrumentLots,
    buildMarketExecutionPreview,
} from '../src/schemas/backtestContracts.ts';

test('OrderStatusSchema accepts CLOSED and preprocesses legacy CANCELLED to CLOSED', () => {
    assert.equal(OrderStatusSchema.parse('OPEN'), 'OPEN');
    assert.equal(OrderStatusSchema.parse('WIN'), 'WIN');
    assert.equal(OrderStatusSchema.parse('LOSS'), 'LOSS');
    assert.equal(OrderStatusSchema.parse('PENDING'), 'PENDING');
    assert.equal(OrderStatusSchema.parse('CLOSED'), 'CLOSED');
    assert.equal(OrderStatusSchema.parse('CANCELLED'), 'CLOSED');
    assert.equal(ReplayOrderSchema.shape.status.parse('unexpected_status'), 'CLOSED');
});

test('sanitizeValidatedOrders preserves journal, psychCheck, nullable MFE/MAE, and SL/partial metadata without corrupting CLOSED orders', () => {
    const raw = [
        {
            id: 'ord-cancelled-1',
            symbol: 'XAUUSD',
            side: 'BUY',
            orderType: 'LIMIT',
            entryPrice: 2650,
            stopLoss: 2645,
            initialStopLoss: 2640,
            takeProfit: 2670,
            lots: 0.2,
            riskAmount: 100,
            rrRatio: 2,
            status: 'CANCELLED',
            pnl: 0,
            mfe: null,
            mae: null,
            openedAt: 1700000000000,
            slModifiedAt: 1700000300000,
            parentOrderId: 'parent-1',
            isPartialClose: false,
            journalContent: '<p>Clean pullback setup</p>',
            journalImages: ['/uploads/backtest-screenshots/u1/shot1.png'],
            setup: 'London Sweep',
            rating: 5,
            psychCheck: {
                feeling: 'Calmo',
                followingPlan: 'Sim',
                entryDriver: 'Gatilho técnico',
                riskComfort: 'Confortável',
            },
            customExtraField: 'kept-by-passthrough',
        },
        {
            id: 'ord-closed-2',
            symbol: 'EURUSD',
            side: 'SELL',
            orderType: 'MARKET',
            entryPrice: 1.085,
            stopLoss: 1.087,
            takeProfit: 1.081,
            lots: 0.5,
            riskAmount: 100,
            rrRatio: 2,
            status: 'CLOSED',
            pnl: 0,
            openedAt: 1700001000000,
            closedAt: 1700002000000,
        },
    ];

    const sanitized = sanitizeValidatedOrders(raw);
    assert.equal(sanitized.length, 2);

    const first = sanitized[0] as any;
    assert.equal(first.status, 'CLOSED');
    assert.equal(first.mfe, null);
    assert.equal(first.mae, null);
    assert.equal(first.initialStopLoss, 2640);
    assert.equal(first.slModifiedAt, 1700000300000);
    assert.equal(first.parentOrderId, 'parent-1');
    assert.equal(first.isPartialClose, false);
    assert.equal(first.journalContent, '<p>Clean pullback setup</p>');
    assert.deepEqual(first.journalImages, ['/uploads/backtest-screenshots/u1/shot1.png']);
    assert.equal(first.setup, 'London Sweep');
    assert.equal(first.rating, 5);
    assert.equal(first.psychCheck?.feeling, 'Calmo');
    assert.equal(first.customExtraField, 'kept-by-passthrough');

    assert.equal(sanitized[1].status, 'CLOSED');
});

test('calculateInstrumentLots & buildMarketExecutionPreview size risk accurately for XAUUSD and EURUSD', () => {
    // 100 oz/lot on XAUUSD, $10 SL distance => $1,000 per standard lot; $100 risk => 0.10 lots
    const goldLots = calculateInstrumentLots('XAUUSD', 2650, 10, 100);
    assert.equal(goldLots.spec.assetClass, 'METAL');
    assert.equal(goldLots.spec.contractSize, 100);
    assert.equal(goldLots.lots, 0.1);

    // 100k/lot on EURUSD, 0.0020 SL distance (20 pips) => $200 per lot; $100 risk => 0.50 lots
    const eurLots = calculateInstrumentLots('EURUSD', 1.085, 0.002, 100);
    assert.equal(eurLots.spec.assetClass, 'FOREX');
    assert.equal(eurLots.lots, 0.5);

    const buyPreview = buildMarketExecutionPreview({
        symbol: 'XAUUSD',
        side: 'BUY',
        orderType: 'MARKET',
        bid: 2650,
        balance: 10000,
        riskPercent: 1,
        slDistancePct: 0.5,
        rrTarget: 2,
        spread: 0.5,
        commission: 4,
        decimals: 2,
    });
    assert.equal(buyPreview.valid, true);
    assert.equal(buyPreview.ask, 2650.5);
    assert.equal(buyPreview.entryPrice, 2650.5);
    assert.ok(buyPreview.stopLoss < buyPreview.entryPrice);
    assert.ok(buyPreview.takeProfit > buyPreview.entryPrice);
    assert.equal(buyPreview.riskAmount, 100);
    assert.equal(buyPreview.netRewardAtTp, 196);
    assert.equal(buyPreview.netLossAtSl, 104);
});
