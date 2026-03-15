// import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { LogOut, Settings, Users, CreditCard } from 'lucide-react';

export const AdminDashboard = () => {
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        navigate('/admin');
    };

    return (
        <div className="min-h-screen bg-slate-950 p-6">
            <div className="max-w-6xl mx-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-white">Painel Administrativo</h1>
                        <p className="text-slate-400">Torex Journal - Gestão Interna</p>
                    </div>
                    <Button variant="secondary" onClick={handleLogout} className="flex items-center gap-2">
                        <LogOut className="w-4 h-4" /> Sair
                    </Button>
                </header>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Plan Management Card */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-indigo-500/10 rounded-lg">
                                <Settings className="w-6 h-6 text-indigo-500" />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">Gestão de Planos</h3>
                        <p className="text-slate-400 text-sm mb-6">
                            Configure os níveis de acesso e preços do sistema (M-Pesa, e-Mola, Cartão).
                        </p>
                        <Link to="/admin/plans">
                            <Button variant="primary" className="w-full">
                                Gerenciar Planos
                            </Button>
                        </Link>
                    </Card>

                    {/* Finance Card */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-emerald-500/10 rounded-lg">
                                <CreditCard className="w-6 h-6 text-emerald-500" />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">Financeiro</h3>
                        <p className="text-slate-400 text-sm mb-6">
                            Visualize relatórios de assinaturas e pagamentos processados via Debito.
                        </p>
                        <Link to="/admin/finance">
                            <Button variant="secondary" className="w-full">
                                Ver Relatórios
                            </Button>
                        </Link>
                    </Card>

                    {/* User Management */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-blue-500/10 rounded-lg">
                                <Users className="w-6 h-6 text-blue-500" />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">Usuários</h3>
                        <p className="text-slate-400 text-sm mb-6">
                            Visualize e gerencie as contas dos usuários do sistema.
                        </p>
                        <Link to="/admin/users">
                            <Button variant="secondary" className="w-full">
                                Ver Usuários
                            </Button>
                        </Link>
                    </Card>
                </div>
            </div>
        </div>
    );
};

