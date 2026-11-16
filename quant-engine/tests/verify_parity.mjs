import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const QUANT_DIR = path.join(ROOT, 'quant-engine');
const CLIENT_DIR = path.join(ROOT, 'client');

const requireFromClient = createRequire(path.join(CLIENT_DIR, 'package.json'));
const esbuild = requireFromClient('esbuild');

async function loadTsModule(entryRelPath) {
    const entryPath = path.join(CLIENT_DIR, entryRelPath);
    const result = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        external: ['klinecharts', '@klinecharts/pro'],
    });
    const code = result.outputFiles[0].text;
    const mod = { exports: {} };
    const fn = new vm.Script(`(function(exports, require, module) {\n${code}\n})`);
    const wrapper = fn.runInThisContext();
    wrapper(mod.exports, requireFromClient, mod);
    return mod.exports;
}

function assertEqual(label, actual, expected, diffs) {
    const a = actual === undefined ? null : actual;
    const e = expected === undefined ? null : expected;
    if (typeof a === 'number' && typeof e === 'number') {
        if (Math.abs(a - e) > 1e-9) {
            diffs.push(`${label}: TS=${a} !== PY=${e}`);
        }
        return;
    }
    if (a !== e) {
        diffs.push(`${label}: TS=${JSON.stringify(a)} !== PY=${JSON.stringify(e)}`);
    }
}

async function main() {
    const goldenPath = path.join(QUANT_DIR, 'golden_vectors.json');
    if (!fs.existsSync(goldenPath)) {
        console.error(`Missing golden_vectors.json at ${goldenPath}. Run pytest first.`);
        process.exit(1);
    }
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));

    const contracts = await loadTsModule('src/schemas/backtestContracts.ts');
    const engine = await loadTsModule('src/components/kline-replay/engine.ts');

    const diffs = [];
    let passed = 0;

    // Vectors 1..5: Execution Preview & Lot Sizing
    for (const vec of golden.previewVectors) {
        const tsPreview = contracts.buildMarketExecutionPreview(vec.input);
        const exp = vec.expected;
        const fields = [
            'immediateFillExpected',
            'bid',
            'ask',
            'entryPrice',
            'stopLoss',
            'takeProfit',
            'lots',
            'riskAmount',
            'grossRewardAtTp',
            'netRewardAtTp',
            'netLossAtSl',
            'effectiveRr',
            'pipsAtRisk',
        ];
        const before = diffs.length;
        for (const f of fields) {
            assertEqual(`${vec.name}.${f}`, tsPreview[f], exp[f], diffs);
        }
        if (diffs.length === before) passed += 1;
    }

    // Vectors 6..11: Replay Order Lifecycle & Immutability
    for (const vec of golden.replayVectors) {
        let initialOrder;
        if (vec.inputOrder) {
            initialOrder = { ...vec.inputOrder };
        } else {
            initialOrder = engine.createOrder(vec.intent, vec.intent.id);
            if (vec.intent.cancelledAt !== undefined) {
                initialOrder.cancelledAt = vec.intent.cancelledAt;
            }
        }
        const [actualOrder] = engine.recomputeOrders([initialOrder], {
            symbol: initialOrder.symbol,
            candles: vec.bars,
            uptoTs: vec.uptoTs,
            rewind: vec.rewind,
        });
        const exp = vec.expectedOrder;
        const fields = [
            'status',
            'orderType',
            'entryPrice',
            'stopLoss',
            'takeProfit',
            'pnl',
            'rMultiple',
            'mfe',
            'mae',
            'exitPrice',
            'exitReason',
            'filledAt',
            'closedAt',
            'cancelledAt',
        ];
        const before = diffs.length;
        for (const f of fields) {
            assertEqual(`${vec.name}.${f}`, actualOrder?.[f], exp?.[f], diffs);
        }
        if (diffs.length === before) passed += 1;
    }

    // Vector 12: Chronological Replay Stats & CANCELLED exclusion
    {
        const sv = golden.statsVector;
        const tsStats = engine.computeStats(sv.orders, sv.initialBalance);
        const exp = sv.expectedStats;
        const fields = [
            'trades',
            'wins',
            'losses',
            'winRate',
            'grossProfit',
            'grossLoss',
            'profitFactor',
            'netProfit',
            'expectancy',
            'avgR',
            'maxDrawdown',
            'maxDrawdownPct',
            'realizedBalance',
        ];
        const before = diffs.length;
        for (const f of fields) {
            assertEqual(`${sv.name}.${f}`, tsStats[f], exp[f], diffs);
        }
        if (diffs.length === before) passed += 1;
    }

    if (diffs.length > 0) {
        console.error(`[FAIL] Python <-> TypeScript 1:1 parity failed (${diffs.length} mismatches):`);
        for (const d of diffs) console.error('  -', d);
        process.exit(1);
    }

    console.log(`[OK] ${passed}/12 Golden Vectors passed with $0.00 discrepancy (Python Decimal === TypeScript Engine).`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
