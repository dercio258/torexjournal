
import { useEffect, useState } from 'react';
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
    amount?: number; // Optional mock field
    method?: string; // Optional mock field
}

export const Payments = () => {
    const [payments, setPayments] = useState<Payment[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchPayments();
    }, []);

    const fetchPayments = async () => {
        setIsLoading(true);
        try {
            // Corrected endpoint from /pagamento/payments to /api/payments
            const res = await api.get('/api/payments');
            if (Array.isArray(res.data) && res.data.length > 0) {
                // Map backend fields to frontend interface
                const mappedPayments = res.data.map((p: any) => ({
                    id: p.vendaId || p.id,
                    dataHora: p.dataHora,
                    status: p.status,
                    produto: p.produto,
                    amount: Number(p.preco),
                    method: 'Cartão de Crédito' // Default as not in entity yet
                }));
                setPayments(mappedPayments);
            } else {
                setPayments([]); // Empty state if no payments found (don't show mock for real users)
            }
        } catch (err) {
            console.error('Error fetching payments:', err);
            // On error, show empty state instead of mock data to avoid confusion
            setPayments([]);
        } finally {
            setIsLoading(false);
        }
    };

    const calculateRenewalDate = (paymentDate: string, produto: string) => {
        const date = new Date(paymentDate);
        if (!produto) return date;
        let months = 1;
        const p = produto.toLowerCase();
        if (p.includes('trimestral') || p.includes('quarterly')) months = 3;
        else if (p.includes('semestral') || p.includes('semiannual')) months = 6;
        else if (p.includes('anual') || p.includes('annual') || p.includes('yearly')) months = 12;
        date.setMonth(date.getMonth() + months);
        return date;
    };

    const getStatusConfig = (status: string) => {
        const s = status.toLowerCase();
        if (['aprovada', 'approved', 'succeeded', 'paid'].includes(s)) {
            return { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: CheckCircle2 };
        }
        if (['falha', 'failed', 'declined'].includes(s)) {
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
                    <p className="text-slate-400">Gerencie seu plano, métodos de pagamento e histórico.</p>
                </div>
                <Button
                    variant="secondary"
                    onClick={fetchPayments}
                    isLoading={isLoading}
                    icon={<RefreshCw className="w-4 h-4" />}
                >
                    Atualizar
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Current Plan Card */}
                <div className="lg:col-span-2 bg-gradient-to-br from-indigo-600/20 to-purple-800/20 backdrop-blur-xl border border-indigo-500/30 rounded-3xl p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-fullblur-[100px] -mr-16 -mt-16 pointer-events-none" />

                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-bold uppercase tracking-wider mb-3">
                                <ShieldCheck size={14} /> Plano Ativo
                            </div>
                            <h2 className="text-3xl font-bold text-white mb-2">Trader Pro</h2>
                            <p className="text-indigo-200/80 text-sm max-w-md">
                                Acesso total a todas as ferramentas, dados em tempo real e suporte prioritário.
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-indigo-200 uppercase tracking-wider font-bold mb-1">Próxima Renovação</div>
                            <div className="text-2xl font-mono text-white">
                                {payments[0]
                                    ? calculateRenewalDate(payments[0].dataHora, payments[0].produto).toLocaleDateString('pt-BR')
                                    : 'N/A'
                                }
                            </div>
                            <div className="text-xs text-indigo-300/60 mt-1">Renovação Automática</div>
                        </div>
                    </div>

                    <div className="mt-8 pt-8 border-t border-indigo-500/20 flex gap-4">
                        <button className="px-5 py-2.5 bg-white text-indigo-900 rounded-xl font-bold hover:bg-indigo-50 transition-colors shadow-lg">
                            Gerenciar Assinatura
                        </button>
                        <button className="px-5 py-2.5 bg-indigo-500/20 text-white border border-indigo-400/30 rounded-xl font-bold hover:bg-indigo-500/30 transition-colors">
                            Upgrade de Plano
                        </button>
                    </div>
                </div>

                {/* Payment Method Card */}
                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 flex flex-col justify-between group hover:border-slate-700 transition-all">
                    <div>
                        <div className="flex justify-between items-start mb-6">
                            <h3 className="font-bold text-slate-200 flex items-center gap-2">
                                <CreditCard size={20} className="text-slate-400" /> Método Principal
                            </h3>
                            <button className="text-xs text-indigo-400 hover:text-white font-bold transition-colors">Editar</button>
                        </div>

                        {/* Mock Card Visual */}
                        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 border border-slate-700/50 shadow-inner relative overflow-hidden">
                            <div className="absolute bottom-[-20px] right-[-20px] opacity-10 transform rotate-12">
                                <CreditCard size={120} />
                            </div>
                            <div className="relative z-10">
                                <div className="flex justify-between items-center mb-6">
                                    <div className="w-8 h-5 bg-slate-600/50 rounded flex items-center justify-center">
                                        <div className="w-4 h-3 bg-yellow-500/20 rounded-sm" />
                                    </div>
                                    <span className="text-xs font-mono text-slate-500">DEBIT</span>
                                </div>
                                <div className="font-mono text-lg text-slate-300 tracking-widest mb-4">
                                    •••• •••• •••• 4242
                                </div>
                                <div className="flex justify-between text-xs text-slate-500">
                                    <span>TITULAR DO CARTÃO</span>
                                    <span>VAL/ANO</span>
                                </div>
                                <div className="flex justify-between text-xs font-bold text-slate-400">
                                    <span>ALEX DOE</span>
                                    <span>12/28</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
                        <span>Segurança criptografada</span>
                        <ShieldCheck size={14} className="text-emerald-500" />
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
                                    const statusStyle = getStatusConfig(payment.status || 'aprovada');
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
                                                    {payment.method || 'Cartão ••4242'}
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${statusStyle.bg} ${statusStyle.color} ${statusStyle.border}`}>
                                                    <StatusIcon size={12} />
                                                    {(payment.status || 'Aprovada').toUpperCase()}
                                                </div>
                                            </td>
                                            <td className="p-6 text-right font-mono font-bold text-slate-200">
                                                R$ {payment.amount ? payment.amount.toFixed(2) : '49.90'}
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
