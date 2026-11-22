import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useLocale } from '../context/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { trackConversion } from '../lib/tracking';
import api from '../api';

export const SubscriptionSuccess = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { locale } = useLocale();
    const { refreshProfile } = useAuth();
    const isEn = locale === 'en';
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

    useEffect(() => {
        let cancelled = false;
        const subscriptionId = searchParams.get('subscription_id');
        const paymentStatusParam = (searchParams.get('payment_status') || '').toLowerCase();

        const verifyOutcome = async () => {
            if (paymentStatusParam === 'failed' || paymentStatusParam === 'cancelled') {
                if (!cancelled) setStatus('error');
                return;
            }

            if (paymentStatusParam === 'active' || location.state?.method || location.state?.success) {
                void refreshProfile().catch(() => {});
                if (!cancelled) {
                    setStatus('success');
                    trackConversion('purchase', {
                        metadata: {
                            subscriptionId: subscriptionId || undefined,
                            method: location.state?.method || 'card',
                        },
                    });
                }
                return;
            }

            if (subscriptionId) {
                try {
                    await api.post(`/subscription/check-status/${encodeURIComponent(subscriptionId)}`).catch(() => {});
                    const statusRes = await api.get('/subscription/status');
                    if (cancelled) return;
                    if (statusRes.data?.hasActive) {
                        void refreshProfile().catch(() => {});
                        setStatus('success');
                        trackConversion('purchase', {
                            metadata: {
                                subscriptionId,
                                method: 'card',
                            },
                        });
                        return;
                    }
                } catch {
                    // Fall through to error state when subscription cannot be confirmed active
                }
            }

            if (!cancelled) setStatus('error');
        };

        void verifyOutcome();
        return () => {
            cancelled = true;
        };
    }, [searchParams, location, refreshProfile]);

    return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-surface border border-line rounded-2xl p-8 text-center">
                {status === 'loading' && (
                    <>
                        <Loader2 className="w-16 h-16 text-indigo-500 animate-spin mx-auto mb-6" />
                        <h2 className="text-2xl font-bold text-fg mb-2">
                            {isEn ? 'Confirming...' : 'Processando...'}
                        </h2>
                        <p className="text-fg-muted">
                            {isEn
                                ? 'Please wait while we verify your subscription.'
                                : 'Aguarde enquanto confirmamos sua assinatura.'}
                        </p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-10 h-10 text-emerald-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-fg mb-2">
                            {isEn ? 'Subscription Active!' : 'Assinatura Confirmada!'}
                        </h2>
                        <p className="text-fg-muted mb-8">
                            {isEn
                                ? 'Your plan is now live. Full workspace access is unlocked.'
                                : 'Sua assinatura foi criada com sucesso. Seu acesso será liberado em instantes.'}
                        </p>
                        <Button variant="primary" onClick={() => navigate('/dashboard')} className="w-full">
                            {isEn ? 'Go to Dashboard' : 'Ir para Dashboard'}
                        </Button>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertCircle className="w-10 h-10 text-rose-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-fg mb-2">
                            {isEn ? 'Verification Failed' : 'Algo deu errado'}
                        </h2>
                        <p className="text-fg-muted mb-8">
                            {isEn
                                ? 'We could not verify your subscription details.'
                                : 'Não foi possível confirmar os detalhes da assinatura.'}
                        </p>
                        <Button variant="secondary" onClick={() => navigate('/dashboard?plans=1')} className="w-full">
                            {isEn ? 'Back to Plans' : 'Voltar'}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};
