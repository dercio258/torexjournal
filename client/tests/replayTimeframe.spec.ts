import test from 'node:test';
import assert from 'node:assert/strict';
import type { KLineData } from 'klinecharts';
import type { Period, SymbolInfo } from '@klinecharts/pro';
import {
    estimateBarIntervalMs,
    reconcileCapturedOverlayPoints,
    resolveOverlayPointsAgainstCandles,
} from '../src/components/kline-replay/hooks/drawingOverlayUtils.ts';
import {
    buildVisibleReplaySlice,
    CustomKLineDatafeed,
    doesHistoryCoverReplayTarget,
    idbCoversTargetWindowPure,
    mergeContiguousCandles,
} from '../src/services/klineDatafeed.ts';

const M1_MS = 60 * 1000;
const M5_MS = 5 * M1_MS;
const M15_MS = 15 * M1_MS;
const H1_MS = 60 * M1_MS;
const HOUR_START = Date.UTC(2026, 2, 10, 10, 0, 0);

const TEST_SYMBOL: SymbolInfo = {
    ticker: 'XAUUSD',
    name: 'Gold Spot',
    shortName: 'XAUUSD',
    exchange: 'CFD',
    market: 'cfd',
    pricePrecision: 2,
    volumePrecision: 0,
    priceCurrency: 'USD',
    type: 'CFD',
};

const PERIOD_1M: Period = { multiplier: 1, timespan: 'minute', text: '1m' };
const PERIOD_5M: Period = { multiplier: 5, timespan: 'minute', text: '5m' };
const PERIOD_15M: Period = { multiplier: 15, timespan: 'minute', text: '15m' };
const PERIOD_1H: Period = { multiplier: 1, timespan: 'hour', text: '1h' };

function makeSeries(startTs: number, stepMs: number, count: number, basePrice: number = 2600): KLineData[] {
    const out: KLineData[] = [];
    for (let i = 0; i < count; i++) {
        const ts = startTs + i * stepMs;
        const o = basePrice + i * 0.5;
        out.push({
            timestamp: ts,
            open: o,
            high: o + 2,
            low: o - 1,
            close: o + 0.5,
            volume: 100 + i,
        });
    }
    return out;
}

test('estimateBarIntervalMs uses median positive delta and ignores trailing weekend gaps', () => {
    const candles = makeSeries(HOUR_START, M15_MS, 20);
    // Simulate a 48h weekend gap before the latest bar
    const withWeekend = [
        ...candles,
        {
            timestamp: candles[candles.length - 1].timestamp + 48 * H1_MS,
            open: 2610,
            high: 2612,
            low: 2608,
            close: 2611,
            volume: 150,
        },
    ];
    assert.equal(estimateBarIntervalMs(withWeekend, M1_MS), M15_MS);
});

test('resolveOverlayPointsAgainstCandles handles last-bar HTF mapping and out-of-range chart mount points safely', () => {
    const h1Candles = makeSeries(HOUR_START - 4 * H1_MS, H1_MS, 5);
    const lastBarTs = h1Candles[h1Candles.length - 1].timestamp; // HOUR_START
    const subBarTs = lastBarTs + 15 * M1_MS; // 10:15 inside 10:00 1h candle
    const futureTs = lastBarTs + 3 * H1_MS; // truly in the future
    const pastTs = h1Candles[0].timestamp - 2 * H1_MS;

    // Canonical resolution keeps the exact timestamps
    const canonical = resolveOverlayPointsAgainstCandles(
        [
            { timestamp: subBarTs, value: 2605 },
            { timestamp: futureTs, value: 2620 },
            { timestamp: pastTs, value: 2580 },
        ],
        h1Candles,
        { stepMs: H1_MS }
    );
    assert.equal(canonical[0].timestamp, subBarTs);
    assert.equal(canonical[0].dataIndex, 4);
    assert.equal(canonical[1].timestamp, futureTs);
    assert.equal(canonical[1].dataIndex, 7);
    assert.equal(canonical[2].timestamp, pastTs);
    assert.equal(canonical[2].dataIndex, -2);

    // Chart mount resolution works around klinecharts' binarySearchNearest edge behavior
    const mounted = resolveOverlayPointsAgainstCandles(canonical, h1Candles, {
        stepMs: H1_MS,
        forChartMount: true,
    });
    assert.equal(mounted[0].timestamp, lastBarTs);
    assert.equal(mounted[0].dataIndex, 4);
    assert.equal(mounted[1].timestamp, undefined);
    assert.equal(mounted[1].dataIndex, 7);
    assert.equal(mounted[2].timestamp, undefined);
    assert.equal(mounted[2].dataIndex, -2);

    // Capturing unchanged points back from the chart preserves subBarTs and future/past timestamps
    const reconciled = reconcileCapturedOverlayPoints(mounted, canonical, h1Candles, H1_MS);
    assert.equal(reconciled[0].timestamp, subBarTs);
    assert.equal(reconciled[1].timestamp, futureTs);
    assert.equal(reconciled[2].timestamp, pastTs);
});

test('buildVisibleReplaySlice synthesizes partial HTF bar from LTF without leaking future ticks or mutating source', () => {
    const bars15m: KLineData[] = [
        { timestamp: HOUR_START, open: 100, high: 102, low: 99, close: 101, volume: 10 },
        { timestamp: HOUR_START + 15 * M1_MS, open: 101, high: 104, low: 100, close: 103, volume: 12 },
        { timestamp: HOUR_START + 30 * M1_MS, open: 103, high: 150, low: 102, close: 145, volume: 500 },
        { timestamp: HOUR_START + 45 * M1_MS, open: 145, high: 160, low: 80, close: 90, volume: 700 },
    ];
    const bars1h: KLineData[] = [
        { timestamp: HOUR_START - H1_MS, open: 95, high: 101, low: 94, close: 100, volume: 200 },
        { timestamp: HOUR_START, open: 100, high: 160, low: 80, close: 90, volume: 1222 },
    ];

    const slice = buildVisibleReplaySlice(
        bars1h,
        1,
        H1_MS,
        HOUR_START + 15 * M1_MS,
        M15_MS,
        [{ stepMs: M15_MS, candles: bars15m }]
    );

    assert.equal(slice.hasPartialLastBar, true);
    assert.equal(slice.candles.length, 2);
    const last = slice.candles[1];
    assert.equal(last.open, 100);
    assert.equal(last.high, 104); // future 150/160 must NOT leak
    assert.equal(last.low, 99); // future 80 must NOT leak
    assert.equal(last.close, 103); // future 90 must NOT leak
    assert.equal(last.volume, 22);
    // Original bars1h array stays untouched
    assert.equal(bars1h[1].high, 160);
    assert.equal(bars1h[1].close, 90);

    // At 10:45 on 15m, the full 10:00 hour has completed -> no longer partial
    const completed = buildVisibleReplaySlice(
        bars1h,
        1,
        H1_MS,
        HOUR_START + 45 * M1_MS,
        M15_MS,
        [{ stepMs: M15_MS, candles: bars15m }]
    );
    assert.equal(completed.hasPartialLastBar, false);
    assert.equal(completed.candles[1].close, 90);
});

test('mergeContiguousCandles and gap guards reject multi-week disjoint islands while permitting normal weekends', () => {
    const olderIsland = makeSeries(HOUR_START - 20 * 24 * H1_MS, M15_MS, 20);
    const newerIsland = makeSeries(HOUR_START, M15_MS, 80);

    // Disjoint islands -> prefer incoming rather than splicing a 20-day gap
    const merged = mergeContiguousCandles(newerIsland, olderIsland, M15_MS);
    assert.equal(merged.length, olderIsland.length);
    assert.equal(merged[0].timestamp, olderIsland[0].timestamp);

    // Normal 52h weekend gap remains contiguous and covers target
    const fridayTail = makeSeries(HOUR_START - 10 * M15_MS, M15_MS, 10);
    const sundayOpen = makeSeries(fridayTail[fridayTail.length - 1].timestamp + 52 * H1_MS, M15_MS, 70);
    const weekSeries = mergeContiguousCandles(fridayTail, sundayOpen, M15_MS);
    assert.equal(weekSeries.length, 80);
    assert.equal(doesHistoryCoverReplayTarget(weekSeries, sundayOpen[10].timestamp, M15_MS), true);
    assert.equal(
        idbCoversTargetWindowPure(weekSeries, weekSeries[weekSeries.length - 1].timestamp, M15_MS),
        true
    );

    // Giant island array inside check returns false
    const splicedGap = [...olderIsland, ...newerIsland];
    assert.equal(doesHistoryCoverReplayTarget(splicedGap, HOUR_START - 10 * 24 * H1_MS, M15_MS), false);
    assert.equal(
        idbCoversTargetWindowPure(splicedGap, splicedGap[splicedGap.length - 1].timestamp, M15_MS),
        false
    );
});

test('CustomKLineDatafeed preserves LTF cursor across LTF -> HTF -> LTF switches and finalizes partial HTF bar on step', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

    try {
        const df = new CustomKLineDatafeed('DEMO');
        const fixedSessionEnd = Date.UTC(2026, 2, 15, 16, 0, 0);
        df.setSessionDateWindow('2026-03-01', '2026-03-15');
        // Load initial 15m data in DEMO mode (sessionToTs clamps before Date.now())
        await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_15M);
        const bars15m = df.getFullHistory();
        assert.ok(bars15m.length > 200);

        // Pick a :15 candle near 60% into the 15m history so the enclosing 1h bar has :30 and :45 ahead of it
        const target15mBar = bars15m.find(
            (b, i) =>
                i > 100 &&
                i < bars15m.length - 20 &&
                new Date(b.timestamp).getUTCMinutes() === 15 &&
                b.timestamp < fixedSessionEnd
        );
        assert.ok(target15mBar, 'expected a :15 bar inside demo 15m history');

        const sliced15m = df.setReplayTimestamp(target15mBar!.timestamp);
        const last15m = sliced15m[sliced15m.length - 1];
        assert.equal(last15m.timestamp, target15mBar!.timestamp);
        const prev00Bar = sliced15m[sliced15m.length - 2];
        assert.equal(prev00Bar.timestamp, target15mBar!.timestamp - M15_MS);

        // Switch UP to 1h preserving canonical 15m timestamp
        await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_1H, undefined, undefined, df.getReplayTimestamp(), true);
        const sliced1h = await df.ensureTimestampLoaded(df.getReplayTimestamp()!, {
            preserveCanonicalStep: true,
        });
        const partial1hBar = sliced1h[sliced1h.length - 1];
        assert.equal(partial1hBar.timestamp, prev00Bar.timestamp);
        assert.equal(partial1hBar.close, last15m.close);
        assert.equal(partial1hBar.high, Math.max(prev00Bar.high, last15m.high));
        assert.equal(partial1hBar.low, Math.min(prev00Bar.low, last15m.low));
        // Canonical replay timestamp must still be :15, NOT clobbered to :00!
        assert.equal(df.getReplayTimestamp(), target15mBar!.timestamp);

        // Switch BACK to 15m -> must resume cleanly on :15
        await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_15M, undefined, undefined, df.getReplayTimestamp(), true);
        const restored15m = await df.ensureTimestampLoaded(df.getReplayTimestamp()!, {
            preserveCanonicalStep: true,
        });
        assert.equal(restored15m[restored15m.length - 1].timestamp, target15mBar!.timestamp);

        // Switch to 1h partial bar again and step forward ONCE -> finalizes full 1h bar before jumping to next hour
        await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_1H, undefined, undefined, df.getReplayTimestamp(), true);
        const beforeStep1h = await df.ensureTimestampLoaded(df.getReplayTimestamp()!, {
            preserveCanonicalStep: true,
        });
        const full1hBarAtHour = df.getFullHistory().find((b) => b.timestamp === partial1hBar.timestamp)!;
        assert.ok(full1hBarAtHour);
        assert.equal(beforeStep1h[beforeStep1h.length - 1].close, last15m.close);

        const stepped1 = df.stepReplayForward()!;
        assert.equal(stepped1.timestamp, partial1hBar.timestamp);
        assert.equal(stepped1.close, full1hBarAtHour.close);

        const stepped2 = df.stepReplayForward()!;
        assert.equal(stepped2.timestamp, partial1hBar.timestamp + H1_MS);

        df.dispose();
    } finally {
        (globalThis as any).fetch = origFetch;
    }
});

test('CustomKLineDatafeed handles distant historical cursor HTF -> 1m and keeps aux pane isolated', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

    try {
        const df = new CustomKLineDatafeed('DEMO');
        await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_1H);

        // Jump to 14 days ago (well outside the newest 500 1m/5m bars!)
        const distantCutoff = Date.UTC(2026, 1, 20, 14, 15, 0);
        const bars15m = await (async () => {
            await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_15M);
            return df.ensureTimestampLoaded(distantCutoff);
        })();
        assert.ok(bars15m.length >= 100);
        assert.equal(bars15m[bars15m.length - 1].timestamp, distantCutoff);

        // Query auxiliary 1h pane sliced at distantCutoff -> partial 14:00 bar matches 15m 14:00..14:15 close!
        const aux1h = await df.getHistorySlicedAtTimestamp(TEST_SYMBOL, PERIOD_1H, distantCutoff);
        assert.ok(aux1h.length > 0);
        assert.equal(aux1h[aux1h.length - 1].timestamp, Date.UTC(2026, 1, 20, 14, 0, 0));
        assert.equal(aux1h[aux1h.length - 1].close, bars15m[bars15m.length - 1].close);

        // Query auxiliary 5m pane sliced at distantCutoff -> loads historical 5m window around Feb 20 (NOT today!)
        const aux5m = await df.getHistorySlicedAtTimestamp(TEST_SYMBOL, PERIOD_5M, distantCutoff);
        assert.ok(aux5m.length >= 100);
        assert.equal(aux5m[aux5m.length - 1].timestamp, distantCutoff);

        // Aux calls must NOT overwrite primary fullHistory / context
        assert.equal(df.getContext().periodText, '15m');
        assert.equal(estimateBarIntervalMs(df.getFullHistory(), M15_MS), M15_MS);

        // Switch primary to 1m at distantCutoff -> loads contiguous 1m window covering Feb 20 14:15
        await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_1M, undefined, undefined, distantCutoff, true);
        const bars1m = await df.ensureTimestampLoaded(distantCutoff, { preserveCanonicalStep: true });
        assert.equal(bars1m[bars1m.length - 1].timestamp, distantCutoff);
        assert.equal(doesHistoryCoverReplayTarget(df.getFullHistory(), distantCutoff, M1_MS), true);

        df.dispose();
    } finally {
        (globalThis as any).fetch = origFetch;
    }
});

test('CustomKLineDatafeed discards stale concurrent getHistoryKLineData responses across rapid TF changes', async () => {
    const origFetch = globalThis.fetch;
    let resolveSlowReq: ((val: any) => void) | null = null;

    (globalThis as any).fetch = async (input: any) => {
        const url = String(input);
        if (url.includes('timeframe=5m')) {
            return new Promise((resolve) => {
                resolveSlowReq = resolve;
            });
        }
        return { ok: false, status: 503, json: async () => ({}) };
    };

    try {
        const df = new CustomKLineDatafeed('DEMO');
        const slowPromise = df.getHistoryKLineData(TEST_SYMBOL, PERIOD_5M);
        // Immediately switch to 1h before 5m resolves
        await df.getHistoryKLineData(TEST_SYMBOL, PERIOD_1H);
        assert.equal(df.getContext().periodText, '1h');
        const full1hCount = df.getFullHistory().length;

        // Now resolve the stale 5m response -> must NOT clobber 1h primary history!
        resolveSlowReq?.({ ok: false, status: 503, json: async () => ({}) });
        await slowPromise;

        assert.equal(df.getContext().periodText, '1h');
        assert.equal(df.getFullHistory().length, full1hCount);
        assert.equal(estimateBarIntervalMs(df.getFullHistory(), M1_MS), H1_MS);

        df.dispose();
    } finally {
        (globalThis as any).fetch = origFetch;
    }
});
