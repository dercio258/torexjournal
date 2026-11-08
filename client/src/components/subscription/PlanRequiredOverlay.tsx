import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ShieldAlert, Rocket, ArrowRight } from 'lucide-react';

export const PlanRequiredOverlay = () => {
    const navigate = useNavigate();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-canvas/60 backdrop-blur-sm">
            <Card className="max-w-md w-full p-8 border-indigo-500/50 bg-surface shadow-2xl animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-6 border border-indigo-500/20">
                        <ShieldAlert className="w-8 h-8 text-indigo-400" />
                    </div>

                    <h2 className="text-2xl font-bold text-fg mb-2">Plano de Acesso Necessário</h2>
                    <p className="text-fg-muted mb-8">
                        Para acessar as ferramentas de análise, diário avançado e a rede social Torex, você precisa ativar um plano de subscrição.
                    </p>

                    <div className="grid gap-3 w-full">
                        <Button
                            variant="gradient"
                            className="w-full py-6 text-lg group"
                            onClick={() => navigate('/pricing')}
                        >
                            Escolher meu Plano
                            <Rocket className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                        </Button>

                        <Button
                            variant="secondary"
                            className="w-full py-6 border-line-strong text-fg/80 hover:bg-surface-2"
                            onClick={() => navigate('/pricing')}
                        >
                            Ver Planos Disponíveis
                            <ArrowRight className="w-5 h-5 ml-2" />
                        </Button>
                    </div>

                    <p className="mt-6 text-xs text-fg-subtle">
                        Já possui um plano? Se o seu pagamento foi recente, pode levar alguns minutos para atualizar.
                    </p>
                </div>
            </Card>
        </div>
    );
};
