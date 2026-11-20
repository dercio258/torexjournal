import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Phone, CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../api';

export const CompleteProfile = () => {
    const { refreshProfile } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const navigate = useNavigate();
    const [whatsapp, setWhatsapp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await api.put('/auth/contact', { whatsapp });
            await refreshProfile().catch(() => null);

            setSuccess(true);
            setTimeout(() => {
                // OnboardingSurvey runs automatically inside MainLayout when onboardingCompleted === false
                navigate('/dashboard', { replace: true });
            }, 1500);
        } catch (err: any) {
            setError(
                err.response?.data?.message ||
                    (isEn ? 'Unable to update contact details' : 'Erro ao atualizar contacto')
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-2xl space-y-6">
                <div className="space-y-2 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-3 bg-emerald-500/10 rounded-full">
                            <Phone className="w-8 h-8 text-emerald-500" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-fg tracking-tight">
                        {isEn ? 'Complete Setup' : 'Finalizar Registo'}
                    </h2>
                    <p className="text-fg-muted text-sm">
                        {isEn
                            ? 'Add your mobile contact number to personalize your security and regional preferences.'
                            : 'Informe o seu contacto móvel com indicativo para completar o registo e receber alertas por E-mail e no App.'}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center gap-3 text-danger-fg text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-accent-fg text-sm">
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                            {isEn
                                ? 'Contact saved successfully! Redirecting...'
                                : 'Contacto guardado com sucesso! Redirecionando...'}
                        </div>
                    )}

                    <div className="space-y-4">
                        <Input
                            label={isEn ? 'Mobile Phone (with country code)' : 'Contacto Móvel (com indicativo do país)'}
                            placeholder={isEn ? '+1 555 019 4820' : '+258 84 123 4567'}
                            value={whatsapp}
                            onChange={(e) => setWhatsapp(e.target.value)}
                            required
                        />
                    </div>

                    <Button
                        type="submit"
                        variant="gradient"
                        className="w-full h-11 text-base"
                        isLoading={loading}
                        disabled={success}
                    >
                        {isEn ? 'Complete Setup' : 'Concluir Registo'}
                    </Button>
                </form>
            </Card>
        </div>
    );
};
