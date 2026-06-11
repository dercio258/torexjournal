import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { DollarSign, Users, Award, TrendingUp, CreditCard, PieChart, Calendar } from 'lucide-react';
import api from '../../api';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { Line, Pie, Doughnut } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

export const AdminFinance = () => {
    const [stats, setStats] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [dateFilter, setDateFilter] = useState<'this_month' | 'last_3_months' | 'all_time'>('this_month');

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

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    const cards = [
        {
            label: 'Receita Est. MZN',
            value: `MT ${stats?.estimatedMonthlyRevenueMZN?.toFixed(2) || '0.00'}`,
            icon: DollarSign,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            description: 'M-Pesa, e-Mola e Cartões'
        },
        {
            label: 'Receita Est. ZAR',
            value: `R ${stats?.estimatedMonthlyRevenueZAR?.toFixed(2) || '0.00'}`,
            icon: DollarSign,
            color: 'text-sky-500',
            bg: 'bg-sky-500/10',
            description: 'PayFast'
        },
        {
            label: 'Assinantes Ativos',
            value: stats?.activeSubscribers || 0,
            icon: Award,
            color: 'text-indigo-500',
            bg: 'bg-indigo-500/10',
            description: 'Assinaturas vigentes'
        },
        {
            label: 'Total de Usuários',
            value: stats?.totalUsers || 0,
            icon: Users,
            color: 'text-blue-500',
            bg: 'bg-blue-500/10',
            description: 'Contas cadastradas'
        }
    ];

    // Filter daily metrics based on dateFilter
    const allDates = Object.keys(stats?.dailyMetrics || {}).sort();
    
    // Date filtering logic
    const filteredDates = allDates.filter(d => {
        if (dateFilter === 'all_time') return true;
        
        const dateObj = new Date(d);
        const today = new Date('2026-06-11'); // Anchored to current system date
        
        if (dateFilter === 'this_month') {
            return dateObj.getFullYear() === today.getFullYear() && dateObj.getMonth() === today.getMonth();
        }
        
        if (dateFilter === 'last_3_months') {
            const diffTime = Math.abs(today.getTime() - dateObj.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays <= 90;
        }
        
        return true;
    });

    const chartLabels = filteredDates.length > 0 ? filteredDates.map(d => {
        const parts = d.split('-');
        return `${parts[2]}/${parts[1]}`; // DD/MM format
    }) : ['Sem dados'];

    const newSubsData = filteredDates.length > 0 ? filteredDates.map(d => stats.dailyMetrics[d].newSubscriptions) : [0];
    const renewalsData = filteredDates.length > 0 ? filteredDates.map(d => stats.dailyMetrics[d].renewals) : [0];
    const upgradesData = filteredDates.length > 0 ? filteredDates.map(d => stats.dailyMetrics[d].upgrades) : [0];
    const userGrowthData = filteredDates.length > 0 ? filteredDates.map(d => stats.dailyMetrics[d].totalUsers) : [0];

    // ChartJS common configurations
    const baseChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                backgroundColor: '#0f172a',
                titleColor: '#94a3b8',
                bodyColor: '#ffffff',
                borderColor: '#334155',
                borderWidth: 1,
                padding: 10,
                displayColors: false
            }
        },
        scales: {
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    color: '#64748b',
                    font: { size: 10 }
                }
            },
            y: {
                grid: {
                    color: 'rgba(51, 65, 85, 0.2)'
                },
                ticks: {
                    color: '#64748b',
                    font: { size: 10 },
                    precision: 0
                }
            }
        }
    };

    // Subscriptions Line Chart
    const newSubsChartData = {
        labels: chartLabels,
        datasets: [{
            data: newSubsData,
            borderColor: '#10b981', // Emerald
            backgroundColor: 'rgba(16, 185, 129, 0.05)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: true
        }]
    };

    // Renewals Line Chart
    const renewalsChartData = {
        labels: chartLabels,
        datasets: [{
            data: renewalsData,
            borderColor: '#f59e0b', // Amber
            backgroundColor: 'rgba(245, 158, 11, 0.05)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: true
        }]
    };

    // Upgrades Line Chart
    const upgradesChartData = {
        labels: chartLabels,
        datasets: [{
            data: upgradesData,
            borderColor: '#6366f1', // Indigo
            backgroundColor: 'rgba(99, 102, 241, 0.05)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: true
        }]
    };

    // User Growth Line Chart
    const userGrowthChartData = {
        labels: chartLabels,
        datasets: [{
            data: userGrowthData,
            borderColor: '#3b82f6', // Blue
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 2.5,
            pointRadius: 2,
            tension: 0.4,
            fill: true
        }]
    };

    // Payment Methods Pie Chart
    const paymentMethodsChartData = {
        labels: ['M-Pesa (MZN)', 'e-Mola (MZN)', 'Cartão (MZN)', 'PayFast (ZAR)'],
        datasets: [{
            data: [
                stats?.paymentMethods?.mpesa || 0,
                stats?.paymentMethods?.emola || 0,
                stats?.paymentMethods?.card || 0,
                stats?.paymentMethods?.payfast || 0
            ],
            backgroundColor: [
                '#e11d48', // Rose / Red (M-Pesa)
                '#0284c7', // Sky Blue (e-Mola)
                '#8b5cf6', // Violet (Cartão)
                '#f59e0b'  // Orange / Yellow (PayFast)
            ],
            borderWidth: 1,
            borderColor: '#0f172a'
        }]
    };

    // Attempts Statuses Doughnut Chart
    const statusesChartData = {
        labels: ['Concluídas', 'Canceladas', 'Pendentes'],
        datasets: [{
            data: [
                stats?.statuses?.active || 0,
                stats?.statuses?.cancelled || 0,
                stats?.statuses?.pending || 0
            ],
            backgroundColor: [
                '#10b981', // Emerald (Concluídas)
                '#ef4444', // Red (Canceladas)
                '#3b82f6'  // Blue (Pendentes)
            ],
            borderWidth: 1,
            borderColor: '#0f172a'
        }]
    };

    const pieOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'right' as const,
                labels: {
                    color: '#94a3b8',
                    font: { size: 11 },
                    boxWidth: 12
                }
            },
            tooltip: {
                backgroundColor: '#0f172a',
                borderColor: '#334155',
                borderWidth: 1
            }
        }
    };

    return (
        <div className="space-y-8 pb-12 animate-in fade-in duration-500">
            {/* Header section with Date Filter */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white">Financeiro & Métricas</h1>
                    <p className="text-slate-400 mt-1">Análise detalhada de faturamento, planos e crescimento de usuários.</p>
                </div>

                {/* Date Filter Selector */}
                <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 items-center">
                    <button
                        onClick={() => setDateFilter('this_month')}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                            dateFilter === 'this_month'
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        <Calendar size={14} />
                        Este Mês
                    </button>
                    <button
                        onClick={() => setDateFilter('last_3_months')}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                            dateFilter === 'last_3_months'
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        Últimos 3 Meses
                    </button>
                    <button
                        onClick={() => setDateFilter('all_time')}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                            dateFilter === 'all_time'
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        Tudo
                    </button>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {cards.map((card, idx) => {
                    const Icon = card.icon;
                    return (
                        <Card key={idx} className="p-6 border-slate-800 bg-slate-900/50 flex flex-col justify-between min-h-[120px]">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{card.label}</p>
                                    <h3 className="text-2xl font-black text-white mt-2 tracking-tight">{card.value}</h3>
                                </div>
                                <div className={`p-3 rounded-xl ${card.bg} flex-shrink-0`}>
                                    <Icon className={`w-6 h-6 ${card.color}`} />
                                </div>
                            </div>
                            <span className="text-[10px] text-slate-500 font-medium mt-3 border-t border-slate-800/60 pt-2 block">
                                {card.description}
                            </span>
                        </Card>
                    );
                })}
            </div>

            {/* Three line charts for Renewals, Subscriptions, Upgrades */}
            <div>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <TrendingUp className="text-indigo-400" size={20} />
                    Volume de Transações por Categoria
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Chart 1: New Subscriptions */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="mb-4">
                            <h3 className="text-white font-bold text-sm">Novas Subscrições</h3>
                            <p className="text-slate-500 text-xs">Novos cadastros de planos pagos</p>
                        </div>
                        <div className="h-56">
                            <Line options={baseChartOptions} data={newSubsChartData} />
                        </div>
                    </Card>

                    {/* Chart 2: Renewals */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="mb-4">
                            <h3 className="text-white font-bold text-sm">Renovações</h3>
                            <p className="text-slate-500 text-xs">Renovações automáticas ou manuais</p>
                        </div>
                        <div className="h-56">
                            <Line options={baseChartOptions} data={renewalsChartData} />
                        </div>
                    </Card>

                    {/* Chart 3: Upgrades */}
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <div className="mb-4">
                            <h3 className="text-white font-bold text-sm">Upgrades</h3>
                            <p className="text-slate-500 text-xs">Migração do plano Básico para PRO</p>
                        </div>
                        <div className="h-56">
                            <Line options={baseChartOptions} data={upgradesChartData} />
                        </div>
                    </Card>
                </div>
            </div>

            {/* Pie Charts & Status Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Pie Chart: Payment Methods */}
                <Card className="p-6 border-slate-800 bg-slate-900/50">
                    <div className="mb-4 flex items-center gap-2">
                        <CreditCard className="text-emerald-400" size={18} />
                        <h3 className="text-white font-bold text-sm">Métodos de Pagamento</h3>
                    </div>
                    <div className="h-64 relative flex items-center justify-center">
                        <Pie options={pieOptions} data={paymentMethodsChartData} />
                    </div>
                </Card>

                {/* Doughnut Chart: Subscription Attempts */}
                <Card className="p-6 border-slate-800 bg-slate-900/50">
                    <div className="mb-4 flex items-center gap-2">
                        <PieChart className="text-indigo-400" size={18} />
                        <h3 className="text-white font-bold text-sm">Status das Tentativas de Assinatura</h3>
                    </div>
                    <div className="h-64 relative flex items-center justify-center">
                        <Doughnut options={pieOptions} data={statusesChartData} />
                    </div>
                </Card>
            </div>

            {/* Growth Chart */}
            <Card className="p-6 border-slate-800 bg-slate-900/50">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-white font-bold text-sm">Crescimento Acumulado de Usuários</h3>
                        <p className="text-slate-500 text-xs">Curva acumulada de traders cadastrados</p>
                    </div>
                    <span className="text-xs text-indigo-400 font-bold bg-indigo-500/10 px-3 py-1 rounded-full">
                        Ativo
                    </span>
                </div>
                <div className="h-72">
                    <Line 
                        options={{
                            ...baseChartOptions,
                            plugins: {
                                ...baseChartOptions.plugins,
                                legend: { display: false }
                            }
                        }} 
                        data={userGrowthChartData} 
                    />
                </div>
            </Card>
        </div>
    );
};
