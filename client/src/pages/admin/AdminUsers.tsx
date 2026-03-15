import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import api from '../../api';
import { Modal } from '../../components/ui/Modal';
import { History, CheckCircle2, Clock, XCircle } from 'lucide-react';

export const AdminUsers = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    useEffect(() => {
        fetchUsers();
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

    if (isLoading) return <div className="text-white">Carregando...</div>;

    return (
        <div>
            <h1 className="text-3xl font-bold text-white mb-6">Usuários</h1>
            <Card className="border-slate-800 bg-slate-900/50 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="bg-slate-900 text-slate-200 uppercase font-medium">
                            <tr>
                                <th className="px-6 py-4">Nome</th>
                                <th className="px-6 py-4">Email</th>
                                <th className="px-6 py-4">Whatsapp</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Plano</th>
                                <th className="px-6 py-4">SMS Uso</th>
                                <th className="px-6 py-4">Cadastro</th>
                                <th className="px-6 py-4">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {users.map((user) => {
                                const activeSub = user.subscriptions?.find((s: any) => s.status === 'ACTIVE');
                                return (
                                    <tr key={user.id} className="hover:bg-slate-800/50">
                                        <td className="px-6 py-4 font-medium text-white">
                                            {user.name || 'Sem nome'}
                                        </td>
                                        <td className="px-6 py-4">{user.email}</td>
                                        <td className="px-6 py-4">{user.whatsapp || '-'}</td>
                                        <td className="px-6 py-4">
                                            {activeSub ? (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500">
                                                    Ativo
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400">
                                                    Free
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            {activeSub ? (
                                                <span className="text-indigo-400 font-medium">
                                                    {activeSub.planConfig?.tier || 'Custom'}
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-slate-400 font-mono text-xs">{user.smsUsageCount || 0}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {new Date(user.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button 
                                                onClick={() => fetchHistory(user)}
                                                className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition-colors"
                                            >
                                                <History size={16} /> Historico
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Modal
                isOpen={!!selectedUser}
                onClose={() => setSelectedUser(null)}
                title={`Histórico: ${selectedUser?.name || selectedUser?.email}`}
            >
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {isLoadingHistory ? (
                        <div className="text-slate-500 text-center py-8">Carregando histórico...</div>
                    ) : history.length === 0 ? (
                        <div className="text-slate-500 text-center py-8">Nenhum registro encontrado.</div>
                    ) : history.map((sub) => (
                        <div key={sub.id} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700 flex justify-between items-center">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-white uppercase">{sub.planConfig?.tier || 'Custom'}</span>
                                    <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-400">{sub.cycle}</span>
                                </div>
                                <div className="text-xs text-slate-400">
                                    Início: {new Date(sub.createdAt).toLocaleDateString()}
                                </div>
                                {sub.status === 'ACTIVE' && (
                                    <div className="text-xs text-emerald-400 font-medium">
                                        Expira em: {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                                    </div>
                                )}
                            </div>
                            <div className="text-right">
                                {sub.status === 'ACTIVE' ? (
                                    <span className="flex items-center gap-1 text-emerald-500 text-xs font-bold bg-emerald-500/10 px-2 py-1 rounded-full">
                                        <CheckCircle2 size={12} /> Ativo
                                    </span>
                                ) : sub.status === 'APPROVAL_PENDING' ? (
                                    <span className="flex items-center gap-1 text-amber-500 text-xs font-bold bg-amber-500/10 px-2 py-1 rounded-full">
                                        <Clock size={12} /> Pendente
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 text-slate-500 text-xs font-bold bg-slate-700 px-2 py-1 rounded-full">
                                        <XCircle size={12} /> {sub.status}
                                    </span>
                                )}
                                <div className="text-[10px] text-slate-500 mt-1 uppercase">
                                    Ref: {sub.paymentReference?.slice(0, 10)}...
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </Modal>
        </div>
    );
};
