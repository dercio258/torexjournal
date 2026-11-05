import { useState, useEffect, useMemo } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Upload, Download, CheckCircle, AlertTriangle, ArrowLeft, ArrowRight, Wallet, BarChart2, FileSpreadsheet, FileCode, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';
import { downloadImportTemplate, TOREX_LOGO_URL } from '../../utils/documentExporter';

interface ManualImportFormProps {
    onBack: () => void;
}

export const ManualImportForm = ({ onBack }: ManualImportFormProps) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { accounts, selectedAccountId, refreshAccounts, selectAccount } = useAccount();

    const activeAccounts = useMemo(() => accounts.filter(a => !a.isArchived), [accounts]);

    const getInitialAccountId = (): string => {
        if (selectedAccountId && selectedAccountId !== 'all' && activeAccounts.some(a => a.id === selectedAccountId)) {
            return selectedAccountId;
        }
        const primary = activeAccounts.find(a => a.isPrimary) || activeAccounts[0];
        return primary ? primary.id : '';
    };

    const [targetAccountId, setTargetAccountId] = useState<string>(getInitialAccountId);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string, count?: number, accountName?: string } | null>(null);

    // Sync targetAccountId if accounts load asynchronously or if current target is invalid
    useEffect(() => {
        if (!targetAccountId || targetAccountId === 'all' || !activeAccounts.some(a => a.id === targetAccountId)) {
            const fallbackId = getInitialAccountId();
            if (fallbackId) setTargetAccountId(fallbackId);
        }
    }, [activeAccounts, selectedAccountId]);

    const selectedTargetAccount = useMemo(() => {
        return activeAccounts.find(a => a.id === targetAccountId);
    }, [activeAccounts, targetAccountId]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
            setStatus(null);
        }
    };

    const handleFileUpload = async () => {
        if (!selectedFile) return;

        if (!targetAccountId || targetAccountId === 'all') {
            setStatus({
                type: 'error',
                message: 'Selecione uma conta de trading válida de destino para associar as operações importadas.'
            });
            return;
        }

        setIsLoading(true);
        setStatus(null);

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('accountId', targetAccountId);

        try {
            const res = await api.post(`/import/report?accountId=${targetAccountId}`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'x-account-id': targetAccountId
                }
            });

            const savedCount = res.data?.count ?? 0;
            const targetName = selectedTargetAccount?.name || 'Conta';

            setStatus({ 
                type: 'success', 
                message: res.data?.message || `Importamos ${savedCount} operações com sucesso na conta "${targetName}"!`,
                count: savedCount,
                accountName: targetName
            });

            setSelectedFile(null); // Clear input file after successful import

            // Instant data refresh and switch active account to the target account
            await refreshAccounts();
            selectAccount(targetAccountId);
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['technical-journal'] });
            window.dispatchEvent(new Event('trade-imported'));

        } catch (e: any) {
            setStatus({
                type: 'error',
                message: e.response?.data?.message || e.message || 'Falha ao processar e salvar o relatório.'
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-xl mx-auto animate-in fade-in slide-in-from-right-4">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors mb-6 text-sm cursor-pointer"
            >
                <ArrowLeft size={16} />
                Voltar aos brokers
            </button>

            <Card className="p-8 bg-[#111319] border-white/[0.08] shadow-2xl">
                <div className="flex items-center gap-4 mb-8">
                    <img
                        src={TOREX_LOGO_URL}
                        alt="Torex Journal Logo"
                        className="w-12 h-12 rounded-2xl object-cover border border-emerald-500/30 shadow-lg shadow-emerald-500/10 shrink-0"
                    />
                    <div>
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 block">
                            TOREX JOURNAL • CENTRAL DE DOCUMENTOS
                        </span>
                        <h2 className="text-xl font-bold text-[#F3F4F6]">Importação Multi-Formato de Histórico</h2>
                        <p className="text-sm text-[#9CA3AF]">
                            Suporte completo para documentos <strong>CSV</strong>, <strong>HTML</strong> (MT4/MT5), <strong>Excel (.xls/.xlsx)</strong> e <strong>PDF</strong>.
                        </p>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Destination Trading Account Selection Card */}
                    <div className="bg-[#0C0D12] border border-white/[0.08] rounded-2xl p-5 shadow-inner">
                        <div className="flex items-center justify-between mb-2.5">
                            <label className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
                                <Wallet size={15} /> Conta de Destino dos Trades
                            </label>
                            {activeAccounts.length > 0 && (
                                <span className="text-[11px] font-medium text-[#9CA3AF]">
                                    {activeAccounts.length} {activeAccounts.length === 1 ? 'conta disponível' : 'contas disponíveis'}
                                </span>
                            )}
                        </div>

                        {activeAccounts.length === 0 ? (
                            <div className="p-4 bg-[#08090C] border border-white/[0.08] rounded-xl text-center">
                                <p className="text-xs text-[#9CA3AF]">Nenhuma conta de trading disponível no momento.</p>
                            </div>
                        ) : activeAccounts.length === 1 ? (
                            <div className="flex items-center justify-between p-3 bg-[#111319] rounded-xl border border-white/[0.08]">
                                <div>
                                    <div className="text-sm font-bold text-[#F3F4F6] flex items-center gap-2">
                                        {activeAccounts[0].name}
                                        {activeAccounts[0].isPrimary && (
                                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">
                                                Principal
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-[#9CA3AF] mt-0.5">
                                        {activeAccounts[0].broker || 'MetaTrader 5'} • {activeAccounts[0].currency || 'USD'} • {activeAccounts[0].type}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <select
                                    value={targetAccountId}
                                    onChange={(e) => setTargetAccountId(e.target.value)}
                                    className="w-full bg-[#08090C] border border-white/[0.08] hover:border-white/[0.15] rounded-xl px-4 py-3 text-[#F3F4F6] text-sm font-medium focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 outline-none cursor-pointer transition-all"
                                >
                                    {activeAccounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>
                                            {acc.name} — {acc.broker || 'MetaTrader'} ({acc.currency || 'USD'}) {acc.isPrimary ? '★ Principal' : ''}
                                        </option>
                                    ))}
                                </select>
                                {selectedTargetAccount && (
                                    <div className="flex items-center justify-between text-[11px] text-[#9CA3AF] px-1">
                                        <span>Tipo: <strong className="text-[#F3F4F6]">{selectedTargetAccount.type}</strong></span>
                                        <span>Saldo Atual: <strong className="text-emerald-400">{selectedTargetAccount.currency} {Number(selectedTargetAccount.balance).toFixed(2)}</strong></span>
                                    </div>
                                )}
                            </div>
                        )}

                        <p className="text-[11px] text-[#9CA3AF] mt-2.5 leading-relaxed">
                            Todos os trades deste relatório serão estritamente associados a esta conta, atualizando suas estatísticas, win rate e gráficos no TorexJournal.
                        </p>
                    </div>

                    {/* File Dropzone */}
                    <div className="border-2 border-dashed border-white/[0.12] rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:border-emerald-500/50 hover:bg-[#161822]/30 transition-all bg-[#08090C]/40 group">
                        <input
                            type="file"
                            id="report-upload"
                            className="hidden"
                            accept=".html,.htm,.csv,.xls,.xlsx,.xml,.pdf"
                            onChange={handleFileSelect}
                        />
                        <label htmlFor="report-upload" className="cursor-pointer flex flex-col items-center gap-4 w-full h-full">
                            <div className={`p-4 rounded-2xl text-indigo-400 shadow-lg transition-transform group-hover:scale-110 ${selectedFile ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-[#161822] border border-white/[0.08]'}`}>
                                {selectedFile ? <CheckCircle size={32} /> : <Upload size={32} />}
                            </div>
                            <div>
                                <p className="text-[#F3F4F6] font-bold text-base">
                                    {selectedFile ? selectedFile.name : 'Clique para selecionar o documento de operações'}
                                </p>
                                <p className="text-xs text-[#9CA3AF] mt-1.5">
                                    {selectedFile
                                        ? `${(selectedFile.size / 1024).toFixed(1)} KB pronto para importação`
                                        : 'Formatos suportados: CSV, HTML (MT4/MT5/Torex), Excel (.xls / .xlsx) e PDF'}
                                </p>
                                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">CSV</span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">HTML / MT5</span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20">EXCEL (.XLS / .XLSX)</span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">PDF</span>
                                </div>
                            </div>
                        </label>
                    </div>

                    {/* Branded Official Document Templates */}
                    <div className="bg-[#08090C]/80 p-4 rounded-2xl border border-white/[0.08] space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <img
                                    src={TOREX_LOGO_URL}
                                    alt="Logo"
                                    className="w-7 h-7 rounded-lg object-cover border border-emerald-500/30"
                                />
                                <div>
                                    <h4 className="text-xs font-bold text-[#F3F4F6] uppercase tracking-wider">
                                        Modelos Oficiais com Logo TorexJournal
                                    </h4>
                                    <p className="text-[11px] text-[#9CA3AF]">
                                        Baixe o documento estruturado no formato de sua preferência para preenchimento ou auditoria:
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    downloadImportTemplate(
                                        'csv',
                                        selectedTargetAccount?.name,
                                        selectedTargetAccount?.broker,
                                        selectedTargetAccount?.currency
                                    )
                                }
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-[#161822] hover:bg-[#1C1F2C] text-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-white/[0.08]"
                            >
                                <Download size={13} className="text-emerald-400" /> Modelo CSV
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    downloadImportTemplate(
                                        'excel',
                                        selectedTargetAccount?.name,
                                        selectedTargetAccount?.broker,
                                        selectedTargetAccount?.currency
                                    )
                                }
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-emerald-500/25"
                            >
                                <FileSpreadsheet size={13} /> Modelo Excel
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    downloadImportTemplate(
                                        'html',
                                        selectedTargetAccount?.name,
                                        selectedTargetAccount?.broker,
                                        selectedTargetAccount?.currency
                                    )
                                }
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-indigo-500/25"
                            >
                                <FileCode size={13} /> Modelo HTML
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    downloadImportTemplate(
                                        'pdf',
                                        selectedTargetAccount?.name,
                                        selectedTargetAccount?.broker,
                                        selectedTargetAccount?.currency
                                    )
                                }
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-amber-500/25"
                            >
                                <FileText size={13} /> Modelo PDF
                            </button>
                        </div>
                    </div>

                    {status && (
                        <div className={`p-5 rounded-2xl flex flex-col gap-3 text-sm animate-in fade-in slide-in-from-top-2 duration-200 ${
                            status.type === 'success'
                                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 shadow-lg shadow-emerald-500/5'
                                : 'bg-rose-500/10 text-rose-300 border border-rose-500/20 shadow-lg shadow-rose-500/5'
                        }`}>
                            <div className="flex items-center gap-3">
                                {status.type === 'success' ? <CheckCircle size={20} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={20} className="text-rose-400 shrink-0" />}
                                <p className="font-medium text-[#F3F4F6]">{status.message}</p>
                            </div>

                            {status.type === 'success' && (
                                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-500/20">
                                    <button 
                                        onClick={() => {
                                            if (targetAccountId) selectAccount(targetAccountId);
                                            navigate('/journal');
                                        }}
                                        className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500 text-slate-950 rounded-xl font-bold text-xs hover:bg-emerald-400 transition-all shadow-md cursor-pointer"
                                    >
                                        Ir para o Diário <ArrowRight size={14} />
                                    </button>
                                    <button 
                                        onClick={() => {
                                            if (targetAccountId) selectAccount(targetAccountId);
                                            navigate('/trades');
                                        }}
                                        className="flex items-center gap-2 px-3.5 py-2 bg-[#161822] hover:bg-[#1C1F2C] text-[#F3F4F6] rounded-xl font-semibold text-xs transition-colors cursor-pointer border border-white/[0.08]"
                                    >
                                        <BarChart2 size={14} /> Ver Operações
                                    </button>
                                    <button 
                                        onClick={() => {
                                            if (targetAccountId) selectAccount(targetAccountId);
                                            navigate('/dashboard');
                                        }}
                                        className="flex items-center gap-2 px-3.5 py-2 bg-[#161822] hover:bg-[#1C1F2C] text-[#F3F4F6] rounded-xl font-semibold text-xs transition-colors cursor-pointer border border-white/[0.08]"
                                    >
                                        Dashboard
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <Button
                        variant="gradient"
                        className="w-full py-4 text-sm font-bold shadow-lg shadow-indigo-500/20 cursor-pointer"
                        onClick={handleFileUpload}
                        disabled={!selectedFile || isLoading || activeAccounts.length === 0}
                        isLoading={isLoading}
                        icon={<Upload size={18} />}
                    >
                        {isLoading ? 'Salvando Operações...' : 'Importar Arquivo Selecionado'}
                    </Button>
                </div>
            </Card>
        </div>
    );
};
