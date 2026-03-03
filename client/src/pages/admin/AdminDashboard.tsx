import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { RefreshCw, LogOut, Settings } from 'lucide-react';
import api from '../../api';

export const AdminDashboard = () => {
    const navigate = useNavigate();
    const [isSyncing, setIsSyncing] = useState(false);

    // Check auth simply
    const token = localStorage.getItem('adminToken');
    if (!token) {
        // Redirect if no token (Basic protection, backend validates extensively)
        // In real app, verify token validity
        // navigate('/admin');
    }

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        navigate('/admin');
    };

    const syncPlans = async () => {
        setIsSyncing(true);
        try {
            await api.post('/api/subscription/plans');
            alert('Planos sincronizados com sucesso com o PayPal!');
        } catch (error) {
            console.error(error);
            alert('Erro ao sincronizar planos.');
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 p-6">
            <div className="max-w-6xl mx-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-white">Painel Administrativo</h1>
                        <p className="text-slate-400">Trading Cossa - Gestão Interna</p>
                    </div>
                    <Button variant="secondary" onClick={handleLogout} className="flex items-center gap-2">
                        <LogOut className="w-4 h-4" /> Sair
                    </Button>
                </header>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Subscription Management Card */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-indigo-500/10 rounded-lg">
                                <Settings className="w-6 h-6 text-indigo-500" />
                            </div>
                            <span className="bg-green-500/10 text-green-500 text-xs font-bold px-2 py-1 rounded">Ativo</span>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">Assinaturas PayPal</h3>
                        <p className="text-slate-400 text-sm mb-6">
                            Gerencie a sincronização dos planos de assinatura com o PayPal.
                        </p>
                        <Button
                            variant="primary"
                            onClick={syncPlans}
                            isLoading={isSyncing}
                            className="w-full"
                        >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Sincronizar Planos
                        </Button>
                    </Card>

                    {/* Placeholder for future User Management */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50 opacity-50 cursor-not-allowed">
                        <div className="mb-4">
                            <h3 className="text-lg font-bold text-white mb-2">Gestão de Usuários</h3>
                            <p className="text-slate-400 text-sm">Em breve...</p>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};
