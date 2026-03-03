import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import api from '../../api';

export const AdminUsers = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
                                <th className="px-6 py-4">Cadastro</th>
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
                                            {new Date(user.createdAt).toLocaleDateString()}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};
