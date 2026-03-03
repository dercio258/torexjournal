import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Cloud, Power, AlertTriangle, CheckCircle, ArrowLeft } from 'lucide-react';
import api from '../../api';

interface AutoSyncFormProps {
    brokerName: string;
    serverName?: string; // Pre-filled for specific brokers if needed
    onBack: () => void;
}

export const AutoSyncForm = ({ brokerName, serverName = '', onBack }: AutoSyncFormProps) => {
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [server, setServer] = useState(serverName);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const handleConnect = async () => {
        if (!login || !password || !server) return;

        setIsLoading(true);
        setStatus(null);

        try {
            await api.post('/mt5/cloud/connect', {
                login,
                pass: password,
                server
            });
            setStatus({ type: 'success', message: 'Connection request sent! Terminal is starting...' });
        } catch (e: any) {
            setStatus({ type: 'error', message: e.response?.data?.message || e.message || 'Connection failed' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-xl mx-auto animate-in fade-in slide-in-from-right-4">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors mb-6 text-sm"
            >
                <ArrowLeft size={16} />
                Back to Brokers
            </button>

            <Card className="p-8 bg-slate-900 border-slate-800">
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-yellow-400/10 rounded-full flex items-center justify-center text-yellow-400">
                        <Cloud size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-100">Connect {brokerName}</h2>
                        <p className="text-sm text-slate-400">Enter your trading credentials to auto-sync.</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <Input
                        label="Login ID"
                        placeholder="Enter your MetaTrader Login ID"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        className="bg-slate-950 border-slate-800"
                    />

                    <Input
                        label="Investor Password"
                        type="password"
                        placeholder="Enter Investor Password (or regular)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-slate-950 border-slate-800"
                    />
                    <p className="text-xs text-slate-500 -mt-4">
                        * Investor password allows read-only access (safer).
                    </p>

                    <Input
                        label="Server Name"
                        placeholder="Search for your server (e.g. Exness-Real2)"
                        value={server}
                        onChange={(e) => setServer(e.target.value)}
                        className="bg-slate-950 border-slate-800"
                    />

                    {status && (
                        <div className={`p-4 rounded-lg flex items-center gap-3 text-sm ${status.type === 'success'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}>
                            {status.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                            {status.message}
                        </div>
                    )}

                    <Button
                        variant="gradient"
                        className="w-full py-6 text-base"
                        onClick={handleConnect}
                        isLoading={isLoading}
                        disabled={!login || !password || !server || isLoading}
                        icon={<Power size={18} />}
                    >
                        Import Trades
                    </Button>
                </div>
            </Card>
        </div>
    );
};
