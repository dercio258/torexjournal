import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Phone, CheckCircle2, AlertCircle } from 'lucide-react';
import axios from 'axios';

export const CompleteProfile = () => {
    const { user, token } = useAuth();
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
            const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:3000';
            await axios.put(`${backendUrl}/api/auth/contact`, { whatsapp }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setSuccess(true);
            setTimeout(() => {
                if (user?.onboardingCompleted) {
                    navigate('/dashboard');
                } else {
                    navigate('/onboarding');
                }
            }, 2000);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Erro ao atualizar contacto');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-2xl space-y-6">
                <div className="space-y-2 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-3 bg-emerald-500/10 rounded-full">
                            <Phone className="w-8 h-8 text-emerald-500" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-white tracking-tight">Finalizar Registo</h2>
                    <p className="text-slate-400 text-sm">
                        Precisamos do seu WhatsApp para enviar notificações importantes e bónus exclusivos.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center gap-3 text-rose-400 text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}
                    
                    {success && (
                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-400 text-sm">
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                            Contacto guardado com sucesso! Redirecionando...
                        </div>
                    )}

                    <div className="space-y-4">
                        <Input
                            label="WhatsApp (com código do país)"
                            placeholder="+258 84 123 4567"
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
                        Concluir Registo
                    </Button>
                </form>
            </Card>
        </div>
    );
};
