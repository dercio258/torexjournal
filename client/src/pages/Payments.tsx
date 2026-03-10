
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import {
    RefreshCw,
    Inbox,
    AlertCircle,
    CreditCard,
    Wallet,
    ShieldCheck,
    Clock,
    CheckCircle2,
    XCircle,
    ArrowUpRight,
    Download
} from 'lucide-react';
import api from '../api';

// --- Types ---
interface Payment {
    id: string;
    dataHora: string;
    status: string;
    produto: string;
    amount?: number;
    method?: string;
}

export const Payments = () => {
    const navigate = useNavigate();
    const [payments, setPayments] = useState<Payment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [user, setUser] = useState<any>(null);

    useEffect(() => {
        fetchPayments();
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const res = await api.get('/auth/profile');
            setUser(res.data);
        } catch (err) {
            console.error('Error fetching profile:', err);
        }
    };

    const fetchPayments = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/api/payments');
            if (Array.isArray(res.data)) {
                const mappedPayments = res.data.map((p: any) => ({
                    id: p.vendaId || p.id,
                    dataHora: p.dataHora,
                    status: p.status,
                    produto: p.produto,
                    amount: Number(p.preco),
                    method: 'Cartão de Débito/Crédito'
                }));
                setPayments(mappedPayments);
            }
        } catch (err) {
            console.error('Error fetching payments:', err);
            setPayments([]);
        } finally {
            setIsLoading(false);
        }
    };

    const calculateDaysRemaining = (expiryDate: string) => {
        if (!expiryDate) return 0;
        const today = new Date();
        const expiry = new Date(expiryDate);
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    };

    const getStatusConfig = (status: string) => {
        const s = status?.toLowerCase() || 'pending';
        if (['aprovada', 'approved', 'succeeded', 'paid', 'active'].includes(s)) {
            return { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: CheckCircle2 };
        }
        if (['falha', 'failed', 'declined', 'expired'].includes(s)) {
            return { color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', icon: XCircle };
        }
        return { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Clock };
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
                        <Wallet className="text-indigo-400" /> Carteira & Assinatura
                    </h1>
                    <p className="text-slate-400">Gerencie seu plano e acompanhe seu histórico de faturamento.</p>
                </div>
                <div className="flex gap-3">
                    <Button
                        variant="secondary"
                        onClick={fetchPayments}
                        isLoading={isLoading}
                        icon={<RefreshCw className="w-4 h-4" />}
                    >
                        Atualizar Histórico
                    </Button>
                </div>
            </div>

            {/* Simple Active Plan Card */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-xl">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-6">
                        <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                            <ShieldCheck className="text-indigo-400 w-12 h-12" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${user?.tier === 'PREMIUM' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                                    Plano {user?.tier || 'FREE'}
                                </span>
                            </div>
                            <h2 className="text-3xl font-bold text-white uppercase tracking-tight">
                                {user?.tier === 'PREMIUM' ? 'Analista Premium' : user?.tier === 'BASIC' ? 'Traders Básico' : 'Nenhum Plano Ativo'}
                            </h2>
                            <p className="text-slate-400 text-sm mt-1">
                                {user?.subscription
                                    ? `Ativo desde ${new Date(user.subscription.createdAt).toLocaleDateString('pt-BR')}`
                                    : 'Acesse o mercado com as melhores ferramentas.'}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 w-full md:w-auto">
                        {user?.subscription && (
                            <div className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800 flex-1 min-w-[180px]">
                                <div className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Vencimento</div>
                                <div className="text-xl font-mono text-white">
                                    {new Date(user.subscription.expiresAt).toLocaleDateString('pt-BR')}
                                </div>
                                <div className="text-xs text-indigo-400 font-bold mt-1">
                                    Faltam {calculateDaysRemaining(user.subscription.expiresAt)} dias
                                </div>
                            </div>
                        )}
                        <Button
                            variant="primary"
                            className="h-full px-8 py-4 rounded-2xl shadow-lg shadow-indigo-500/10"
                            onClick={() => navigate('/pricing')}
                        >
                            {user?.tier === 'PREMIUM' ? 'Gerenciar Plano' : 'Fazer Upgrade'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Transaction History */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Clock className="text-slate-400" size={20} />
                        Histórico de Transações
                    </h3>
                    <div className="flex gap-2">
                        <button className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
                            <Download size={18} />
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-950/30 text-xs text-slate-500 uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-6">Data</th>
                                <th className="p-6">Descrição</th>
                                <th className="p-6">Método</th>
                                <th className="p-6 text-center">Status</th>
                                <th className="p-6 text-right">Valor</th>
                                <th className="p-6"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 text-sm">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mb-2"></div>
                                        <p>Carregando histórico...</p>
                                    </td>
                                </tr>
                            ) : payments.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-16 text-center text-slate-500">
                                        <Inbox className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                        <p>Nenhuma transação encontrada.</p>
                                    </td>
                                </tr>
                            ) : (
                                payments.map((payment, idx) => {
                                    const date = new Date(payment.dataHora);
                                    const statusStyle = getStatusConfig(payment.status);
                                    const StatusIcon = statusStyle.icon;

                                    return (
                                        <tr key={idx} className="hover:bg-slate-800/30 transition-colors group">
                                            <td className="p-6 whitespace-nowrap">
                                                <div className="font-bold text-slate-300">{date.toLocaleDateString('pt-BR')}</div>
                                                <div className="text-xs text-slate-500">{date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                                            </td>
                                            <td className="p-6 font-medium text-slate-200">
                                                {payment.produto}
                                                <div className="text-xs text-slate-500 mt-1">ID: {payment.id}</div>
                                            </td>
                                            <td className="p-6 text-slate-400 text-xs">
                                                <div className="flex items-center gap-2">
                                                    <CreditCard size={14} />
                                                    {payment.method}
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${statusStyle.bg} ${statusStyle.color} ${statusStyle.border}`}>
                                                    <StatusIcon size={12} />
                                                    {(payment.status || 'Aprovada').toUpperCase()}
                                                </div>
                                            </td>
                                            <td className="p-6 text-right font-mono font-bold text-slate-200">
                                                MT {payment.amount ? payment.amount.toFixed(2) : '0.00'}
                                            </td>
                                            <td className="p-6 text-right">
                                                <button className="text-indigo-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all text-xs font-bold flex items-center gap-1 justify-end ml-auto">
                                                    Recibo <ArrowUpRight size={12} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6 flex items-start gap-4">
                    <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
                        <ShieldCheck size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-emerald-400 mb-1">Pagamento Seguro</h4>
                        <p className="text-sm text-emerald-200/60 max-w-sm">
                            Todas as transações são criptografadas e processadas por parceiros certificados PCI-DSS.
                        </p>
                    </div>
                </div>
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 flex items-start gap-4">
                    <div className="p-3 bg-slate-700/50 rounded-xl text-slate-300">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-300 mb-1">Precisa de Ajuda?</h4>
                        <p className="text-sm text-slate-500 max-w-sm">
                            Se houver algum problema com sua fatura, entre em contato com nosso suporte financeiro.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
