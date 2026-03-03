import { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { User } from 'lucide-react';
import api from '../api';

interface UserProfile {
    name: string;
    email: string;
    whatsapp?: string;
    token?: string;
    is_connected: boolean;
    role?: string;
}

export const Configuration = () => {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchUser();
    }, []);

    const fetchUser = async () => {
        try {
            // Updated to match AuthController
            const res = await api.get('/auth/profile');
            setUser(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) return <div className="p-8 text-center text-slate-500">Carregando configurações...</div>;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <header className="mb-8">
                <h1 className="text-2xl font-bold text-slate-100">Configuração</h1>
                <p className="text-sm text-slate-400">Gerencie sua conta e conexões</p>
            </header>

            {/* User Info Only */}
            <Card className="p-6 max-w-2xl">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <User className="w-4 h-4 text-indigo-400" /> Informações do Usuário
                    </h2>
                    <span className="px-2 py-1 bg-indigo-500/10 text-indigo-400 text-xs rounded border border-indigo-500/20">
                        {user?.role || 'Trader'}
                    </span>
                </div>

                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Nome Completo</label>
                            <input
                                disabled
                                value={user?.name || ''}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">Email</label>
                            <input
                                disabled
                                value={user?.email || ''}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">WhatsApp</label>
                        <div className="flex gap-2">
                            <input
                                disabled
                                value={user?.whatsapp || ''}
                                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
                                placeholder="Não informado"
                            />
                            <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-colors">
                                Editar
                            </button>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};
