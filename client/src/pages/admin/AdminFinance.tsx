import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { DollarSign, Users, Award } from 'lucide-react';
import api from '../../api';

export const AdminFinance = () => {
    const [stats, setStats] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const { data } = await api.get('/admin/stats');
                setStats(data);
            } catch (error) {
                console.error(error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchStats();
    }, []);

    if (isLoading) return <div className="text-white">Carregando...</div>;

    const cards = [
        {
            label: 'Receita Mensal Est.',
            value: `R$ ${stats?.estimatedMonthlyRevenue?.toFixed(2)}`,
            icon: DollarSign,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10'
        },
        {
            label: 'Assinantes Ativos',
            value: stats?.activeSubscribers,
            icon: Award,
            color: 'text-indigo-500',
            bg: 'bg-indigo-500/10'
        },
        {
            label: 'Total de Usuários',
            value: stats?.totalUsers,
            icon: Users,
            color: 'text-blue-500',
            bg: 'bg-blue-500/10'
        }
    ];

    return (
        <div>
            <h1 className="text-3xl font-bold text-white mb-6">Financeiro</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {cards.map((card, idx) => {
                    const Icon = card.icon;
                    return (
                        <Card key={idx} className="p-6 border-slate-800 bg-slate-900/50 flex items-center gap-4">
                            <div className={`p-4 rounded-xl ${card.bg}`}>
                                <Icon className={`w-8 h-8 ${card.color}`} />
                            </div>
                            <div>
                                <p className="text-slate-400 text-sm font-medium">{card.label}</p>
                                <h3 className="text-2xl font-bold text-white">{card.value}</h3>
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* Placeholder for charts */}
            <Card className="p-6 border-slate-800 bg-slate-900/50 h-96 flex items-center justify-center text-slate-500">
                Gráfico de Crescimento (Em Breve)
            </Card>
        </div>
    );
};
