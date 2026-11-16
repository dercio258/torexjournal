import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    BehaviorMlBadge,
    BEHAVIOR_PATTERN_LABELS,
    extractTradeBehaviorFlags,
    formatBehaviorPatternLabel,
    type TradeBehaviorFeedbackInfo,
    type TradeBehaviorMlInfo,
} from '../src/components/trades/BehaviorMlBadge.tsx';

test('extractTradeBehaviorFlags parses qualityFlags and top-level ML/feedback metadata', () => {
    const ml: TradeBehaviorMlInfo = {
        anomalyScore: 84.5,
        riskLevel: 'HIGH',
        activeFlags: ['revenge_trading'],
    };
    const fb: TradeBehaviorFeedbackInfo = {
        verdict: 'CONFIRM',
        correctedFlags: ['revenge_trading'],
    };

    const fromQf = extractTradeBehaviorFlags({
        qualityFlags: { behavioralMl: ml, behavioralFeedback: fb },
    });
    assert.deepEqual(fromQf.behavioralMl, ml);
    assert.deepEqual(fromQf.behavioralFeedback, fb);

    const fromTop = extractTradeBehaviorFlags({
        behavioralMl: ml,
        behavioralFeedback: { verdict: 'FALSE_POSITIVE' },
    });
    assert.deepEqual(fromTop.behavioralMl, ml);
    assert.equal(fromTop.behavioralFeedback?.verdict, 'FALSE_POSITIVE');

    const invalid = extractTradeBehaviorFlags({
        qualityFlags: {
            behavioralMl: { anomalyScore: 10 },
            behavioralFeedback: { verdict: 'UNKNOWN' },
        },
    });
    assert.equal(invalid.behavioralMl, null);
    assert.equal(invalid.behavioralFeedback, null);
});

test('formatBehaviorPatternLabel translates all 6 behavior patterns in PT and EN', () => {
    const keys = Object.keys(BEHAVIOR_PATTERN_LABELS);
    assert.equal(keys.length, 6);

    for (const key of keys) {
        const ptLong = formatBehaviorPatternLabel(key, false, false);
        const enLong = formatBehaviorPatternLabel(key, true, false);
        const ptShort = formatBehaviorPatternLabel(key, false, true);
        const enShort = formatBehaviorPatternLabel(key, true, true);
        assert.ok(ptLong.length > 0 && enLong.length > 0);
        assert.ok(ptShort.length > 0 && enShort.length > 0);
    }

    assert.equal(formatBehaviorPatternLabel('revenge_trading', false, false), 'Revenge Trading');
    assert.equal(formatBehaviorPatternLabel('strategy_session_drift', true, true), 'Drift');
    assert.equal(formatBehaviorPatternLabel('unknown_flag', false, false), 'unknown_flag');
});

test('BehaviorMlBadge renders LOW, CRITICAL+CONFIRM, and FALSE_POSITIVE states accurately', () => {
    assert.equal(renderToStaticMarkup(React.createElement(BehaviorMlBadge, { ml: null, hideWhenClean: true })), '');

    const lowMl: TradeBehaviorMlInfo = {
        anomalyScore: 14.2,
        riskLevel: 'LOW',
        activeFlags: [],
    };
    assert.equal(renderToStaticMarkup(React.createElement(BehaviorMlBadge, { ml: lowMl, hideWhenClean: true })), '');

    const lowVisibleHtml = renderToStaticMarkup(
        React.createElement(BehaviorMlBadge, {
            ml: lowMl,
            compact: false,
            hideWhenClean: false,
            isEn: false,
        }),
    );
    assert.match(lowVisibleHtml, /Disciplinado \(14\)/);

    const critMl: TradeBehaviorMlInfo = {
        anomalyScore: 89.4,
        riskLevel: 'CRITICAL',
        activeFlags: ['revenge_trading'],
        reasons: ['Reentrada rápida após sequência negativa.'],
    };
    const critConfirmHtml = renderToStaticMarkup(
        React.createElement(BehaviorMlBadge, {
            ml: critMl,
            feedback: { verdict: 'CONFIRM' },
            compact: false,
            hideWhenClean: true,
            isEn: false,
        }),
    );
    assert.match(critConfirmHtml, /Revenge Trading · 89\/100/);
    assert.match(critConfirmHtml, /text-danger-fg/);
    assert.match(critConfirmHtml, /aria-label="Confirmado pelo trader"/);

    assert.equal(
        renderToStaticMarkup(
            React.createElement(BehaviorMlBadge, {
                ml: critMl,
                feedback: { verdict: 'FALSE_POSITIVE' },
                hideWhenClean: true,
            }),
        ),
        '',
    );

    const falsePosVisibleHtml = renderToStaticMarkup(
        React.createElement(BehaviorMlBadge, {
            ml: critMl,
            feedback: { verdict: 'FALSE_POSITIVE' },
            hideWhenClean: false,
            isEn: false,
        }),
    );
    assert.match(falsePosVisibleHtml, /Falso Pos\./);
    assert.match(falsePosVisibleHtml, /line-through/);
});
