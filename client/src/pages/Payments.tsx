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
    FileText,
    Calendar,
    ArrowRight,
    Printer,
    X
} from 'lucide-react';
import api from '../api';

// --- Types ---
interface Payment {
    id: string;
    dataHora: string;
    status: string;
    produto: string;
    amount: number;
    method: string;
    expiresAt?: string;
    cycle?: string;
    planTier?: string;
}

// --- Receipt Modal Component ---
const ReceiptModal = ({ payment, onClose }: { payment: Payment; onClose: () => void }) => {
    const date = new Date(payment.dataHora);
    
    const getStatusStyle = (status: string) => {
        const s = status?.toLowerCase() || 'pending';
        if (s === 'aprovada') {
            return { color: 'text-accent-fg bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2, text: 'Confirmado' };
        }
        if (s === 'falha') {
            return { color: 'text-danger-fg bg-rose-500/10 border-rose-500/20', icon: XCircle, text: 'Cancelado/Expirado' };
        }
        return { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: Clock, text: 'Pendente' };
    };

    const statusStyle = getStatusStyle(payment.status);
    const StatusIcon = statusStyle.icon;

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="fixed inset-0 bg-canvas/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-2xl max-w-sm w-full space-y-6 relative overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Modal Glow */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-full" />
                
                {/* Close Button */}
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-fg-muted hover:text-fg p-1 hover:bg-surface-2 rounded-lg transition-colors"
                >
                    <X size={16} />
                </button>

                <div className="text-center pt-2">
                    <div className="inline-flex p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20 mb-3">
                        <FileText size={24} />
                    </div>
                    <h3 className="text-fg font-bold text-lg">Comprovativo de Fatura</h3>
                    <p className="text-xs text-fg-subtle mt-1">Torex Trading Journal</p>
                </div>

                {/* Status Pill */}
                <div className="flex justify-center">
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusStyle.color}`}>
                        <StatusIcon size={12} />
                        {statusStyle.text}
                    </div>
                </div>

                {/* Info List */}
                <div className="bg-canvas/40 rounded-2xl p-4 border border-line space-y-3 font-mono text-xs">
                    <div className="flex justify-between">
                        <span className="text-fg-subtle">Transação:</span>
                        <span className="text-fg/80 select-all font-semibold">#{payment.id.substring(0, 14)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-fg-subtle">Data/Hora:</span>
                        <span className="text-fg/80">{date.toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-fg-subtle">Produto:</span>
                        <span className="text-fg/80 text-right font-semibold">{payment.produto}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-fg-subtle">Método:</span>
                        <span className="text-fg/80">{payment.method}</span>
                    </div>
                    <div className="border-t border-line my-2 pt-2 flex justify-between text-sm">
                        <span className="text-fg-muted font-sans font-semibold">Total Pago:</span>
                        <span className="text-indigo-400 font-bold">$ {payment.amount.toFixed(2)} USD</span>
                    </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-surface-2 hover:bg-surface-3/80 text-fg/80 hover:text-fg rounded-xl text-xs font-bold transition-colors border border-line-strong"
                    >
                        Fechar
                    </button>
                    <button
                        onClick={handlePrint}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/10 active:scale-95"
                    >
                        <Printer size={14} />
                        Imprimir
                    </button>
                </div>
            </div>
        </div>
    );
};

export const Payments = () => {
    const navigate = useNavigate();
    const [payments, setPayments] = useState<Payment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [user, setUser] = useState<any>(null);
    const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

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
                setPayments(res.data);
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

    // Calculate percentage progress for subscription duration
    const getValidityProgress = (expiryDate: string, cycle?: string) => {
        const daysRemaining = calculateDaysRemaining(expiryDate);
        const totalDays = cycle === 'YEARLY' ? 365 : 30;
        const percent = (daysRemaining / totalDays) * 100;
        return Math.min(100, Math.max(0, percent));
    };

    const getStatusConfig = (status: string) => {
        const s = status?.toLowerCase() || 'pending';
        if (s === 'aprovada') {
            return { color: 'text-accent-fg', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', icon: CheckCircle2, text: 'Confirmada' };
        }
        if (s === 'falha') {
            return { color: 'text-danger-fg', bg: 'bg-rose-500/10', border: 'border-rose-500/25', icon: XCircle, text: 'Expirada/Falha' };
        }
        return { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/25', icon: Clock, text: 'Pendente' };
    };

    // Retrieve active subscription details for the upcoming invoice card
    const activeSub = payments.find(p => p.status === 'aprovada' && p.expiresAt && new Date(p.expiresAt) > new Date());

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-fg mb-2 flex items-center gap-3">
                        <Wallet className="text-indigo-400 animate-pulse" /> Carteira & Faturamento
                    </h1>
                    <p className="text-fg-muted">Gerencie seu faturamento, faturas futuras e histórico de transações.</p>
                </div>
                <div className="flex gap-3">
                    <Button
                        variant="secondary"
                        onClick={() => {
                            fetchPayments();
                            fetchProfile();
                        }}
                        isLoading={isLoading}
                        icon={<RefreshCw className="w-4 h-4" />}
                    >
                        Atualizar Histórico
                    </Button>
                </div>
            </div>

            {/* Grid layout for Active Subscription and Next Invoice */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Card 1 & 2: Active Plan Status (occupies 2 cols) */}
                <div className="lg:col-span-2 bg-surface/40 backdrop-blur-xl border border-line rounded-3xl p-8 shadow-xl relative overflow-hidden flex flex-col justify-between group hover:border-line-strong transition-all">
                    <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-indigo-500/5 to-transparent rounded-full -mr-16 -mt-16" />
                    
                    <div className="flex flex-col md:flex-row justify-between items-start gap-6 relative z-10 mb-6">
                        <div className="flex items-center gap-5">
                            <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                                <ShieldCheck className="text-indigo-400 w-10 h-10" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${user?.tier === 'PREMIUM' ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' : user?.tier === 'BASIC' ? 'bg-emerald-500/15 text-accent-fg border-emerald-500/30' : 'bg-surface-2 text-fg-muted border-slate-750'}`}>
                                        Plano {user?.tier || 'FREE'}
                                    </span>
                                </div>
                                <h2 className="text-2xl font-bold text-fg uppercase tracking-tight">
                                    {user?.tier === 'PREMIUM' ? 'Analista Premium' : user?.tier === 'BASIC' ? 'Traders Básico' : 'Nenhum Plano Ativo'}
                                </h2>
                                <p className="text-fg-muted text-xs mt-1">
                                    {user?.subscription
                                        ? `Assinatura ativa vinculada à sua conta Torex.`
                                        : 'Acesse o mercado com as melhores ferramentas e suporte.'}
                                </p>
                            </div>
                        </div>

                        <div className="w-full md:w-auto flex flex-col gap-2">
                            {user?.subscription && (
                                <div className="bg-canvas/60 rounded-2xl p-4 border border-slate-850 flex-1 min-w-[200px] text-left">
                                    <div className="text-[10px] text-fg-subtle uppercase font-black tracking-wider mb-1">Data de Expiração</div>
                                    <div className="text-lg font-mono font-bold text-fg flex items-center gap-2">
                                        <Calendar size={14} className="text-fg-subtle" />
                                        {new Date(user.subscription.expiresAt).toLocaleDateString('pt-BR')}
                                    </div>
                                    <div className="text-xs text-indigo-400 font-bold mt-1">
                                        Faltam {calculateDaysRemaining(user.subscription.expiresAt)} dias válidos
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Progress Validity Slider */}
                    {user?.subscription && (
                        <div className="space-y-2 relative z-10 pt-4 border-t border-line">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-fg-subtle">Validade da Assinatura</span>
                                <span className="font-bold text-fg/80">
                                    {calculateDaysRemaining(user.subscription.expiresAt)} dias restantes
                                </span>
                            </div>
                            <div className="w-full bg-canvas rounded-full h-2 overflow-hidden border border-slate-850">
                                <div 
                                    className="bg-gradient-to-r from-indigo-500 to-indigo-400 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${getValidityProgress(user.subscription.expiresAt, activeSub?.cycle)}%` }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Card 3: Upcoming Invoice (occupies 1 col) */}
                <div className="bg-surface/40 backdrop-blur-xl border border-line rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between group hover:border-line-strong transition-all">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-full -mr-8 -mt-8" />
                    
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-sm font-black text-fg-muted uppercase tracking-widest flex items-center gap-1.5">
                                <FileText size={16} className="text-fg-subtle" />
                                Próxima Fatura
                            </h3>
                            {activeSub && (
                                <span className="text-[10px] font-bold uppercase tracking-wider text-accent-fg bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                    Agendada
                                </span>
                            )}
                        </div>

                        {activeSub ? (
                            <div className="space-y-3 pt-2">
                                <div className="text-3xl font-black text-fg font-mono">
                                    $ {activeSub.amount.toFixed(2)} USD
                                </div>
                                <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-fg-subtle">Vencimento:</span>
                                        <span className="text-fg/80 font-bold">
                                            {new Date(activeSub.expiresAt || '').toLocaleDateString('pt-BR')}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-fg-subtle">Período:</span>
                                        <span className="text-fg/80">{activeSub.cycle === 'YEARLY' ? 'Anual' : 'Mensal'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-fg-subtle">Pagamento:</span>
                                        <span className="text-fg/80">{activeSub.method}</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="py-6 flex flex-col items-center justify-center text-center space-y-2.5">
                                <AlertCircle className="w-8 h-8 text-slate-600" />
                                <p className="text-xs text-fg-subtle max-w-[180px]">
                                    Nenhuma fatura futura agendada ou plano ativo renovável.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="pt-4 mt-4 border-t border-line">
                        <button 
                            onClick={() => navigate('/pricing')}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3/80 text-xs font-bold text-fg transition-all"
                        >
                            Alterar Plano <ArrowRight size={14} />
                        </button>
                    </div>
                </div>

            </div>

            {/* Transaction History Section */}
            <div className="bg-surface/40 backdrop-blur-xl border border-line rounded-3xl overflow-hidden shadow-xl">
                <div className="p-6 border-b border-line flex justify-between items-center">
                    <h3 className="text-lg font-bold text-fg flex items-center gap-2">
                        <Clock className="text-fg-muted" size={20} />
                        Histórico de Faturamento
                    </h3>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-canvas/40 text-xs text-fg-subtle uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-6">Data de Emissão</th>
                                <th className="p-6">Descrição da Operação</th>
                                <th className="p-6">Método Utilizado</th>
                                <th className="p-6 text-center">Status</th>
                                <th className="p-6 text-right">Valor Pago</th>
                                <th className="p-6 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line text-sm">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-fg-subtle">
                                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mb-2"></div>
                                        <p className="text-xs">Carregando dados das faturas...</p>
                                    </td>
                                </tr>
                            ) : payments.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-16 text-center text-fg-subtle">
                                        <Inbox className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                        <p className="text-xs">Nenhuma fatura encontrada no seu histórico.</p>
                                    </td>
                                </tr>
                            ) : (
                                payments.map((payment, idx) => {
                                    const date = new Date(payment.dataHora);
                                    const statusStyle = getStatusConfig(payment.status);
                                    const StatusIcon = statusStyle.icon;

                                    return (
                                        <tr key={idx} className="hover:bg-surface-2/20 transition-colors group">
                                            <td className="p-6 whitespace-nowrap">
                                                <div className="font-bold text-fg/80">{date.toLocaleDateString('pt-BR')}</div>
                                                <div className="text-xs text-fg-subtle">{date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                                            </td>
                                            <td className="p-6 font-medium text-fg">
                                                {payment.produto}
                                                <div className="text-xs text-fg-subtle mt-1.5 font-mono select-all">Ref: {payment.id}</div>
                                            </td>
                                            <td className="p-6 text-fg-muted text-xs">
                                                <div className="flex items-center gap-2">
                                                    <CreditCard size={14} className="text-fg-subtle" />
                                                    {payment.method}
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusStyle.bg} ${statusStyle.color} ${statusStyle.border}`}>
                                                    <StatusIcon size={12} />
                                                    {statusStyle.text}
                                                </div>
                                            </td>
                                            <td className="p-6 text-right font-mono font-bold text-fg">
                                                $ {payment.amount.toFixed(2)} USD
                                            </td>
                                            <td className="p-6 text-center">
                                                <button 
                                                    onClick={() => setSelectedPayment(payment)}
                                                    className="px-3.5 py-1.5 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-fg rounded-xl transition-all text-xs font-bold flex items-center gap-1.5 mx-auto border border-indigo-600/20"
                                                >
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

            {/* Bottom info section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6 flex items-start gap-4">
                    <div className="p-3 bg-emerald-500/10 rounded-xl text-accent-fg">
                        <ShieldCheck size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-accent-fg mb-1">Pagamento Seguro</h4>
                        <p className="text-sm text-emerald-200/60 max-w-sm">
                            Todas as transações são criptografadas e processadas com segurança por gateways locais e internacionais.
                        </p>
                    </div>
                </div>
                <div className="bg-surface-2/30 border border-line-strong rounded-2xl p-6 flex items-start gap-4">
                    <div className="p-3 bg-surface-3/50 rounded-xl text-fg/80">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-fg/80 mb-1">Suporte Financeiro</h4>
                        <p className="text-sm text-fg-subtle max-w-sm">
                            Tem dúvidas sobre uma fatura ou cobrança? Entre em contato imediato com o suporte financeiro.
                        </p>
                    </div>
                </div>
            </div>

            {/* Detailed Receipt Modal */}
            {selectedPayment && (
                <ReceiptModal 
                    payment={selectedPayment} 
                    onClose={() => setSelectedPayment(null)} 
                />
            )}
        </div>
    );
};
