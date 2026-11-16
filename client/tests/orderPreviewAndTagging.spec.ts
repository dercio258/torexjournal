import test from 'node:test';
import assert from 'node:assert/strict';
import {
    inferPendingOrderTypeFromEntry,
    applyPreviewEntryDrag,
    applyPreviewSlDrag,
    applyPreviewTpDrag,
    applyOrderQuickTagPatch,
} from '../src/components/kline-replay/orderPreviewMath.ts';
import { computeOrdersSignature, type ReplayOrder } from '../src/schemas/backtestContracts.ts';

test('inferPendingOrderTypeFromEntry and applyPreviewEntryDrag classify LIMIT vs STOP and recalculate SL/TP', () => {
    assert.equal(inferPendingOrderTypeFromEntry(2660, 2650, 'BUY'), 'STOP');
    assert.equal(inferPendingOrderTypeFromEntry(2640, 2650, 'BUY'), 'LIMIT');
    assert.equal(inferPendingOrderTypeFromEntry(2640, 2650, 'SELL'), 'STOP');
    assert.equal(inferPendingOrderTypeFromEntry(2660, 2650, 'SELL'), 'LIMIT');

    const buyStop = applyPreviewEntryDrag({
        nextEntryPrice: 2000,
        orderType: 'MARKET',
        orderSide: 'BUY',
        referencePrice: 1990,
        slDistancePct: 1,
        rrTarget: 2,
    });
    assert.equal(buyStop.valid, true);
    assert.equal(buyStop.orderType, 'STOP');
    assert.equal(buyStop.limitEntryPrice, 2000);
    assert.equal(buyStop.stopLoss, 1980);
    assert.equal(buyStop.takeProfit, 2040);

    const buyLimit = applyPreviewEntryDrag({
        nextEntryPrice: 2000,
        orderType: 'STOP',
        orderSide: 'BUY',
        referencePrice: 2010,
        slDistancePct: 1,
        rrTarget: 3,
    });
    assert.equal(buyLimit.valid, true);
    assert.equal(buyLimit.orderType, 'LIMIT');
    assert.equal(buyLimit.stopLoss, 1980);
    assert.equal(buyLimit.takeProfit, 2060);

    const sellStop = applyPreviewEntryDrag({
        nextEntryPrice: 1000,
        orderType: 'MARKET',
        orderSide: 'SELL',
        referencePrice: 1010,
        slDistancePct: 1,
        rrTarget: 2,
    });
    assert.equal(sellStop.valid, true);
    assert.equal(sellStop.orderType, 'STOP');
    assert.equal(sellStop.stopLoss, 1010);
    assert.equal(sellStop.takeProfit, 980);

    const sellLimit = applyPreviewEntryDrag({
        nextEntryPrice: 1000,
        orderType: 'MARKET',
        orderSide: 'SELL',
        referencePrice: 995,
        slDistancePct: 2,
        rrTarget: 2.5,
    });
    assert.equal(sellLimit.valid, true);
    assert.equal(sellLimit.orderType, 'LIMIT');
    assert.equal(sellLimit.stopLoss, 1020);
    assert.equal(sellLimit.takeProfit, 950);

    assert.equal(
        applyPreviewEntryDrag({
            nextEntryPrice: 0,
            orderType: 'LIMIT',
            orderSide: 'BUY',
            referencePrice: 2000,
            slDistancePct: 1,
            rrTarget: 2,
        }).valid,
        false
    );
    assert.equal(
        applyPreviewEntryDrag({
            nextEntryPrice: -50,
            orderType: 'LIMIT',
            orderSide: 'SELL',
            referencePrice: 2000,
            slDistancePct: 1,
            rrTarget: 2,
        }).valid,
        false
    );
});

test('applyPreviewSlDrag validates side constraints and recalculates slDistancePct', () => {
    const validBuy = applyPreviewSlDrag({
        nextSlPrice: 1990,
        entryPrice: 2000,
        orderSide: 'BUY',
    });
    assert.equal(validBuy.valid, true);
    assert.equal(validBuy.slDistancePct, 0.5);
    assert.equal(validBuy.stopLoss, 1990);

    const validSell = applyPreviewSlDrag({
        nextSlPrice: 1020,
        entryPrice: 1000,
        orderSide: 'SELL',
    });
    assert.equal(validSell.valid, true);
    assert.equal(validSell.slDistancePct, 2);
    assert.equal(validSell.stopLoss, 1020);

    assert.equal(
        applyPreviewSlDrag({
            nextSlPrice: 2005,
            entryPrice: 2000,
            orderSide: 'BUY',
        }).valid,
        false
    );
    assert.equal(
        applyPreviewSlDrag({
            nextSlPrice: 2000,
            entryPrice: 2000,
            orderSide: 'BUY',
        }).valid,
        false
    );
    assert.equal(
        applyPreviewSlDrag({
            nextSlPrice: 995,
            entryPrice: 1000,
            orderSide: 'SELL',
        }).valid,
        false
    );
});

test('applyPreviewTpDrag validates side constraints and recalculates rrTarget', () => {
    const validBuy = applyPreviewTpDrag({
        nextTpPrice: 2030,
        entryPrice: 2000,
        stopLoss: 1990,
        orderSide: 'BUY',
    });
    assert.equal(validBuy.valid, true);
    assert.equal(validBuy.rrTarget, 3);
    assert.equal(validBuy.takeProfit, 2030);

    const validSell = applyPreviewTpDrag({
        nextTpPrice: 960,
        entryPrice: 1000,
        stopLoss: 1020,
        orderSide: 'SELL',
    });
    assert.equal(validSell.valid, true);
    assert.equal(validSell.rrTarget, 2);
    assert.equal(validSell.takeProfit, 960);

    assert.equal(
        applyPreviewTpDrag({
            nextTpPrice: 1995,
            entryPrice: 2000,
            stopLoss: 1990,
            orderSide: 'BUY',
        }).valid,
        false
    );
    assert.equal(
        applyPreviewTpDrag({
            nextTpPrice: 1005,
            entryPrice: 1000,
            stopLoss: 1020,
            orderSide: 'SELL',
        }).valid,
        false
    );
});

test('applyOrderQuickTagPatch updates order immutably and computeOrdersSignature reflects tag edits', () => {
    const baseOrder: ReplayOrder = {
        id: 'ord-quick-tag-1',
        symbol: 'XAUUSD',
        side: 'BUY',
        orderType: 'LIMIT',
        entryPrice: 2650,
        stopLoss: 2640,
        takeProfit: 2680,
        lots: 0.25,
        riskAmount: 250,
        rrRatio: 3,
        status: 'WIN',
        pnl: 750,
        openedAt: 1700000000000,
        closedAt: 1700003600000,
    };

    const sigBase = computeOrdersSignature([baseOrder]);

    const rated = applyOrderQuickTagPatch(baseOrder, { rating: 4.7 });
    assert.notEqual(rated, baseOrder);
    assert.equal(baseOrder.rating, undefined);
    assert.equal(rated.rating, 5);
    const sigRated = computeOrdersSignature([rated]);
    assert.notEqual(sigRated, sigBase);

    const withSetup = applyOrderQuickTagPatch(rated, { setup: '  London Sweep  ' });
    assert.equal(withSetup.setup, 'London Sweep');
    const sigSetup = computeOrdersSignature([withSetup]);
    assert.notEqual(sigSetup, sigRated);

    const withPsych = applyOrderQuickTagPatch(withSetup, {
        psychCheck: {
            feeling: 'Calmo',
            followingPlan: 'Sim',
            entryDriver: 'Estratégia',
            riskComfort: 'Sim',
        },
    });
    assert.deepEqual(withPsych.psychCheck, {
        feeling: 'Calmo',
        followingPlan: 'Sim',
        entryDriver: 'Estratégia',
        riskComfort: 'Sim',
    });
    const sigPsych = computeOrdersSignature([withPsych]);
    assert.notEqual(sigPsych, sigSetup);

    const withJournal = applyOrderQuickTagPatch(withPsych, {
        journalContent: 'Entrada confirmada apos MSS M5',
    });
    assert.equal(withJournal.journalContent, 'Entrada confirmada apos MSS M5');
    const sigJournal = computeOrdersSignature([withJournal]);
    assert.notEqual(sigJournal, sigPsych);

    const cleared = applyOrderQuickTagPatch(withJournal, {
        rating: null,
        setup: '   ',
    });
    assert.equal(cleared.rating, undefined);
    assert.equal(cleared.setup, undefined);
    assert.equal(cleared.journalContent, 'Entrada confirmada apos MSS M5');
    assert.equal(cleared.psychCheck?.followingPlan, 'Sim');
});
