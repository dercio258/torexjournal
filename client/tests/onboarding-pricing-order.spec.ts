import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthenticatedShellView } from '../src/lib/planGate';

test('resolveAuthenticatedShellView presents onboarding before pricing modal for newly verified users', () => {
    // 1. Loading until auth profile and live subscription check settle
    assert.equal(
        resolveAuthenticatedShellView({
            isLoading: true,
            hasUser: false,
            subChecked: false,
            isUnlocked: false,
            onboardingCompleted: false,
        }),
        'loading',
    );

    // 2. Newly verified FREE user (onboardingCompleted === false) MUST go to onboarding FIRST
    assert.equal(
        resolveAuthenticatedShellView({
            isLoading: false,
            hasUser: true,
            subChecked: true,
            isUnlocked: false,
            onboardingCompleted: false,
        }),
        'onboarding',
    );

    // 3. After finishing onboarding (onboardingCompleted === true), show pricing modal
    assert.equal(
        resolveAuthenticatedShellView({
            isLoading: false,
            hasUser: true,
            subChecked: true,
            isUnlocked: false,
            onboardingCompleted: true,
        }),
        'pricing',
    );

    // 4. Once trial or paid plan is active, enter workspace
    assert.equal(
        resolveAuthenticatedShellView({
            isLoading: false,
            hasUser: true,
            subChecked: true,
            isUnlocked: true,
            onboardingCompleted: true,
        }),
        'workspace',
    );
});
