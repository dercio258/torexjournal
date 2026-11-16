import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
    AlertTriangle,
    ArrowRight,
    BarChart2,
    CheckCircle2,
    Download,
    FileCode,
    FileSpreadsheet,
    FileText,
    Upload,
    Wallet,
    X,
} from 'lucide-react';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';
import { useLocale } from '../../context/LocaleContext';
import { Button } from '../../components/ui/Button';
import { downloadImportTemplate } from '../../utils/documentExporter';
import { pullAccountHistoryInBatchesAndBuildUnifiedSession } from '../../services/historicalBatchCache';

export const ManualImportPage = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { accounts, selectedAccountId, refreshAccounts, selectAccount, openManageModal } = useAccount();

    const activeAccounts = useMemo(() => accounts.filter((a) => !a.isArchived), [accounts]);

    const getInitialAccountId = (): string => {
        if (
            selectedAccountId &&
            selectedAccountId !== 'all' &&
            activeAccounts.some((a) => a.id === selectedAccountId)
        ) {
            return selectedAccountId;
        }
        const primary = activeAccounts.find((a) => a.isPrimary) || activeAccounts[0];
        return primary ? primary.id : '';
    };

    const [targetAccountId, setTargetAccountId] = useState<string>(getInitialAccountId);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{
        type: 'success' | 'error';
        message: string;
    } | null>(null);

    useEffect(() => {
        if (
            !targetAccountId ||
            targetAccountId === 'all' ||
            !activeAccounts.some((a) => a.id === targetAccountId)
        ) {
            const fallbackId = getInitialAccountId();
            if (fallbackId) setTargetAccountId(fallbackId);
        }
    }, [activeAccounts, selectedAccountId]);

    const selectedTargetAccount = useMemo(
        () => activeAccounts.find((a) => a.id === targetAccountId),
        [activeAccounts, targetAccountId]
    );

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
            setStatus(null);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setSelectedFile(e.dataTransfer.files[0]);
            setStatus(null);
        }
    };

    const handleFileUpload = async () => {
        if (!selectedFile) return;

        if (!targetAccountId || targetAccountId === 'all') {
            setStatus({
                type: 'error',
                message: isEn ? 'Select a destination account.' : 'Selecione uma conta de destino.',
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
                    'x-account-id': targetAccountId,
                },
            });

            const savedCount = res.data?.count ?? 0;
            const targetName = selectedTargetAccount?.name || (isEn ? 'your account' : 'sua conta');

            setStatus({
                type: 'success',
                message:
                    res.data?.message ||
                    (isEn
                        ? `${savedCount} executions imported into ${targetName}.`
                        : `${savedCount} registros adicionados em ${targetName}.`),
            });

            setSelectedFile(null);

            await refreshAccounts();
            selectAccount(targetAccountId);
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['technical-journal'] });
            void pullAccountHistoryInBatchesAndBuildUnifiedSession({
                accountId: targetAccountId,
                accountName: targetName,
                syncSourceLabel: `${isEn ? 'File' : 'Arquivo'} (${targetName})`,
                triggerLiveBrokerSync: false,
            }).catch(() => {});
            window.dispatchEvent(new Event('trade-imported'));
        } catch (err: any) {
            setStatus({
                type: 'error',
                message:
                    err.response?.data?.message ||
                    (isEn
                        ? 'Unrecognized report format. Please verify the exported file.'
                        : 'Formato não reconhecido. Confira o arquivo enviado.'),
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-8 space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex items-center gap-3.5 pb-5 border-b border-line">
                <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-line-strong flex items-center justify-center text-accent-fg shrink-0">
                    <FileSpreadsheet size={23} />
                </div>
                <div>
                    <h2 className="text-lg sm:text-xl font-bold text-fg">
                        {isEn ? 'Import Broker Statement' : 'Importar Arquivo'}
                    </h2>
                    <p className="text-xs sm:text-sm text-fg-muted">
                        {isEn
                            ? 'Supported formats: CSV, Excel (.xls, .xlsx), HTML & PDF'
                            : 'Formatos aceitos: CSV, Excel (.xls, .xlsx), HTML e PDF'}
                    </p>
                </div>
            </div>

            {/* Destination Account */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label
                        htmlFor="target-account-select"
                        className="text-xs font-semibold uppercase tracking-wider text-fg-muted flex items-center gap-1.5"
                    >
                        <Wallet size={14} className="text-accent-fg" />
                        {isEn ? 'Destination Account' : 'Conta de destino'}
                    </label>
                    <button
                        type="button"
                        onClick={() => openManageModal('accounts')}
                        className="text-xs font-medium text-accent-fg hover:underline"
                    >
                        {isEn ? 'Manage' : 'Gerenciar'}
                    </button>
                </div>

                {activeAccounts.length === 0 ? (
                    <div className="p-4 bg-canvas-subtle border border-line rounded-xl text-center space-y-2">
                        <p className="text-xs text-fg-muted">
                            {isEn ? 'No trading accounts found.' : 'Nenhuma conta cadastrada.'}
                        </p>
                        <Button variant="outline" size="sm" onClick={() => openManageModal('create')}>
                            {isEn ? 'Create Account' : 'Criar conta'}
                        </Button>
                    </div>
                ) : activeAccounts.length === 1 ? (
                    <div className="flex items-center justify-between p-3.5 bg-canvas-subtle rounded-xl border border-line">
                        <div className="text-sm font-bold text-fg flex items-center gap-2">
                            {activeAccounts[0].name}
                            <span className="text-xs font-normal text-fg-muted">
                                ({activeAccounts[0].currency || 'USD'})
                            </span>
                        </div>
                    </div>
                ) : (
                    <select
                        id="target-account-select"
                        value={targetAccountId}
                        onChange={(e) => setTargetAccountId(e.target.value)}
                        className="w-full bg-canvas border border-line hover:border-line-strong focus:border-accent/60 rounded-xl px-4 py-3 text-fg text-sm font-medium outline-none cursor-pointer transition-colors"
                    >
                        {activeAccounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                                {acc.name} — {acc.broker || 'MetaTrader'} ({acc.currency || 'USD'})
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* Dropzone */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center transition-all ${
                    isDragging
                        ? 'border-accent bg-accent/5'
                        : selectedFile
                          ? 'border-accent/40 bg-accent/5'
                          : 'border-line-strong hover:border-accent/40 bg-canvas-subtle/60'
                }`}
            >
                <input
                    type="file"
                    id="report-file-upload"
                    className="hidden"
                    accept=".html,.htm,.csv,.xls,.xlsx,.xml,.pdf"
                    onChange={handleFileSelect}
                />

                {selectedFile ? (
                    <div className="w-full flex flex-col items-center gap-2.5">
                        <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/30 text-accent-fg flex items-center justify-center">
                            <CheckCircle2 size={24} />
                        </div>
                        <div className="min-w-0 max-w-full">
                            <p className="text-sm sm:text-base font-bold text-fg truncate px-4">
                                {selectedFile.name}
                            </p>
                            <p className="text-xs text-fg-muted mt-0.5">
                                {(selectedFile.size / 1024).toFixed(1)} KB
                            </p>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            <label
                                htmlFor="report-file-upload"
                                className="text-xs font-semibold text-accent-fg hover:underline cursor-pointer"
                            >
                                {isEn ? 'Replace' : 'Trocar'}
                            </label>
                            <span className="text-fg-subtle">·</span>
                            <button
                                type="button"
                                onClick={() => setSelectedFile(null)}
                                className="text-xs font-medium text-fg-muted hover:text-danger-fg inline-flex items-center gap-1"
                            >
                                <X size={13} /> {isEn ? 'Remove' : 'Remover'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <label
                        htmlFor="report-file-upload"
                        className="cursor-pointer flex flex-col items-center gap-2.5 w-full"
                    >
                        <div className="w-11 h-11 rounded-xl bg-surface-2 border border-line text-fg flex items-center justify-center">
                            <Upload size={20} />
                        </div>
                        <p className="text-sm sm:text-base font-semibold text-fg">
                            {isEn ? 'Click to browse or drag & drop statement' : 'Clique para selecionar ou arraste aqui'}
                        </p>
                    </label>
                )}
            </div>

            {/* Feedback */}
            {status && (
                <div
                    role="alert"
                    className={`p-4 rounded-xl border space-y-3 text-xs sm:text-sm ${
                        status.type === 'success'
                            ? 'bg-accent/10 border-accent/25 text-fg'
                            : 'bg-danger/10 border-danger/25 text-fg'
                    }`}
                >
                    <div className="flex items-start gap-2.5">
                        {status.type === 'success' ? (
                            <CheckCircle2 size={18} className="text-accent-fg shrink-0 mt-0.5" />
                        ) : (
                            <AlertTriangle size={18} className="text-danger-fg shrink-0 mt-0.5" />
                        )}
                        <p className="font-medium leading-relaxed">{status.message}</p>
                    </div>

                    {status.type === 'success' && (
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-accent/20">
                            <Button
                                variant="brand"
                                size="sm"
                                iconRight={<ArrowRight size={13} />}
                                onClick={() => {
                                    if (targetAccountId) selectAccount(targetAccountId);
                                    navigate('/journal');
                                }}
                            >
                                {isEn ? 'Journal' : 'Diário'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                icon={<BarChart2 size={13} />}
                                onClick={() => {
                                    if (targetAccountId) selectAccount(targetAccountId);
                                    navigate('/trades');
                                }}
                            >
                                {isEn ? 'Execution Ledger' : 'Operações'}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    if (targetAccountId) selectAccount(targetAccountId);
                                    navigate('/dashboard');
                                }}
                            >
                                Dashboard
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <Button
                variant="brand"
                size="lg"
                fullWidth
                onClick={handleFileUpload}
                disabled={!selectedFile || activeAccounts.length === 0}
                isLoading={isLoading}
                icon={<Upload size={17} />}
            >
                {isLoading ? (isEn ? 'Processing...' : 'Processando...') : (isEn ? 'Import Executions' : 'Importar')}
            </Button>

            {/* Compact Template Downloads */}
            <div className="pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs font-medium text-fg-muted">
                    {isEn ? 'Download blank template:' : 'Baixar modelo vazio:'}
                </span>
                <div className="grid grid-cols-4 gap-2">
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
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-canvas-subtle hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-colors border border-line"
                    >
                        <Download size={12} className="text-accent-fg" /> CSV
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
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-canvas-subtle hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-colors border border-line"
                    >
                        <FileSpreadsheet size={12} className="text-accent-fg" /> Excel
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
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-canvas-subtle hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-colors border border-line"
                    >
                        <FileCode size={12} className="text-accent-fg" /> HTML
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
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-canvas-subtle hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-colors border border-line"
                    >
                        <FileText size={12} className="text-accent-fg" /> PDF
                    </button>
                </div>
            </div>
        </div>
    );
};
