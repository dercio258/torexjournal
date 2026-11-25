export const PENDING_VERIFICATION_STORAGE_KEY = 'torex_pending_verification';

export interface PendingVerificationState {
    verificationToken: string;
    emailMasked: string;
    email?: string;
    returnTo?: string | null;
    fromLogin?: boolean;
    codeSent?: boolean;
    savedAt?: number;
}

export function savePendingVerification(state: PendingVerificationState): void {
    const payload: PendingVerificationState = {
        verificationToken: state.verificationToken,
        emailMasked: state.emailMasked,
        ...(state.returnTo ? { returnTo: state.returnTo } : {}),
        ...(state.fromLogin ? { fromLogin: true } : {}),
        ...(state.codeSent !== undefined ? { codeSent: state.codeSent } : {}),
        savedAt: Date.now(),
    };
    const serialized = JSON.stringify(payload);
    try {
        sessionStorage.setItem(PENDING_VERIFICATION_STORAGE_KEY, serialized);
    } catch {
        // Ignore storage quota errors
    }
    try {
        localStorage.setItem(PENDING_VERIFICATION_STORAGE_KEY, serialized);
    } catch {
        // Ignore storage quota errors
    }
}

export function readPendingVerification(
    routeState?: unknown,
): PendingVerificationState | null {
    const stateCandidate = (routeState as { pendingVerification?: unknown } | null)
        ?.pendingVerification as PendingVerificationState | undefined;
    if (stateCandidate?.verificationToken) {
        return stateCandidate;
    }

    for (const storage of [
        typeof sessionStorage !== 'undefined' ? sessionStorage : null,
        typeof localStorage !== 'undefined' ? localStorage : null,
    ]) {
        if (!storage) continue;
        try {
            const raw = storage.getItem(PENDING_VERIFICATION_STORAGE_KEY);
            if (!raw) continue;
            const parsed = JSON.parse(raw) as PendingVerificationState;
            if (parsed?.verificationToken) {
                return parsed;
            }
        } catch {
            // Ignore storage/parse errors
        }
    }
    return null;
}

export function clearPendingVerification(): void {
    try {
        sessionStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
    } catch {
        // Ignore storage errors
    }
    try {
        localStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
    } catch {
        // Ignore storage errors
    }
}
