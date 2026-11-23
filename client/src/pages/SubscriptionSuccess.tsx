import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useLocale } from '../context/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { trackConversion } from '../lib/tracking';
import {
    buildCheckoutFailureUrl,
    computeAdaptivePollDelay,
    detectCallbackFailureFromSearch,
    parseRetryAfterHeader,
} from '../lib/paymentPolling';
import api from '../api';

export const SubscriptionSuccess = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { locale, localizeBrowserPath } = useLocale();
    const { refreshProfile } = useAuth();
    const isEn = locale === 'en';
    const [status, setStatus] = useState<'processing' | 'success'>('processing');
    const [retryingCheck, setRetryingCheck] = useState(false);

    const runVerification = useCallback(
        async (isCancelled: () => boolean, manualRetry = false) => {
            const subscriptionId =
                searchParams.get('subscription_id') || searchParams.get('reference') || '';
            const methodParam = searchParams.get('method') || location.state?.method || 'card';
            const tierParam = searchParams.get('tier') || '';
            const cycleParam = searchParams.get('cycle') || '';
            const callbackFailure = detectCallbackFailureFromSearch(searchParams);

            // Internal in-app transitions that already confirmed ACTIVE on the backend
            if (!manualRetry && location.state?.success === true && !callbackFailure.isFailed) {
                void refreshProfile().catch(() => {});
                if (!isCancelled()) {
                    setStatus('success');
                    trackConversion('purchase', {
                        metadata: {
                            subscriptionId: subscriptionId || undefined,
                            method: methodParam,
                        },
                    });
                }
                return;
            }

            const redirectToCheckoutWithFailure = (opts: {
                method?: string | null;
                tier?: string | null;
                cycle?: string | null;
                reason?: string | null;
            }) => {
                if (isCancelled()) return;
                navigate(
                    buildCheckoutFailureUrl({
                        localizePath: localizeBrowserPath,
                        subscriptionId: subscriptionId || undefined,
                        method: opts.method || methodParam,
                        tier: opts.tier || tierParam || undefined,
                        cycle: opts.cycle || cycleParam || undefined,
                        reason: opts.reason || callbackFailure.reason || 'failed',
                    }),
                    { replace: true },
                );
            };

            // NEVER trust URL params alone — always reconcile with backend check-status & subscription/status
            const maxAttempts = subscriptionId ? (callbackFailure.isFailed ? 1 : 6) : callbackFailure.isFailed ? 1 : 2;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (isCancelled()) return;
                let serverNextPollAfterMs: number | null = null;
                let retryAfterMs: number | null = null;

                try {
                    if (subscriptionId) {
                        const checkRes = await api.post(
                            `/subscription/check-status/${encodeURIComponent(subscriptionId)}`,
                            { force: attempt === 0 || manualRetry },
                        );
                        const data = checkRes.data || {};
                        const refStatus = String(data.status || '').toUpperCase();
                        serverNextPollAfterMs =
                            typeof data.nextPollAfterMs === 'number' ? data.nextPollAfterMs : null;

                        if (refStatus === 'ACTIVE' || refStatus === 'APPROVED') {
                            void refreshProfile().catch(() => {});
                            if (!isCancelled()) {
                                setStatus('success');
                                trackConversion('purchase', {
                                    metadata: {
                                        subscriptionId,
                                        method: data.paymentMethod || methodParam,
                                    },
                                });
                            }
                            return;
                        }

                        if (refStatus === 'EXPIRED' || refStatus === 'CANCELLED') {
                            redirectToCheckoutWithFailure({
                                method: data.paymentMethod || methodParam,
                                tier: data.tier || tierParam,
                                cycle: data.cycle || cycleParam,
                                reason:
                                    data.failureReason ||
                                    (refStatus === 'EXPIRED' ? 'expired' : 'failed'),
                            });
                            return;
                        }

                        if (callbackFailure.isFailed) {
                            redirectToCheckoutWithFailure({
                                method: data.paymentMethod || methodParam,
                                tier: data.tier || tierParam,
                                cycle: data.cycle || cycleParam,
                                reason: callbackFailure.reason || callbackFailure.statusCode || 'failed',
                            });
                            return;
                        }
                    } else {
                        const statusRes = await api.get('/subscription/status');
                        if (statusRes.data?.hasActive) {
                            void refreshProfile().catch(() => {});
                            if (!isCancelled()) {
                                setStatus('success');
                                trackConversion('purchase', {
                                    metadata: { method: methodParam },
                                });
                            }
                            return;
                        }
                        if (callbackFailure.isFailed) {
                            redirectToCheckoutWithFailure({
                                reason: callbackFailure.reason || callbackFailure.statusCode || 'failed',
                            });
                            return;
                        }
                    }
                } catch (err: any) {
                    retryAfterMs = parseRetryAfterHeader(err);
                }

                if (attempt < maxAttempts - 1) {
                    const waitMs = computeAdaptivePollDelay({
                        attempt,
                        method: methodParam,
                        serverNextPollAfterMs,
                        retryAfterMs,
                    });
                    await new Promise((r) => window.setTimeout(r, waitMs || 3500));
                }
            }

            if (!isCancelled()) {
                if (!subscriptionId) {
                    redirectToCheckoutWithFailure({
                        reason: callbackFailure.reason || 'missing_reference',
                    });
                    return;
                }
                setStatus('processing');
            }
        },
        [searchParams, location.state, refreshProfile, navigate, localizeBrowserPath],
    );

    useEffect(() => {
        let cancelled = false;
        void runVerification(() => cancelled, false);
        return () => {
            cancelled = true;
        };
    }, [runVerification]);

    const handleManualRecheck = async () => {
        if (retryingCheck) return;
        setRetryingCheck(true);
        try {
            await runVerification(() => false, true);
        } finally {
            setRetryingCheck(false);
        }
    };

    return (
        <div className="theme-light min-h-screen bg-white text-slate-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white border border-slate-200 shadow-xl rounded-2xl p-8 text-center">
                {status === 'processing' && (
                    <>
                        <Loader2 className="w-16 h-16 text-indigo-600 animate-spin mx-auto mb-6" />
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">
                            {isEn ? 'Payment Processing' : 'Pagamento em Processamento'}
                        </h2>
                        <p className="text-slate-600 mb-6 text-sm">
                            {isEn
                                ? 'We are awaiting final confirmation of your payment. Your plan will activate automatically once confirmed.'
                                : 'Estamos aguardando a confirmação final do seu pagamento. Seu plano será ativado automaticamente assim que confirmado.'}
                        </p>
                        <div className="space-y-2.5">
                            <Button
                                variant="primary"
                                onClick={() => void handleManualRecheck()}
                                disabled={retryingCheck}
                                className="w-full"
                            >
                                <span className="inline-flex items-center justify-center gap-2">
                                    <RefreshCw
                                        size={15}
                                        className={retryingCheck ? 'animate-spin' : ''}
                                    />
                                    <span>
                                        {isEn ? 'Check Status Again' : 'Verificar Confirmação Agora'}
                                    </span>
                                </span>
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => navigate(localizeBrowserPath('/checkout'))}
                                className="w-full"
                            >
                                {isEn ? 'Back to Checkout' : 'Voltar ao Checkout'}
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => navigate('/payments')}
                                className="w-full"
                            >
                                {isEn ? 'View Billing History' : 'Ver Histórico de Pagamentos'}
                            </Button>
                        </div>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="w-20 h-20 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-10 h-10 text-emerald-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">
                            {isEn ? 'Payment Confirmed!' : 'Pagamento Confirmado!'}
                        </h2>
                        <p className="text-slate-600 mb-8 text-sm">
                            {isEn
                                ? 'Your plan is now live. Full workspace access is unlocked.'
                                : 'Sua assinatura foi confirmada com sucesso. Seu acesso está liberado.'}
                        </p>
                        <Button
                            variant="primary"
                            onClick={() => navigate('/dashboard')}
                            className="w-full"
                        >
                            {isEn ? 'Go to Dashboard' : 'Ir para Dashboard'}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};
