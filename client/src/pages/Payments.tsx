import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    RefreshCw,
    Inbox,
    AlertCircle,
    CreditCard,
    ShieldCheck,
    Clock,
    CheckCircle2,
    XCircle,
    ArrowUpRight,
    FileText,
    Calendar,
    ArrowRight,
    Printer,
    X,
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { TableRowsSkeleton } from '../components/ui/Skeleton';

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

const ReceiptModal = ({ payment, onClose }: { payment: Payment; onClose: () => void }) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const date = new Date(payment.dataHora);

    const getStatusStyle = (status: string) => {
        const s = status?.toLowerCase() || 'pending';
        if (s === 'aprovada') {
            return {
                color: 'text-accent-fg bg-accent/10 border-accent/25',
                icon: CheckCircle2,
                text: isEn ? 'Confirmed' : 'Confirmado',
            };
        }
        if (s === 'falha') {
            return {
                color: 'text-danger-fg bg-danger/10 border-danger/25',
                icon: XCircle,
                text: isEn ? 'Cancelled / Expired' : 'Cancelado/Expirado',
            };
        }
        return {
            color: 'text-warning bg-warning/10 border-warning/25',
            icon: Clock,
            text: isEn ? 'Pending' : 'Pendente',
        };
    };

    const statusStyle = getStatusStyle(payment.status);
    const StatusIcon = statusStyle.icon;

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="fixed inset-0 bg-canvas/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-surface border border-line rounded-xl p-5 shadow-2xl max-w-sm w-full space-y-4 relative overflow-hidden">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3.5 right-3.5 text-fg-muted hover:text-fg p-1.5 hover:bg-surface-2 rounded-lg transition-colors"
                >
                    <X size={15} />
                </button>

                <div className="text-center pt-1">
                    <div className="inline-flex p-2.5 bg-accent/10 text-accent-fg rounded-xl border border-accent/25 mb-2.5">
                        <FileText size={20} />
                    </div>
                    <h3 className="text-fg font-bold text-base">
                        {isEn ? 'Invoice Receipt' : 'Comprovativo de Fatura'}
                    </h3>
                    <p className="text-[11px] text-fg-subtle mt-0.5">Torex Trading Journal</p>
                </div>

                <div className="flex justify-center">
                    <div
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold border ${statusStyle.color}`}
                    >
                        <StatusIcon size={12} />
                        <span>{statusStyle.text}</span>
                    </div>
                </div>

                <div className="bg-canvas-subtle rounded-xl p-3.5 border border-line-subtle space-y-2.5 font-mono text-xs">
                    <div className="flex justify-between gap-2">
                        <span className="text-fg-subtle">{isEn ? 'Transaction:' : 'Transação:'}</span>
                        <span className="text-fg select-all font-semibold truncate">
                            #{payment.id.substring(0, 14)}
                        </span>
                    </div>
                    <div className="flex justify-between gap-2">
                        <span className="text-fg-subtle">{isEn ? 'Date / Time:' : 'Data/Hora:'}</span>
                        <span className="text-fg tabular-nums">
                            {date.toLocaleString(isEn ? 'en-US' : 'pt-BR')}
                        </span>
                    </div>
                    <div className="flex justify-between gap-2">
                        <span className="text-fg-subtle">{isEn ? 'Plan / Item:' : 'Produto:'}</span>
                        <span className="text-fg text-right font-semibold">{payment.produto}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                        <span className="text-fg-subtle">{isEn ? 'Method:' : 'Método:'}</span>
                        <span className="text-fg">{payment.method}</span>
                    </div>
                    <div className="border-t border-line-subtle pt-2 flex justify-between text-xs sm:text-sm">
                        <span className="text-fg-muted font-sans font-semibold">{isEn ? 'Total Paid:' : 'Total Pago:'}</span>
                        <span className="text-accent-fg font-bold tabular-nums">
                            ${payment.amount.toFixed(2)} USD
                        </span>
                    </div>
                </div>

                <div className="flex gap-2.5 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 h-9 bg-surface-2 hover:bg-surface-3 text-fg rounded-lg text-xs font-semibold transition-colors border border-line"
                    >
                        {isEn ? 'Close' : 'Fechar'}
                    </button>
                    <button
                        type="button"
                        onClick={handlePrint}
                        className="inline-flex items-center justify-center gap-1.5 px-4 h-9 bg-accent hover:opacity-95 text-accent-on rounded-lg text-xs font-semibold transition-opacity"
                    >
                        <Printer size={13} />
                        <span>{isEn ? 'Print' : 'Imprimir'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export const Payments = () => {
    const navigate = useNavigate();
    const { user, refreshProfile } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [payments, setPayments] = useState<Payment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

    useEffect(() => {
        fetchPayments();
    }, []);

    const fetchPayments = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/payments');
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

    const getValidityProgress = (expiryDate: string, cycle?: string) => {
        const daysRemaining = calculateDaysRemaining(expiryDate);
        const totalDays = cycle === 'YEARLY' ? 365 : 30;
        const percent = (daysRemaining / totalDays) * 100;
        return Math.min(100, Math.max(0, percent));
    };

    const getStatusConfig = (status: string) => {
        const s = status?.toLowerCase() || 'pending';
        if (s === 'aprovada') {
            return {
                color: 'text-accent-fg',
                bg: 'bg-accent/10',
                border: 'border-accent/25',
                icon: CheckCircle2,
                text: isEn ? 'Confirmed' : 'Confirmada',
            };
        }
        if (s === 'falha') {
            return {
                color: 'text-danger-fg',
                bg: 'bg-danger/10',
                border: 'border-danger/25',
                icon: XCircle,
                text: isEn ? 'Expired / Failed' : 'Expirada/Falha',
            };
        }
        return {
            color: 'text-warning',
            bg: 'bg-warning/10',
            border: 'border-warning/25',
            icon: Clock,
            text: isEn ? 'Pending' : 'Pendente',
        };
    };

    const activeSub = payments.find(
        (p) => p.status === 'aprovada' && p.expiresAt && new Date(p.expiresAt) > new Date()
    );

    return (
        <div className="w-full space-y-3 pb-10">
            {/* Top Summary Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Active Plan Status (8 cols) */}
                <div className="lg:col-span-8 bg-surface border border-line rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 bg-accent/10 rounded-xl border border-accent/25 flex items-center justify-center shrink-0">
                                <ShieldCheck className="text-accent-fg w-5 h-5" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span
                                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                                            user?.tier && user.tier !== 'FREE'
                                                ? 'bg-accent/10 text-accent-fg border-accent/25'
                                                : 'bg-surface-2 text-fg-muted border-line'
                                        }`}
                                    >
                                        {isEn ? `${user?.tier || 'FREE'} Plan` : `Plano ${user?.tier || 'FREE'}`}
                                    </span>
                                </div>
                                <h2 className="text-base sm:text-lg font-bold text-fg tracking-tight">
                                    {user?.tier === 'PREMIUM'
                                        ? (isEn ? 'Premium Analyst' : 'Analista Premium')
                                        : user?.tier === 'BASIC'
                                          ? (isEn ? 'Basic Trader' : 'Trader Básico')
                                          : user?.tier === 'PRO'
                                            ? (isEn ? 'Pro Trader' : 'Trader Profissional')
                                            : (isEn ? 'No Active Plan' : 'Nenhum Plano Ativo')}
                                </h2>
                                <p className="text-fg-muted text-xs mt-0.5">
                                    {user?.subscription
                                        ? (isEn ? 'Active subscription linked to your Torex account.' : 'Assinatura ativa vinculada à sua conta Torex.')
                                        : (isEn ? 'Unlock full performance analytics, technical journal, and market replay.' : 'Acesse análises completas, diário técnico e backtesting.')}
                                </p>
                            </div>
                        </div>

                        {user?.subscription && (
                            <div className="bg-canvas-subtle rounded-xl px-3.5 py-2.5 border border-line-subtle sm:min-w-[180px]">
                                <div className="text-[10px] text-fg-subtle uppercase font-bold tracking-wider">
                                    {isEn ? 'Expiration' : 'Expiração'}
                                </div>
                                <div className="text-sm font-mono tabular-nums font-bold text-fg flex items-center gap-1.5 mt-0.5">
                                    <Calendar size={13} className="text-fg-subtle" />
                                    <span>
                                        {new Date(user.subscription.expiresAt).toLocaleDateString(
                                            isEn ? 'en-US' : 'pt-BR'
                                        )}
                                    </span>
                                </div>
                                <div className="text-[11px] text-accent-fg font-semibold mt-0.5 tabular-nums">
                                    {calculateDaysRemaining(user.subscription.expiresAt)} {isEn ? 'days remaining' : 'dias restantes'}
                                </div>
                            </div>
                        )}
                    </div>

                    {user?.subscription && (
                        <div className="space-y-1.5 pt-3 border-t border-line-subtle">
                            <div className="flex justify-between items-center text-[11px]">
                                <span className="text-fg-subtle">{isEn ? 'Billing Cycle' : 'Ciclo da Assinatura'}</span>
                                <span className="font-semibold text-fg tabular-nums">
                                    {calculateDaysRemaining(user.subscription.expiresAt)} {isEn ? 'days remaining' : 'dias válidos'}
                                </span>
                            </div>
                            <div className="w-full bg-canvas-subtle rounded-full h-1.5 overflow-hidden border border-line-subtle">
                                <div
                                    className="bg-accent h-full rounded-full transition-all duration-500"
                                    style={{
                                        width: `${getValidityProgress(
                                            user.subscription.expiresAt,
                                            activeSub?.cycle
                                        )}%`,
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Upcoming Invoice (4 cols) */}
                <div className="lg:col-span-4 bg-surface border border-line rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wider flex items-center gap-1.5">
                                <FileText size={14} className="text-fg-subtle" />
                                <span>{isEn ? 'Upcoming Invoice' : 'Próxima Fatura'}</span>
                            </h3>
                            {activeSub && (
                                <span className="text-[10px] font-bold uppercase tracking-wider text-accent-fg bg-accent/10 border border-accent/25 px-2 py-0.5 rounded">
                                    {isEn ? 'Scheduled' : 'Agendada'}
                                </span>
                            )}
                        </div>

                        {activeSub ? (
                            <div className="space-y-2.5">
                                <div className="text-xl sm:text-2xl font-bold text-fg font-mono tabular-nums">
                                    ${activeSub.amount.toFixed(2)} USD
                                </div>
                                <div className="space-y-1 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-fg-subtle">{isEn ? 'Due Date:' : 'Vencimento:'}</span>
                                        <span className="text-fg font-semibold tabular-nums">
                                            {new Date(activeSub.expiresAt || '').toLocaleDateString(
                                                isEn ? 'en-US' : 'pt-BR'
                                            )}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-fg-subtle">{isEn ? 'Interval:' : 'Período:'}</span>
                                        <span className="text-fg">
                                            {activeSub.cycle === 'YEARLY'
                                                ? (isEn ? 'Annual' : 'Anual')
                                                : (isEn ? 'Monthly' : 'Mensal')}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-fg-subtle">{isEn ? 'Method:' : 'Pagamento:'}</span>
                                        <span className="text-fg">{activeSub.method}</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="py-4 flex flex-col items-center justify-center text-center space-y-1.5">
                                <AlertCircle className="w-6 h-6 text-fg-subtle" />
                                <p className="text-xs text-fg-muted max-w-[200px]">
                                    {isEn
                                        ? 'No upcoming invoice or active recurring plan scheduled.'
                                        : 'Nenhuma fatura futura agendada ou plano renovável ativo.'}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="pt-3 border-t border-line-subtle">
                        <button
                            type="button"
                            onClick={() => navigate('/pricing')}
                            className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-line text-xs font-semibold text-fg transition-colors"
                        >
                            <span>{isEn ? 'Change Plan' : 'Alterar Plano'}</span>
                            <ArrowRight size={13} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Transaction History Section */}
            <div className="bg-surface border border-line rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-line flex flex-wrap justify-between items-center gap-2">
                    <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                        <Clock className="text-fg-subtle" size={15} />
                        <span>{isEn ? 'Billing History' : 'Histórico de Faturamento'}</span>
                    </h3>

                    <button
                        type="button"
                        onClick={() => {
                            fetchPayments();
                            refreshProfile();
                        }}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-line text-xs font-semibold text-fg transition-colors"
                    >
                        <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                        <span>{isEn ? 'Refresh' : 'Atualizar'}</span>
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-canvas-subtle border-b border-line-subtle text-[10px] text-fg-subtle uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="px-4 py-2.5">{isEn ? 'Issued' : 'Emissão'}</th>
                                <th className="px-4 py-2.5">{isEn ? 'Description' : 'Descrição'}</th>
                                <th className="px-4 py-2.5">{isEn ? 'Method' : 'Método'}</th>
                                <th className="px-4 py-2.5 text-center">Status</th>
                                <th className="px-4 py-2.5 text-right">{isEn ? 'Amount' : 'Valor'}</th>
                                <th className="px-4 py-2.5 text-center">{isEn ? 'Receipt' : 'Comprovativo'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line-subtle text-xs">
                            {isLoading ? (
                                <TableRowsSkeleton columns={6} rows={5} />
                            ) : payments.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={6}
                                        className="px-4 py-12 text-center text-fg-subtle"
                                    >
                                        <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                        <p className="text-xs">
                                            {isEn ? 'No invoices found in your billing history.' : 'Nenhuma fatura encontrada no seu histórico.'}
                                        </p>
                                    </td>
                                </tr>
                            ) : (
                                payments.map((payment, idx) => {
                                    const date = new Date(payment.dataHora);
                                    const statusStyle = getStatusConfig(payment.status);
                                    const StatusIcon = statusStyle.icon;

                                    return (
                                        <tr
                                            key={idx}
                                            className="hover:bg-canvas-subtle transition-colors"
                                        >
                                            <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                                                <div className="font-semibold text-fg">
                                                    {date.toLocaleDateString(isEn ? 'en-US' : 'pt-BR')}
                                                </div>
                                                <div className="text-[11px] text-fg-subtle">
                                                    {date.toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-medium text-fg">
                                                <div>{payment.produto}</div>
                                                <div className="text-[11px] text-fg-subtle mt-0.5 font-mono select-all">
                                                    Ref: {payment.id}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-fg-muted">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <CreditCard
                                                        size={13}
                                                        className="text-fg-subtle"
                                                    />
                                                    <span>{payment.method}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${statusStyle.bg} ${statusStyle.color} ${statusStyle.border}`}
                                                >
                                                    <StatusIcon size={11} />
                                                    <span>{statusStyle.text}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-fg whitespace-nowrap">
                                                ${payment.amount.toFixed(2)} USD
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedPayment(payment)}
                                                    className="h-7 px-2.5 bg-canvas-subtle hover:bg-surface-2 text-fg rounded-lg transition-colors text-[11px] font-semibold inline-flex items-center gap-1 border border-line"
                                                >
                                                    <span>{isEn ? 'Receipt' : 'Recibo'}</span>
                                                    <ArrowUpRight size={11} />
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

            {/* Bottom Security & Support Strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-surface border border-line rounded-xl p-4 flex items-start gap-3">
                    <div className="p-2 bg-accent/10 border border-accent/25 rounded-lg text-accent-fg shrink-0">
                        <ShieldCheck size={18} />
                    </div>
                    <div>
                        <h4 className="text-xs sm:text-sm font-bold text-fg">
                            {isEn ? 'Encrypted Billing' : 'Pagamento Seguro'}
                        </h4>
                        <p className="text-xs text-fg-muted mt-0.5 leading-relaxed">
                            {isEn
                                ? 'All transactions are encrypted and securely processed via certified payment gateways.'
                                : 'Todas as transações são criptografadas e processadas com segurança por gateways certificados.'}
                        </p>
                    </div>
                </div>
                <div className="bg-surface border border-line rounded-xl p-4 flex items-start gap-3">
                    <div className="p-2 bg-canvas-subtle border border-line rounded-lg text-fg-muted shrink-0">
                        <AlertCircle size={18} />
                    </div>
                    <div>
                        <h4 className="text-xs sm:text-sm font-bold text-fg">
                            {isEn ? 'Billing Support' : 'Suporte Financeiro'}
                        </h4>
                        <p className="text-xs text-fg-muted mt-0.5 leading-relaxed">
                            {isEn
                                ? 'Questions regarding invoices or renewals? Contact our desk directly via the support button.'
                                : 'Dúvidas sobre faturas ou renovação? Acione o atendimento direto pelo botão de suporte.'}
                        </p>
                    </div>
                </div>
            </div>

            {selectedPayment && (
                <ReceiptModal
                    payment={selectedPayment}
                    onClose={() => setSelectedPayment(null)}
                />
            )}
        </div>
    );
};
