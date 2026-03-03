import { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Cloud, Monitor, CheckCircle, Download, Power, AlertTriangle, FileText, Upload, Copy, Wifi } from 'lucide-react';
import api from '../../api';

export const ConnectionManager = () => {
    const [method, setMethod] = useState<'LOCAL' | 'CLOUD' | 'FILE'>('LOCAL');

    // Cloud State
    const [cloudLogin, setCloudLogin] = useState('');
    const [cloudPass, setCloudPass] = useState('');
    const [cloudServer, setCloudServer] = useState('');

    // File State
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    // Shared State
    const [isLoading, setIsLoading] = useState(false);
    const [statusData, setStatusData] = useState<{ message?: string, error?: string }>({});

    // User Connection Info
    const [apiToken, setApiToken] = useState('');
    const [connectionStatus, setConnectionStatus] = useState(false);

    useEffect(() => {
        fetchConnectionInfo();
    }, []);

    const fetchConnectionInfo = async () => {
        try {
            const res = await api.get('/auth/profile');
            if (res.data) {
                setApiToken(res.data.token || 'Generate in Settings');
                setConnectionStatus(res.data.is_connected);
            }
        } catch (e) {
            console.error("Failed to fetch connection info", e);
        }
    };

    const copyToken = () => {
        navigator.clipboard.writeText(apiToken);
        setStatusData({ message: 'Token copied to clipboard!' });
        setTimeout(() => setStatusData({}), 3000);
    };

    // Cloud Handlers
    const handleCloudConnect = async () => {
        setIsLoading(true);
        setStatusData({});
        try {
            await api.post('/mt5/cloud/connect', {
                login: cloudLogin, // Send as string
                pass: cloudPass,
                server: cloudServer
            });
            setStatusData({ message: 'Request Sent! Terminal is starting...' });
        } catch (e: any) {
            setStatusData({ error: e.response?.data?.message || e.message });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCloudDisconnect = async () => {
        if (!confirm('Are you sure you want to stop the cloud terminal?')) return;
        setIsLoading(true);
        try {
            await api.post('/mt5/cloud/disconnect', { login: cloudLogin });
            setStatusData({ message: 'Terminal Stopped.' });
        } catch (e: any) {
            setStatusData({ error: e.response?.data?.message || e.message });
        } finally {
            setIsLoading(false);
        }
    };

    // File Handlers
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
            setStatusData({});
        }
    };

    const handleFileUpload = async () => {
        if (!selectedFile) return;
        setIsLoading(true);
        setStatusData({});

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            await api.post('/import/report', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setStatusData({ message: 'Report imported successfully! History updated.' });
            setSelectedFile(null);
        } catch (e: any) {
            setStatusData({ error: e.response?.data?.message || e.message });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="p-6 space-y-6 bg-slate-900 border-slate-800">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Monitor className="text-emerald-500" />
                        Trading Connection
                    </h2>
                    <p className="text-slate-400 text-sm">Choose how you want to connect your MT5 account.</p>
                </div>

                <div className={`px-3 py-1 rounded-full border flex items-center gap-2 text-xs font-bold ${connectionStatus ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                    <Wifi size={14} className={connectionStatus ? 'animate-pulse' : ''} />
                    {connectionStatus ? 'ONLINE' : 'OFFLINE'}
                </div>
            </div>

            <div className="flex gap-2 p-1 bg-slate-950/50 rounded-xl overflow-x-auto">
                <Button
                    variant={method === 'LOCAL' ? 'primary' : 'secondary'}
                    onClick={() => setMethod('LOCAL')}
                    className="flex-1 whitespace-nowrap"
                    icon={<Download size={14} />}
                >
                    Method A: Local EA
                </Button>
                <Button
                    variant={method === 'CLOUD' ? 'primary' : 'secondary'}
                    onClick={() => setMethod('CLOUD')}
                    className="flex-1 whitespace-nowrap"
                    icon={<Cloud size={14} />}
                >
                    Method B: Cloud
                </Button>
                <Button
                    variant={method === 'FILE' ? 'primary' : 'secondary'}
                    onClick={() => setMethod('FILE')}
                    className="flex-1 whitespace-nowrap"
                    icon={<FileText size={14} />}
                >
                    Method C: Import File
                </Button>
            </div>

            {method === 'LOCAL' && (
                <div className="space-y-4 bg-slate-950/30 p-6 rounded-xl border border-slate-800/50 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-400">
                            <CheckCircle size={24} />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-semibold text-white">Instructions</h3>
                            <p className="text-sm text-slate-400">Run the Expert Advisor on your own PC. Best for privacy and zero cost.</p>
                        </div>
                    </div>

                    <ol className="list-decimal list-inside text-sm text-slate-400 space-y-3 ml-2 border-l-2 border-slate-800 pl-4 py-2">
                        <li>Download <span className="text-white font-mono bg-slate-800 px-1 rounded">CossaConnector.ex5</span></li>
                        <li>Open MT5 &gt; File &gt; Open Data Folder &gt; MQL5 &gt; Experts</li>
                        <li>Copy the file and restart MT5</li>
                        <li>Drag to any chart and allow "DLL Imports"</li>
                        <li>
                            Enter your <span className="text-white font-bold">App Token</span>:
                            <div className="mt-2 flex items-center gap-2">
                                <code className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-indigo-400 font-mono text-xs select-all">
                                    {apiToken}
                                </code>
                                <button onClick={copyToken} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors" title="Copy Token">
                                    <Copy size={14} />
                                </button>
                            </div>
                        </li>
                    </ol>

                    <div className="pt-2">
                        <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => window.open('/download/CossaConnector.ex5')}
                            icon={<Download size={16} />}
                        >
                            Download EA Connector
                        </Button>
                    </div>
                </div>
            )}

            {method === 'CLOUD' && (
                <div className="space-y-4 bg-slate-950/30 p-6 rounded-xl border border-emerald-500/10 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-start gap-4 mb-4">
                        <div className="p-3 bg-blue-500/10 rounded-lg text-blue-400">
                            <Cloud size={24} />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-semibold text-white">Cloud Hosting</h3>
                            <p className="text-sm text-slate-400">We run MT5 for you. Requires your trading password to auto-login.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <Input
                            label="Broker Server Name"
                            placeholder="Ex: MetaQuotes-Demo"
                            value={cloudServer}
                            onChange={(e) => setCloudServer(e.target.value)}
                            className="bg-slate-900 border-slate-700"
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Login / Investor"
                                placeholder="Account ID"
                                type="text"
                                value={cloudLogin}
                                onChange={(e) => setCloudLogin(e.target.value)}
                                className="bg-slate-900 border-slate-700"
                            />
                            <Input
                                label="Trading Password"
                                placeholder="••••••••"
                                type="password"
                                value={cloudPass}
                                onChange={(e) => setCloudPass(e.target.value)}
                                className="bg-slate-900 border-slate-700"
                            />
                        </div>

                        {/* Status Messages */}
                        {statusData.error && (
                            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg flex items-center gap-2">
                                <AlertTriangle size={16} />
                                {statusData.error}
                            </div>
                        )}
                        {statusData.message && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-lg flex items-center gap-2">
                                <CheckCircle size={16} />
                                {statusData.message}
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <Button
                                variant="gradient"
                                className="flex-1"
                                onClick={handleCloudConnect}
                                disabled={!cloudLogin || !cloudPass || !cloudServer || isLoading}
                                isLoading={isLoading}
                                icon={<Power size={16} />}
                            >
                                Start Cloud Terminal
                            </Button>

                            <Button
                                variant="danger"
                                onClick={handleCloudDisconnect}
                                disabled={!cloudLogin || isLoading}
                                title="Failsafe Stop"
                            >
                                Stop
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {method === 'FILE' && (
                <div className="space-y-6 bg-slate-950/30 p-6 rounded-xl border border-indigo-500/10 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-indigo-500/10 rounded-lg text-indigo-400">
                            <FileText size={24} />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-semibold text-white">Import History</h3>
                            <p className="text-sm text-slate-400">Choose a file format to sync your trading history.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-indigo-500/30 transition-all group cursor-pointer relative overflow-hidden" onClick={() => document.getElementById('report-upload')?.click()}>
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <FileText size={64} />
                            </div>
                            <h4 className="font-bold text-slate-200 mb-1">MetaTrader 4/5 Report</h4>
                            <p className="text-xs text-slate-500 mb-3">Export your history as HTML from MT4 or MT5 terminal.</p>
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded">Recommended</span>
                        </div>

                        <div className="p-4 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-emerald-500/30 transition-all group cursor-pointer relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <FileText size={64} />
                            </div>
                            <h4 className="font-bold text-slate-200 mb-1">CSV / Excel Template</h4>
                            <p className="text-xs text-slate-500 mb-3">Upload your trades using our standardized CSV format.</p>
                            <button
                                onClick={(e) => { e.stopPropagation(); window.open('/template.csv'); }}
                                className="text-[10px] flex items-center gap-1 text-emerald-400 hover:text-emerald-300 hover:underline"
                            >
                                <Download size={10} /> Download Template
                            </button>
                        </div>
                    </div>

                    <div className="border-2 border-dashed border-slate-700/50 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:border-indigo-500/50 hover:bg-slate-800/30 transition-all bg-slate-900/20">
                        <input
                            type="file"
                            id="report-upload"
                            className="hidden"
                            accept=".html,.htm,.csv,.xlsx"
                            onChange={handleFileSelect}
                        />
                        <label htmlFor="report-upload" className="cursor-pointer flex flex-col items-center gap-4 w-full h-full">
                            <div className="p-4 bg-slate-800 rounded-full text-indigo-400 shadow-lg shadow-indigo-500/10 ring-1 ring-white/5">
                                <Upload size={24} />
                            </div>
                            <div>
                                <p className="text-slate-200 font-medium">Click to upload report</p>
                                <p className="text-xs text-slate-500 mt-1">Supports: .html (MT4/5), .csv, .xlsx</p>
                            </div>
                        </label>
                    </div>

                    {selectedFile && (
                        <div className="flex items-center justify-between p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                            <div className="flex items-center gap-3">
                                <FileText className="text-indigo-400" size={16} />
                                <span className="text-sm font-medium text-slate-200">{selectedFile.name}</span>
                            </div>
                            <span className="text-xs text-slate-500 font-mono">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                        </div>
                    )}

                    {statusData.error && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg flex items-center gap-2 animate-in slide-in-from-top-1">
                            <AlertTriangle size={16} />
                            {statusData.error}
                        </div>
                    )}
                    {statusData.message && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-lg flex items-center gap-2 animate-in slide-in-from-top-1">
                            <CheckCircle size={16} />
                            {statusData.message}
                        </div>
                    )}

                    <Button
                        variant="gradient"
                        className="w-full"
                        onClick={handleFileUpload}
                        disabled={!selectedFile || isLoading}
                        isLoading={isLoading}
                        icon={<Upload size={16} />}
                    >
                        Import Selected Report
                    </Button>
                </div>
            )}
        </Card>
    );
};
