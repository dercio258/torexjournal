import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Lock, Calendar } from 'lucide-react';
import api from '../../api';

export const AdminLogin = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    // Initialize date with today in DD/MM/YYYY format if desired, or let user type
    const [date, setDate] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const res = await api.post('/admin/auth/login', {
                email,
                pass: password, // Backend expects 'pass'
                date
            });

            if (res.data.success) {
                // Store generic admin token
                localStorage.setItem('adminToken', res.data.token);
                // Navigate to dashboard (to be created)
                navigate('/admin/dashboard');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || 'Login falhou. Verifique credenciais e data.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-8 border-slate-800 bg-slate-900/50">
                <div className="text-center mb-8">
                    <div className="inline-flex p-3 bg-red-500/10 rounded-xl mb-4">
                        <Lock className="w-8 h-8 text-red-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Acesso Administrativo</h1>
                    <p className="text-slate-400 text-sm mt-2">Área restrita</p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center">
                        {error}
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 transition-colors"
                            placeholder="admin@example.com"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Senha</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 transition-colors"
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">
                            Data de Hoje (DD/MM/AAAA)
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 transition-colors pl-10"
                                placeholder="Ex: 15/02/2026"
                                required
                            />
                            <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Verificação de segurança adicional.</p>
                    </div>

                    <Button
                        variant="primary"
                        className="w-full bg-red-600 hover:bg-red-700 text-white mt-4"
                        isLoading={isLoading}
                        type="submit"
                    >
                        Entrar
                    </Button>
                </form>
            </Card>
        </div>
    );
};
