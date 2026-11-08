import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import api from '../../api';
import { Modal } from '../../components/ui/Modal';
import {
    History,
    CheckCircle2,
    Clock,
    XCircle,
    Crown,
    CalendarPlus,
    Sparkles,
    Search,
    AlertCircle,
    Trash2,
    Calendar,
    Check
} from 'lucide-react';

export const AdminUsers = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // History Modal State
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Plan Management Modal State
    const [planModalUser, setPlanModalUser] = useState<any | null>(null);
    const [availablePlans, setAvailablePlans] = useState<any[]>([]);
    const [actionType, setActionType] = useState<'ASSIGN' | 'EXTEND' | 'CANCEL'>('ASSIGN');
    const [selectedTier, setSelectedTier] = useState<string>('PRO');
    const [selectedPlanConfigId, setSelectedPlanConfigId] = useState<string>('');
    const [selectedDays, setSelectedDays] = useState<number>(30);
    const [customDays, setCustomDays] = useState<string>('');
    const [customDate, setCustomDate] = useState<string>('');
    const [reason, setReason] = useState<string>('');
    const [isSubmittingPlan, setIsSubmittingPlan] = useState(false);
    const [planMessage, setPlanMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        fetchUsers();
        fetchPlans();
    }, []);

    const fetchUsers = async () => {
        try {
            const { data } = await api.get('/admin/users');
            setUsers(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchPlans = async () => {
        try {
            const { data } = await api.get('/admin/plans');
            setAvailablePlans(data);
        } catch (error) {
            console.error('Failed to load plans:', error);
        }
    };

    const fetchHistory = async (user: any) => {
        setIsLoadingHistory(true);
        setSelectedUser(user);
        try {
            const { data } = await api.get(`/admin/users/${user.id}/subscriptions`);
            setHistory(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const getActiveSub = (user: any) => {
        if (!user.subscriptions || !Array.isArray(user.subscriptions)) return null;
        const now = new Date().getTime();
        return user.subscriptions.find(
            (s: any) => s.status === 'ACTIVE' && (!s.currentPeriodEnd || new Date(s.currentPeriodEnd).getTime() > now)
        );
    };

    const openPlanModal = (user: any, preferredAction?: 'ASSIGN' | 'EXTEND') => {
        setPlanModalUser(user);
        setPlanMessage(null);
        setReason('');
        setCustomDays('');
        setCustomDate('');

        const activeSub = getActiveSub(user);
        if (activeSub) {
            setActionType(preferredAction || 'EXTEND');
            const tier = activeSub.planConfig?.tier || 'PRO';
            setSelectedTier(tier);
            setSelectedPlanConfigId(activeSub.planConfigId || '');
            setSelectedDays(30);
        } else {
            setActionType('ASSIGN');
            setSelectedTier('PRO');
            setSelectedDays(30);
            if (availablePlans.length > 0) {
                const pro = availablePlans.find((p) => p.tier === 'PRO' || p.tier === 'PREMIUM') || availablePlans[0];
                setSelectedPlanConfigId(pro.id);
            }
        }
    };

    const handlePlanSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!planModalUser) return;

        setIsSubmittingPlan(true);
        setPlanMessage(null);

        try {
            const daysToUse = customDays ? parseInt(customDays, 10) : selectedDays;

            const payload: any = {
                action: actionType,
                reason: reason.trim() || undefined,
            };

            if (actionType === 'ASSIGN') {
                payload.tier = selectedTier;
                payload.planConfigId = selectedPlanConfigId || undefined;
                if (customDate) {
                    payload.customExpiryDate = new Date(customDate).toISOString();
                } else {
                    payload.days = daysToUse;
                }
            } else if (actionType === 'EXTEND') {
                if (customDate) {
                    payload.customExpiryDate = new Date(customDate).toISOString();
                } else {
                    payload.days = daysToUse;
                }
            }

            const { data } = await api.post(`/admin/users/${planModalUser.id}/subscription`, payload);

            setPlanMessage({
                type: 'success',
                text: data.message || 'Plano atualizado com sucesso!',
            });

            await fetchUsers();

            setTimeout(() => {
                setPlanModalUser(null);
                setPlanMessage(null);
            }, 1800);
        } catch (error: any) {
            console.error('Error adjusting plan:', error);
            const errMsg = error.response?.data?.message || error.message || 'Falha ao processar alteração de plano.';
            setPlanMessage({
                type: 'error',
                text: errMsg,
            });
        } finally {
            setIsSubmittingPlan(false);
        }
    };

    // Calculate projected end date for preview
    const calculateProjectedDate = () => {
        if (!planModalUser) return null;
        const activeSub = getActiveSub(planModalUser);
        const now = new Date();

        if (customDate) {
            return new Date(customDate);
        }

        const days = customDays ? parseInt(customDays, 10) || 0 : selectedDays;

        if (actionType === 'EXTEND' && activeSub && activeSub.currentPeriodEnd) {
            const base = new Date(activeSub.currentPeriodEnd) > now ? new Date(activeSub.currentPeriodEnd) : now;
            return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
        }

        return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    };

    const filteredUsers = users.filter((u) => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            (u.name && u.name.toLowerCase().includes(term)) ||
            (u.email && u.email.toLowerCase().includes(term)) ||
            (u.whatsapp && u.whatsapp.includes(term))
        );
    });

    const activeUserSub = planModalUser ? getActiveSub(planModalUser) : null;
    const projectedDate = calculateProjectedDate();

    if (isLoading) return <div className="text-fg p-6">Carregando usuários...</div>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-fg tracking-tight">Gestão de Usuários</h1>
                    <p className="text-fg-muted text-sm mt-1">
                        Gerencie contas, atribua planos e aumente validades de assinaturas
                    </p>
                </div>

                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" size={16} />
                    <input
                        type="text"
                        placeholder="Buscar por nome, email ou tel..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-surface/80 border border-line rounded-xl text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                </div>
            </div>

            <Card className="border-line bg-surface/50 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-fg-muted">
                        <thead className="bg-surface/80 text-fg uppercase font-medium text-xs border-b border-line">
                            <tr>
                                <th className="px-6 py-4">Usuário</th>
                                <th className="px-6 py-4">Contato</th>
                                <th className="px-6 py-4">Status & Plano</th>
                                <th className="px-6 py-4">Expiração</th>
                                <th className="px-6 py-4">SMS Uso</th>
                                <th className="px-6 py-4">Cadastro</th>
                                <th className="px-6 py-4 text-right">Ações de Plano</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-fg-subtle">
                                        Nenhum usuário encontrado.
                                    </td>
                                </tr>
                            ) : (
                                filteredUsers.map((user) => {
                                    const activeSub = getActiveSub(user);
                                    const daysLeft = activeSub?.currentPeriodEnd
                                        ? Math.ceil(
                                              (new Date(activeSub.currentPeriodEnd).getTime() - new Date().getTime()) /
                                                  (1000 * 60 * 60 * 24)
                                          )
                                        : 0;

                                    return (
                                        <tr key={user.id} className="hover:bg-surface-2/40 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-fg">{user.name || 'Sem nome'}</div>
                                                <div className="text-xs text-fg-muted">{user.email}</div>
                                            </td>
                                            <td className="px-6 py-4 text-xs">
                                                {user.whatsapp ? (
                                                    <span className="font-mono text-fg/80">{user.whatsapp}</span>
                                                ) : (
                                                    <span className="text-slate-600">-</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {activeSub ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-accent-fg border border-emerald-500/20">
                                                            <Crown size={12} className="text-amber-400" />
                                                            {activeSub.planConfig?.tier || 'PRO'}
                                                        </span>
                                                        <span className="text-[11px] font-medium text-fg-muted">
                                                            ({activeSub.cycle === 'YEARLY' ? 'Anual' : 'Mensal'})
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-fg-muted border border-line-strong">
                                                        Free
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-xs">
                                                {activeSub && activeSub.currentPeriodEnd ? (
                                                    <div>
                                                        <div className="text-fg font-medium">
                                                            {new Date(activeSub.currentPeriodEnd).toLocaleDateString('pt-PT')}
                                                        </div>
                                                        <div
                                                            className={`text-[11px] ${
                                                                daysLeft <= 5 ? 'text-amber-400 font-bold' : 'text-fg-subtle'
                                                            }`}
                                                        >
                                                            {daysLeft > 0 ? `${daysLeft} dias restantes` : 'Expira hoje'}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-600">-</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-fg-muted font-mono text-xs">
                                                    {user.smsUsageCount || 0}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-fg-muted">
                                                {new Date(user.createdAt).toLocaleDateString('pt-PT')}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => openPlanModal(user)}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                            activeSub
                                                                ? 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                                                                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-accent-fg border border-emerald-500/30 shadow-sm'
                                                        }`}
                                                        title="Atribuir ou Aumentar Plano"
                                                    >
                                                        {activeSub ? (
                                                            <>
                                                                <CalendarPlus size={14} className="text-indigo-400" />
                                                                Aumentar / Alterar
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Crown size={14} className="text-amber-400" />
                                                                + Atribuir Plano
                                                            </>
                                                        )}
                                                    </button>

                                                    <button
                                                        onClick={() => fetchHistory(user)}
                                                        className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors border border-transparent hover:border-line-strong"
                                                        title="Ver Histórico de Assinaturas"
                                                    >
                                                        <History size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* MODAL: GERENCIAR PLANO (ATRIBUIR / AUMENTAR / REVOGAR) */}
            <Modal
                isOpen={!!planModalUser}
                onClose={() => {
                    if (!isSubmittingPlan) {
                        setPlanModalUser(null);
                        setPlanMessage(null);
                    }
                }}
                title={`Gerenciar Plano: ${planModalUser?.name || planModalUser?.email || ''}`}
            >
                <form onSubmit={handlePlanSubmit} className="space-y-5">
                    {/* User Status Card Banner */}
                    <div className="p-3.5 rounded-xl bg-surface-2/70 border border-line-strong flex items-center justify-between">
                        <div>
                            <div className="text-xs text-fg-muted">Usuário Selecionado</div>
                            <div className="font-semibold text-fg text-sm">{planModalUser?.name || 'Sem nome'}</div>
                            <div className="text-xs text-fg-muted font-mono">{planModalUser?.email}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-xs text-fg-muted">Status Atual</div>
                            {activeUserSub ? (
                                <div className="mt-0.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-accent-fg border border-emerald-500/20">
                                        <Crown size={11} className="text-amber-400" />
                                        {activeUserSub.planConfig?.tier || 'PRO'} Ativo
                                    </span>
                                    <div className="text-[11px] text-fg-muted mt-1">
                                        Vence: {new Date(activeUserSub.currentPeriodEnd).toLocaleDateString('pt-PT')}
                                    </div>
                                </div>
                            ) : (
                                <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-3 text-fg/80">
                                    Gratuito (Free)
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Action Type Selection Tabs */}
                    <div className="grid grid-cols-3 gap-1.5 p-1 bg-surface rounded-xl border border-line">
                        {activeUserSub && (
                            <button
                                type="button"
                                onClick={() => setActionType('EXTEND')}
                                className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                    actionType === 'EXTEND'
                                        ? 'bg-indigo-600 text-white shadow-md'
                                        : 'text-fg-muted hover:text-white'
                                }`}
                            >
                                <CalendarPlus size={14} />
                                Aumentar Validade
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setActionType('ASSIGN')}
                            className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                actionType === 'ASSIGN'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-fg-muted hover:text-white'
                            } ${!activeUserSub ? 'col-span-2' : ''}`}
                        >
                            <Crown size={14} />
                            {activeUserSub ? 'Mudar Plano' : 'Atribuir Plano'}
                        </button>
                        {activeUserSub && (
                            <button
                                type="button"
                                onClick={() => setActionType('CANCEL')}
                                className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                    actionType === 'CANCEL'
                                        ? 'bg-rose-600 text-white shadow-md'
                                        : 'text-fg-muted hover:text-danger-fg'
                                }`}
                            >
                                <Trash2 size={14} />
                                Revogar Plano
                            </button>
                        )}
                    </div>

                    {/* FORM CONTENT BASED ON ACTION */}
                    {actionType === 'CANCEL' ? (
                        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm space-y-2">
                            <div className="flex items-center gap-2 font-bold text-danger-fg">
                                <AlertCircle size={18} />
                                Atenção: Revogação de Assinatura
                            </div>
                            <p className="text-xs text-rose-200/90 leading-relaxed">
                                Esta ação cancelará imediatamente a assinatura ativa do plano{' '}
                                <strong>{activeUserSub?.planConfig?.tier || 'atual'}</strong>. O usuário perderá o acesso aos
                                recursos premium e voltará para o plano Free.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* PLAN TIER SELECTION (FOR ASSIGN) */}
                            {actionType === 'ASSIGN' && (
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-fg/80 block">
                                        Escolha o Plano a Atribuir:
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {availablePlans.length > 0 ? (
                                            availablePlans.map((plan) => {
                                                const isSelected =
                                                    selectedPlanConfigId === plan.id ||
                                                    (!selectedPlanConfigId && selectedTier === plan.tier);
                                                return (
                                                    <div
                                                        key={plan.id}
                                                        onClick={() => {
                                                            setSelectedPlanConfigId(plan.id);
                                                            setSelectedTier(plan.tier);
                                                        }}
                                                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                                                            isSelected
                                                                ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
                                                                : 'border-line bg-surface/60 hover:border-line-strong'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="font-bold text-sm text-fg flex items-center gap-1.5">
                                                                <Crown
                                                                    size={14}
                                                                    className={
                                                                        plan.tier === 'PRO' || plan.tier === 'PREMIUM'
                                                                            ? 'text-amber-400'
                                                                            : 'text-indigo-400'
                                                                    }
                                                                />
                                                                {plan.tier}
                                                            </span>
                                                            {isSelected && (
                                                                <Check size={16} className="text-indigo-400" />
                                                            )}
                                                        </div>
                                                        <div className="text-[11px] text-fg-muted mt-1 line-clamp-1">
                                                            {plan.description || 'Plano de acesso'}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <>
                                                {['PRO', 'BASIC'].map((tier) => (
                                                    <div
                                                        key={tier}
                                                        onClick={() => setSelectedTier(tier)}
                                                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                                                            selectedTier === tier
                                                                ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
                                                                : 'border-line bg-surface/60 hover:border-line-strong'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="font-bold text-sm text-fg flex items-center gap-1.5">
                                                                <Crown
                                                                    size={14}
                                                                    className={tier === 'PRO' ? 'text-amber-400' : 'text-indigo-400'}
                                                                />
                                                                {tier}
                                                            </span>
                                                            {selectedTier === tier && (
                                                                <Check size={16} className="text-indigo-400" />
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* DURATION / EXTENSION PRESETS */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-fg/80 block">
                                    {actionType === 'EXTEND'
                                        ? 'Quanto tempo adicionar à validade atual?'
                                        : 'Duração da Assinatura:'}
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { label: '+7 Dias (Trial)', days: 7 },
                                        { label: '+15 Dias', days: 15 },
                                        { label: '+30 Dias (1 Mês)', days: 30 },
                                        { label: '+60 Dias (2 Meses)', days: 60 },
                                        { label: '+90 Dias (3 Meses)', days: 90 },
                                        { label: '+365 Dias (1 Ano)', days: 365 },
                                    ].map((opt) => (
                                        <button
                                            key={opt.days}
                                            type="button"
                                            onClick={() => {
                                                setSelectedDays(opt.days);
                                                setCustomDays('');
                                                setCustomDate('');
                                            }}
                                            className={`py-2 px-2 text-xs font-medium rounded-lg border transition-all ${
                                                selectedDays === opt.days && !customDays && !customDate
                                                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                                                    : 'bg-surface/60 text-fg/80 border-line hover:border-line-strong'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* CUSTOM DAYS OR CUSTOM DATE */}
                            <div className="grid grid-cols-2 gap-3 pt-1">
                                <div>
                                    <label className="text-[11px] text-fg-muted block mb-1">
                                        Ou dias personalizados:
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="Ex: 45"
                                        value={customDays}
                                        onChange={(e) => {
                                            setCustomDays(e.target.value);
                                            setCustomDate('');
                                        }}
                                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-fg-muted block mb-1">
                                        Ou data de término exata:
                                    </label>
                                    <input
                                        type="date"
                                        value={customDate}
                                        onChange={(e) => {
                                            setCustomDate(e.target.value);
                                            setCustomDays('');
                                        }}
                                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-fg focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            {/* PREVIEW OF NEW EXPIRY DATE */}
                            {projectedDate && (
                                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-between text-xs">
                                    <span className="text-indigo-300 flex items-center gap-1.5 font-medium">
                                        <Calendar size={14} className="text-indigo-400" />
                                        Nova Validade Projetada:
                                    </span>
                                    <span className="font-bold text-fg text-sm font-mono">
                                        {projectedDate.toLocaleDateString('pt-PT', {
                                            day: '2-digit',
                                            month: '2-digit',
                                            year: 'numeric',
                                        })}
                                    </span>
                                </div>
                            )}
                        </>
                    )}

                    {/* REASON / INTERNAL NOTE */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-fg/80 block">
                            Motivo / Observação (Opcional):
                        </label>
                        <input
                            type="text"
                            placeholder="Ex: Pagamento via transferência manual, Bônus VIP, Cortesia..."
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-indigo-500"
                        />
                    </div>

                    {/* FEEDBACK MESSAGE */}
                    {planMessage && (
                        <div
                            className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                                planMessage.type === 'success'
                                    ? 'bg-emerald-500/10 text-accent-fg border border-emerald-500/20'
                                    : 'bg-rose-500/10 text-danger-fg border border-rose-500/20'
                            }`}
                        >
                            {planMessage.type === 'success' ? (
                                <CheckCircle2 size={16} className="text-accent-fg shrink-0" />
                            ) : (
                                <AlertCircle size={16} className="text-danger-fg shrink-0" />
                            )}
                            <span>{planMessage.text}</span>
                        </div>
                    )}

                    {/* ACTIONS */}
                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-line">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setPlanModalUser(null)}
                            disabled={isSubmittingPlan}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            variant={actionType === 'CANCEL' ? 'danger' : 'solid'}
                            isLoading={isSubmittingPlan}
                            icon={
                                actionType === 'CANCEL' ? (
                                    <Trash2 size={16} />
                                ) : actionType === 'EXTEND' ? (
                                    <CalendarPlus size={16} />
                                ) : (
                                    <Sparkles size={16} />
                                )
                            }
                        >
                            {actionType === 'CANCEL'
                                ? 'Confirmar Cancelamento'
                                : actionType === 'EXTEND'
                                ? 'Salvar e Estender Validade'
                                : 'Confirmar e Atribuir Plano'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* MODAL: HISTÓRICO DE ASSINATURAS */}
            <Modal
                isOpen={!!selectedUser}
                onClose={() => setSelectedUser(null)}
                title={`Histórico de Assinaturas: ${selectedUser?.name || selectedUser?.email}`}
            >
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {isLoadingHistory ? (
                        <div className="text-fg-subtle text-center py-8">Carregando histórico...</div>
                    ) : history.length === 0 ? (
                        <div className="text-fg-subtle text-center py-8">Nenhum registro encontrado.</div>
                    ) : (
                        history.map((sub) => (
                            <div
                                key={sub.id}
                                className="p-4 rounded-xl bg-surface-2/50 border border-line-strong flex justify-between items-center"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-fg uppercase text-sm">
                                            {sub.planConfig?.tier || 'Custom'}
                                        </span>
                                        <span className="text-[10px] bg-surface-3 px-1.5 py-0.5 rounded text-fg/80">
                                            {sub.cycle}
                                        </span>
                                        {sub.paymentMethod && (
                                            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono">
                                                {sub.paymentMethod}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-fg-muted">
                                        Criado em: {new Date(sub.createdAt).toLocaleDateString('pt-PT')}
                                    </div>
                                    {sub.currentPeriodEnd && (
                                        <div
                                            className={`text-xs font-medium ${
                                                sub.status === 'ACTIVE' ? 'text-accent-fg' : 'text-fg-muted'
                                            }`}
                                        >
                                            Término: {new Date(sub.currentPeriodEnd).toLocaleDateString('pt-PT')}
                                        </div>
                                    )}
                                </div>
                                <div className="text-right">
                                    {sub.status === 'ACTIVE' ? (
                                        <span className="flex items-center gap-1 text-accent-fg text-xs font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">
                                            <CheckCircle2 size={12} /> Ativo
                                        </span>
                                    ) : sub.status === 'APPROVAL_PENDING' ? (
                                        <span className="flex items-center gap-1 text-amber-400 text-xs font-bold bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-full">
                                            <Clock size={12} /> Pendente
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-fg-muted text-xs font-bold bg-surface-3/60 px-2 py-1 rounded-full">
                                            <XCircle size={12} /> {sub.status}
                                        </span>
                                    )}
                                    <div className="text-[10px] text-fg-subtle mt-1 uppercase font-mono">
                                        Ref: {sub.paymentReference?.slice(0, 14)}...
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </Modal>
        </div>
    );
};
