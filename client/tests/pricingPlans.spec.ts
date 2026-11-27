import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculatePlanCyclePricing,
    FALLBACK_WORKSPACE_PLANS,
    getMaxDiscountForCycle,
    normalizeSingleWorkspacePlan,
    normalizeWorkspacePlansCatalog,
} from '../src/lib/pricingPlans.ts';

test('normalizeSingleWorkspacePlan preserves PRO and PREMIUM instead of collapsing to BASIC', () => {
    const proInput = {
        id: 'pro-db-id',
        tier: 'PRO',
        monthlyPrice: 19.99,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 15,
        annualDiscountPercent: 35,
        biennialDiscountPercent: 45,
        aiDailyCredits: 1500,
    };
    const premiumInput = {
        id: 'premium-db-id',
        tier: 'PREMIUM',
        monthlyPrice: 39.99,
        monthlyDiscountPercent: 0,
        quarterlyDiscountPercent: 20,
        annualDiscountPercent: 49,
        biennialDiscountPercent: 55,
        aiDailyCredits: 4000,
    };

    const normalizedPro = normalizeSingleWorkspacePlan(proInput, false);
    const normalizedPremium = normalizeSingleWorkspacePlan(premiumInput, true);

    assert.equal(normalizedPro?.tier, 'PRO');
    assert.equal(normalizedPro?.monthlyPrice, 19.99);
    assert.equal(normalizedPro?.id, 'pro-db-id');

    assert.equal(normalizedPremium?.tier, 'PREMIUM');
    assert.equal(normalizedPremium?.monthlyPrice, 39.99);
    assert.equal(normalizedPremium?.id, 'premium-db-id');
});

test('calculatePlanCyclePricing produces strictly decreasing monthly rate across MONTHLY > QUARTERLY > YEARLY > BIENNIAL', () => {
    const catalog = normalizeWorkspacePlansCatalog(FALLBACK_WORKSPACE_PLANS, false);

    for (const plan of catalog) {
        const m = calculatePlanCyclePricing(plan, 'MONTHLY');
        const q = calculatePlanCyclePricing(plan, 'QUARTERLY');
        const y = calculatePlanCyclePricing(plan, 'YEARLY');
        const b = calculatePlanCyclePricing(plan, 'BIENNIAL');

        assert.equal(m.discountPercent, 0);
        assert.equal(m.effectiveMonthlyUsd, plan.monthlyPrice);
        assert.ok(m.effectiveMonthlyUsd > q.effectiveMonthlyUsd);
        assert.ok(q.effectiveMonthlyUsd > y.effectiveMonthlyUsd);
        assert.ok(y.effectiveMonthlyUsd > b.effectiveMonthlyUsd);
        assert.equal(q.totalUsd, Number((q.effectiveMonthlyUsd * 3).toFixed(2)));
        assert.equal(y.totalUsd, Number((y.effectiveMonthlyUsd * 12).toFixed(2)));
        assert.equal(b.totalUsd, Number((b.effectiveMonthlyUsd * 24).toFixed(2)));
    }

    const [basic, pro, premium] = catalog;
    assert.equal(calculatePlanCyclePricing(basic, 'MONTHLY').totalUsd, 2.99);
    assert.equal(calculatePlanCyclePricing(basic, 'QUARTERLY').totalUsd, 8.07);
    assert.equal(calculatePlanCyclePricing(basic, 'YEARLY').totalUsd, 26.88);
    assert.equal(calculatePlanCyclePricing(basic, 'BIENNIAL').totalUsd, 50.16);

    assert.equal(calculatePlanCyclePricing(pro, 'MONTHLY').totalUsd, 19.99);
    assert.equal(calculatePlanCyclePricing(pro, 'QUARTERLY').totalUsd, 50.97);
    assert.equal(calculatePlanCyclePricing(pro, 'YEARLY').totalUsd, 155.88);
    assert.equal(calculatePlanCyclePricing(pro, 'BIENNIAL').totalUsd, 263.76);

    assert.equal(calculatePlanCyclePricing(premium, 'MONTHLY').totalUsd, 39.99);
    assert.equal(calculatePlanCyclePricing(premium, 'QUARTERLY').totalUsd, 95.97);
    assert.equal(calculatePlanCyclePricing(premium, 'YEARLY').totalUsd, 244.68);
    assert.equal(calculatePlanCyclePricing(premium, 'BIENNIAL').totalUsd, 432.0);
});

test('auto-normalizes legacy inverted discounts (20% monthly > quarterly) and computes dynamic max cycle discounts', () => {
    const legacyRaw = {
        id: 'old-pro',
        tier: 'PRO',
        monthlyPrice: 19.99,
        monthlyDiscountPercent: 20,
        quarterlyDiscountPercent: 9,
        annualDiscountPercent: 35,
        biennialDiscountPercent: 44,
    };

    const healed = normalizeSingleWorkspacePlan(legacyRaw, false)!;
    assert.equal(healed.monthlyDiscountPercent, 0);
    assert.equal(healed.quarterlyDiscountPercent, 15);

    const catalog = normalizeWorkspacePlansCatalog(FALLBACK_WORKSPACE_PLANS, false);
    assert.deepEqual(getMaxDiscountForCycle(catalog, 'MONTHLY'), { max: 0, uniform: true });
    assert.deepEqual(getMaxDiscountForCycle(catalog, 'QUARTERLY'), { max: 20, uniform: false });
    assert.deepEqual(getMaxDiscountForCycle(catalog, 'YEARLY'), { max: 49, uniform: false });
    assert.deepEqual(getMaxDiscountForCycle(catalog, 'BIENNIAL'), { max: 55, uniform: false });
});
