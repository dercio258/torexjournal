import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FALLBACK_WORKSPACE_PLANS,
    getDefaultCreditsForTier,
    getDefaultFeaturesForTier,
    normalizeWorkspacePlansCatalog,
} from '../src/lib/pricingPlans';

test('normalizeWorkspacePlansCatalog deduplicates legacy $9/$10 Basic plan and keeps $2.99 Basic with 100 credits & 3 accounts', () => {
    const legacyApiResponse = [
        {
            id: 'legacy-basic-10',
            tier: 'BASIC',
            monthlyPrice: 10,
            compareAtPrice: 10,
            aiDailyCredits: 100,
            maxTradingAccounts: 1,
            features: ['1 Conta de Trading ativa', '100 Créditos AI / mês'],
        },
        {
            id: 'canonical-basic-2',
            tier: 'BASIC',
            monthlyPrice: 2.99,
            compareAtPrice: 2.99,
            aiDailyCredits: 0,
            maxTradingAccounts: 1,
            features: ['1 Conta de Trading ativa', '0 Créditos AI / mês'],
        },
        {
            id: 'pro-plan',
            tier: 'PRO',
            monthlyPrice: 19.99,
            aiDailyCredits: 1500,
            features: ['Torex AI', 'Modo Offline (exceto Trade Replay)'],
        },
        {
            id: 'premium-plan',
            tier: 'PREMIUM',
            monthlyPrice: 39.99,
            aiDailyCredits: 4000,
            features: ['100 Automated Backtesting Runs / month', 'Torex AI'],
        },
    ];

    const ptPlans = normalizeWorkspacePlansCatalog(legacyApiResponse, false);
    assert.deepEqual(
        ptPlans.map((p) => p.tier),
        ['BASIC', 'PRO', 'PREMIUM'],
    );

    const [basic, pro, premium] = ptPlans;
    assert.equal(basic.monthlyPrice, 2.99);
    assert.equal(basic.aiDailyCredits, 100);
    assert.equal(basic.maxTradingAccounts, 3);
    assert.equal(getDefaultCreditsForTier('BASIC'), 100);

    // Basic PT requirements
    assert.ok(basic.features?.includes('3 Contas de Trading ativas'));
    assert.ok(basic.features?.includes('100 Créditos IA / mês'));
    assert.ok(basic.features?.includes('Relatórios operacionais completos'));
    assert.ok(!basic.features?.some((f) => f.includes('visualizar e baixar')));

    // Pro & Premium PT: AI Coach (never Torex AI), exact report cadence, no offline exception text, zero English leak
    for (const plan of [pro, premium]) {
        assert.ok(plan.features?.includes('AI Coach'));
        assert.ok(!plan.features?.some((f) => /Torex AI/i.test(f)));
        assert.ok(!plan.features?.some((f) => /exceto Trade Replay|except Trade Replay/i.test(f)));
        assert.ok(!plan.features?.some((f) => /Automated Backtesting|Mentor Mode|Priority Support/i.test(f)));
    }
    assert.ok(pro.features?.includes('Relatórios mensais'));
    assert.ok(pro.features?.includes('Modo Offline'));
    assert.ok(premium.features?.includes('Relatórios semanais'));
    assert.ok(premium.features?.includes('Modo Offline completo'));
});

test('normalizeWorkspacePlansCatalog produces pure English strings without mixed Portuguese copy', () => {
    const enPlans = normalizeWorkspacePlansCatalog(FALLBACK_WORKSPACE_PLANS, true);
    assert.equal(enPlans.length, 3);

    const [basic, pro, premium] = enPlans;
    assert.ok(basic.features?.includes('3 Active Trading Accounts'));
    assert.ok(basic.features?.includes('100 AI Credits / month'));
    assert.ok(basic.features?.includes('Complete operational reports'));

    assert.ok(pro.features?.includes('AI Coach'));
    assert.ok(pro.features?.includes('Monthly reports'));
    assert.ok(pro.features?.includes('Offline Mode'));

    assert.ok(premium.features?.includes('AI Coach'));
    assert.ok(premium.features?.includes('Weekly reports'));
    assert.ok(premium.features?.includes('Full Offline Mode'));

    for (const plan of enPlans) {
        assert.ok(!/Contas|Relatórios|Modo Offline|Diário/i.test(plan.description || ''));
        for (const f of plan.features || []) {
            assert.ok(!/Contas|Relatórios|Modo Offline|Diário|exceto|except/i.test(f));
        }
    }

    assert.ok(!getDefaultFeaturesForTier('PRO', 1500, true).some((f) => /Torex AI/i.test(f)));
});

test('normalizeWorkspacePlansCatalog overrides stale single $10 BASIC plan row to canonical $2.99 / 25% annual ($26.88/yr)', () => {
    const staleSingleBasic = [
        {
            id: 'legacy-basic-10',
            tier: 'BASIC',
            monthlyPrice: 10,
            annualDiscountPercent: 20,
            aiDailyCredits: 100,
        },
    ];
    const [basic] = normalizeWorkspacePlansCatalog(staleSingleBasic, false);
    assert.equal(basic.tier, 'BASIC');
    assert.equal(basic.monthlyPrice, 2.99);
    const perMo = Number((basic.monthlyPrice * (1 - basic.annualDiscountPercent / 100)).toFixed(2));
    assert.equal(basic.annualDiscountPercent, 25);
    assert.equal(Number((perMo * 12).toFixed(2)), 26.88);
});
