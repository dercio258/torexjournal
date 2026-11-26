import test from 'node:test';
import assert from 'node:assert/strict';
import { MT5_BROKERS_CATALOG, matchesBrokerServerQuery } from '../src/constants/mt5ServersCatalog.ts';

test('MT5_BROKERS_CATALOG contains full Exness MT5Trial (1..20), MT5Real (1..45), and regional servers without duplicates', () => {
    const exness = MT5_BROKERS_CATALOG.find((b) => b.id === 'exness');
    assert.ok(exness);
    const names = exness.servers.map((s) => s.name);

    for (const expected of [
        'Exness-MT5Trial',
        'Exness-MT5Trial15',
        'Exness-MT5Trial20',
        'Exness-MT5Real',
        'Exness-MT5Real13',
        'Exness-MT5Real19',
        'Exness-MT5Real37',
        'Exness-MT5Real45',
        'ExnessKE-MT5Real',
        'ExnessZA-MT5Real',
        'ExnessEU-MT5Real',
        'ExnessUK-MT5Real',
    ]) {
        assert.equal(names.includes(expected), true, `Missing Exness server ${expected}`);
    }
    assert.equal(new Set(names).size, names.length);
});

test('MT5_BROKERS_CATALOG has unique broker IDs, unique servers per broker, and expanded major brokers & prop firms', () => {
    assert.equal(MT5_BROKERS_CATALOG.length >= 70, true);
    const ids = MT5_BROKERS_CATALOG.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length);

    for (const group of MT5_BROKERS_CATALOG) {
        assert.equal(group.servers.length > 0, true, `Empty servers for ${group.id}`);
        const names = group.servers.map((s) => s.name);
        assert.equal(new Set(names).size, names.length, `Duplicate server in ${group.id}`);
    }

    for (const expectedId of [
        'exness',
        'xm',
        'hfm',
        'icmarkets',
        'pepperstone',
        'fusionmarkets',
        'fxtm',
        'startrader',
        'dooprime',
        'monetamarkets',
        'activtrades',
        'equiti',
        'multibank',
        'swissquote',
        'darwinex',
        'cptmarkets',
        'valetax',
        'btgpactual',
        'xpinvestimentos',
        'fundedtradingplus',
        'fortraders',
        'fundingtraders',
        'dnafunded',
        'oandaproptrader',
    ]) {
        assert.equal(ids.includes(expectedId), true, `Missing broker ${expectedId}`);
    }
});

test('matchesBrokerServerQuery supports multi-token queries across broker name, server name, and description', () => {
    const exness = MT5_BROKERS_CATALOG.find((b) => b.id === 'exness')!;
    const real37 = exness.servers.find((s) => s.name === 'Exness-MT5Real37')!;
    const trial15 = exness.servers.find((s) => s.name === 'Exness-MT5Trial15')!;

    assert.equal(matchesBrokerServerQuery(exness, real37, 'exness real 37'), true);
    assert.equal(matchesBrokerServerQuery(exness, real37, 'exness 37'), true);
    assert.equal(matchesBrokerServerQuery(exness, real37, 'exness trial 15'), false);
    assert.equal(matchesBrokerServerQuery(exness, trial15, 'exness trial 15'), true);
});
