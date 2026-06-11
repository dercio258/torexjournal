import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const SubscriptionSuccess = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

    useEffect(() => {
        const subscriptionId = searchParams.get('subscription_id');
        // Show success if query param exists OR if navigated with location state
        if (subscriptionId || location.state?.method || location.state?.success) {
            setStatus('success');
        } else {
            setStatus('error');
        }
    }, [searchParams, location]);

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                {status === 'loading' && (
                    <>
                        <Loader2 className="w-16 h-16 text-indigo-500 animate-spin mx-auto mb-6" />
                        <h2 className="text-2xl font-bold text-white mb-2">Processando...</h2>
                        <p className="text-slate-400">Aguarde enquanto confirmamos sua assinatura.</p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-10 h-10 text-emerald-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Assinatura Confirmada!</h2>
                        <p className="text-slate-400 mb-8">
                            Sua assinatura foi criada com sucesso. Seu acesso será liberado em instantes.
                        </p>
                        <Button variant="primary" onClick={() => navigate('/dashboard')} className="w-full">
                            Ir para Dashboard
                        </Button>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-10 h-10 text-rose-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Algo deu errado</h2>
                        <p className="text-slate-400 mb-8">
                            Não foi possível confirmar os detalhes da assinatura.
                        </p>
                        <Button variant="secondary" onClick={() => navigate('/pricing')} className="w-full">
                            Voltar
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};
