import { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Upload, Download, CheckCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import api from '../../api';

interface ManualImportFormProps {
    onBack: () => void;
}

export const ManualImportForm = ({ onBack }: ManualImportFormProps) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
            setStatus(null);
        }
    };

    const handleFileUpload = async () => {
        if (!selectedFile) return;
        setIsLoading(true);
        setStatus(null);

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            await api.post('/import/report', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setStatus({ type: 'success', message: 'Report imported successfully! History updated.' });
            setSelectedFile(null); // Clear after success
        } catch (e: any) {
            setStatus({ type: 'error', message: e.response?.data?.message || e.message || 'Import failed' });
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
                    <div className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-400">
                        <Upload size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-100">Manual Import</h2>
                        <p className="text-sm text-slate-400">Upload your trade history from a file.</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="border-2 border-dashed border-slate-700/50 rounded-xl p-10 flex flex-col items-center justify-center text-center hover:border-emerald-500/50 hover:bg-slate-800/30 transition-all bg-slate-950/30">
                        <input
                            type="file"
                            id="report-upload"
                            className="hidden"
                            accept=".html,.htm,.csv,.xlsx"
                            onChange={handleFileSelect}
                        />
                        <label htmlFor="report-upload" className="cursor-pointer flex flex-col items-center gap-4 w-full h-full">
                            <div className={`p-4 rounded-full text-indigo-400 shadow-lg transition-all ${selectedFile ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800'}`}>
                                {selectedFile ? <CheckCircle size={32} /> : <Upload size={32} />}
                            </div>
                            <div>
                                <p className="text-slate-200 font-medium text-lg">
                                    {selectedFile ? selectedFile.name : 'Click to upload report'}
                                </p>
                                <p className="text-sm text-slate-500 mt-2">
                                    {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'Supports: .html (MT4/5), .csv, .xlsx'}
                                </p>
                            </div>
                        </label>
                    </div>

                    <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/50">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Templates & Guides</h4>
                        <div className="flex gap-4">
                            <button
                                onClick={() => window.open('/template.csv')}
                                className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                            >
                                <Download size={14} /> Download CSV Template
                            </button>
                        </div>
                    </div>

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
                        className="w-full py-4"
                        onClick={handleFileUpload}
                        disabled={!selectedFile || isLoading}
                        isLoading={isLoading}
                        icon={<Upload size={18} />}
                    >
                        Import Selected File
                    </Button>
                </div>
            </Card>
        </div>
    );
};
