import test from 'node:test';
import assert from 'node:assert/strict';
import type { KLineData } from 'klinecharts';
import {
    createOrder,
    stepOrder,
    recomputeOrders,
    computeStats,
} from '../src/components/kline-replay/engine.ts';

const BAR_MS = 15 * 60 * 1000;
const BASE_TS = 1700000000000;

function makeBar(index: number, open: number, high: number, low: number, close: number): KLineData {
    return {
        timestamp: BASE_TS + index * BAR_MS,
        open,
        high,
        low,
        close,
        volume: 100 + index,
    };
}

test('createOrder initializes MARKET vs LIMIT/STOP orders with proper entry and initialStopLoss', () => {
    const marketBuy = createOrder(
        {
            symbol: 'XAUUSD',
            side: 'BUY',
            orderType: 'MARKET',
            price: 2000,
            slDistance: 10,
            rrRatio: 2,
            riskAmount: 100,
            lots: 0.1,
            spread: 0.5,
            commission: 2,
            openedAt: BASE_TS,
            decimals: 2,
        },
        'm1'
    );
    assert.equal(marketBuy.status, 'OPEN');
    assert.equal(marketBuy.entryPrice, 2000.5);
    assert.equal(marketBuy.stopLoss, 1990.5);
    assert.equal(marketBuy.initialStopLoss, 1990.5);
    assert.equal(marketBuy.takeProfit, 2020.5);
    assert.equal(marketBuy.filledAt, BASE_TS);

    const limitBuy = createOrder(
        {
            symbol: 'XAUUSD',
            side: 'BUY',
            orderType: 'LIMIT',
            price: 1995,
            referenceBid: 2000,
            slDistance: 5,
            rrRatio: 3,
            riskAmount: 100,
            lots: 0.2,
            spread: 0,
            commission: 0,
            openedAt: BASE_TS,
            decimals: 2,
        },
        'l1'
    );
    assert.equal(limitBuy.status, 'PENDING');
    assert.equal(limitBuy.orderType, 'LIMIT');
    assert.equal(limitBuy.filledAt, undefined);
});

test('stepOrder enforces SL-before-TP conservative tie-break, gap-through exit, pending fill, and MFE/MAE', () => {
    const openBuy = createOrder(
        {
            symbol: 'XAUUSD',
            side: 'BUY',
            orderType: 'MARKET',
            price: 2000,
            slDistance: 10,
            rrRatio: 2,
            riskAmount: 100,
            lots: 0.1,
            spread: 0,
            commission: 0,
            openedAt: BASE_TS,
            decimals: 2,
        },
        'b1'
    );

    // Bar touches BOTH SL (1990) and TP (2020): SL wins conservatively
    const bothTouched = makeBar(1, 2000, 2025, 1988, 2018);
    const resBoth = stepOrder(openBuy, bothTouched);
    assert.equal(resBoth.status, 'LOSS');
    assert.equal(resBoth.exitReason, 'SL');
    assert.equal(resBoth.exitPrice, 1990);
    assert.equal(resBoth.pnl, -100);

    // Gap down below SL at open: exits at open (worse than SL)
    const gapBar = makeBar(2, 1985, 1998, 1984, 1996);
    const resGap = stepOrder(openBuy, gapBar);
    assert.equal(resGap.status, 'LOSS');
    assert.equal(resGap.exitPrice, 1985);
    assert.equal(resGap.pnl, -150);

    // Pending BUY LIMIT triggers at 1995 and closes same bar at open-favorable movement
    const pendingBuy = createOrder(
        {
            symbol: 'XAUUSD',
            side: 'BUY',
            orderType: 'LIMIT',
            price: 1995,
            referenceBid: 2000,
            slDistance: 5,
            rrRatio: 2,
            riskAmount: 100,
            lots: 0.2,
            spread: 0,
            commission: 0,
            openedAt: BASE_TS,
            decimals: 2,
        },
        'p1'
    );
    const fillBar = makeBar(1, 1999, 2002, 1994, 2000); // touches 1995, misses SL(1990) and TP(2005)
    const filled = stepOrder(pendingBuy, fillBar);
    assert.equal(filled.status, 'OPEN');
    assert.equal(filled.filledAt, fillBar.timestamp);
    assert.equal(filled.pnl, 100); // +1R at close=2000
    assert.ok((filled.mfe ?? 0) >= 100);
});

test('incremental recomputeOrders matches full replay 100% and rewind restores prior state deterministically', () => {
    const candles: KLineData[] = [
        makeBar(0, 2000, 2002, 1998, 2000),
        makeBar(1, 2000, 2004, 1999, 2003),
        makeBar(2, 2003, 2006, 1997, 2005), // fills BUY LIMIT @ 1998
        makeBar(3, 2005, 2011, 2004, 2010), // favorable move
        makeBar(4, 2010, 2012, 2001, 2002),
        makeBar(5, 2002, 2005, 1996, 1997), // hits modified BE stop or floats
        makeBar(6, 1997, 2001, 1991, 2000), // dips near 1990 SL without touching it
        makeBar(7, 2000, 2026, 1999, 2025), // hits BUY TP @ 2020
        makeBar(8, 2025, 2030, 2020, 2028),
        makeBar(9, 2028, 2032, 2022, 2024),
    ];

    const mktWin = createOrder(
        {
            symbol: 'XAUUSD',
            side: 'BUY',
            orderType: 'MARKET',
            price: 2000,
            slDistance: 10,
            rrRatio: 2,
            riskAmount: 100,
            lots: 0.1,
            spread: 0,
            commission: 5,
            openedAt: candles[0].timestamp,
            decimals: 2,
        },
        'mkt-win'
    );

    // Order with SL moved to Break-Even (1998) at bar 3
    const limitBe = {
        ...createOrder(
            {
                symbol: 'XAUUSD',
                side: 'BUY',
                orderType: 'LIMIT',
                price: 1998,
                referenceBid: 2000,
                slDistance: 6, // initialSL = 1992, TP = 2010
                rrRatio: 2,
                riskAmount: 100,
                lots: 0.15,
                spread: 0,
                commission: 0,
                openedAt: candles[1].timestamp,
                decimals: 2,
            },
            'limit-be'
        ),
        stopLoss: 1998,
        initialStopLoss: 1992,
        slModifiedAt: candles[3].timestamp,
    };

    // Order placed late (bar 6)
    const lateOrder = createOrder(
        {
            symbol: 'XAUUSD',
            side: 'SELL',
            orderType: 'MARKET',
            price: 2000,
            slDistance: 10,
            rrRatio: 1.5,
            riskAmount: 100,
            lots: 0.1,
            spread: 0,
            commission: 0,
            openedAt: candles[6].timestamp,
            decimals: 2,
        },
        'late-sell'
    );

    const seedOrders = [mktWin, limitBe, lateOrder];

    // Step forward bar-by-bar incrementally vs full replay from scratch
    let incOrders = seedOrders;
    for (let i = 1; i < candles.length; i++) {
        incOrders = recomputeOrders(incOrders, {
            symbol: 'XAUUSD',
            candles,
            uptoTs: candles[i].timestamp,
            prevUptoTs: candles[i - 1].timestamp,
            rewind: false,
        });
        const fullOrders = recomputeOrders(seedOrders, {
            symbol: 'XAUUSD',
            candles,
            uptoTs: candles[i].timestamp,
            rewind: false,
        });
        assert.deepEqual(incOrders, fullOrders, `Incremental diverged from full replay at bar ${i}`);
    }

    // At the end (bar 9):
    const finalMkt = incOrders.find((o) => o.id === 'mkt-win')!;
    assert.equal(finalMkt.status, 'WIN');
    assert.equal(finalMkt.exitReason, 'TP');
    assert.equal(finalMkt.pnl, 195); // $200 gross - $5 commission

    const finalLate = incOrders.find((o) => o.id === 'late-sell')!;
    assert.equal(finalLate.status, 'LOSS'); // hit SL 2010 at bar 7

    // Rewind back to bar 1 (before limitBe filled, before limitBe slModifiedAt, before lateOrder placed, before mktWin closed)
    const rewound = recomputeOrders(incOrders, {
        symbol: 'XAUUSD',
        candles,
        uptoTs: candles[1].timestamp,
        rewind: true,
    });
    assert.equal(rewound.find((o) => o.id === 'late-sell'), undefined);
    const rewoundMkt = rewound.find((o) => o.id === 'mkt-win')!;
    assert.equal(rewoundMkt.status, 'OPEN');
    assert.equal(rewoundMkt.closedAt, undefined);
    assert.equal(rewoundMkt.exitPrice, undefined);

    const rewoundLimit = rewound.find((o) => o.id === 'limit-be')!;
    assert.equal(rewoundLimit.status, 'PENDING');
    assert.equal(rewoundLimit.filledAt, undefined);
    assert.equal(rewoundLimit.stopLoss, 1992); // restored from initialStopLoss because slModifiedAt > bar 1
    assert.equal(rewoundLimit.slModifiedAt, undefined);
});

test('computeStats accurately derives winRate, profitFactor, drawdown, expectancy and avgR', () => {
    const base = {
        symbol: 'EURUSD',
        side: 'BUY' as const,
        orderType: 'MARKET' as const,
        entryPrice: 1.1,
        stopLoss: 1.09,
        takeProfit: 1.12,
        lots: 0.1,
        riskAmount: 100,
        rrRatio: 2,
        openedAt: BASE_TS,
    };
    const stats = computeStats(
        [
            { ...base, id: '1', status: 'WIN', pnl: 200, rMultiple: 2, closedAt: BASE_TS + 1000 },
            { ...base, id: '2', status: 'LOSS', pnl: -100, rMultiple: -1, closedAt: BASE_TS + 2000 },
            { ...base, id: '3', status: 'WIN', pnl: 200, rMultiple: 2, closedAt: BASE_TS + 3000 },
            { ...base, id: '4', status: 'CLOSED', pnl: 0, rMultiple: 0, closedAt: BASE_TS + 4000 }, // ignored
        ],
        10000
    );

    assert.equal(stats.trades, 3);
    assert.equal(stats.wins, 2);
    assert.equal(stats.losses, 1);
    assert.equal(stats.winRate, 66.7);
    assert.equal(stats.grossProfit, 400);
    assert.equal(stats.grossLoss, 100);
    assert.equal(stats.profitFactor, 4);
    assert.equal(stats.netProfit, 300);
    assert.equal(stats.expectancy, 100);
    assert.equal(stats.avgR, 1);
    assert.equal(stats.maxDrawdown, 100);
    assert.equal(stats.realizedBalance, 10300);
});
