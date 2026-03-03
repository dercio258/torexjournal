import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface ManualTradeModalProps {
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
}

export const ManualTradeModal: React.FC<ManualTradeModalProps> = ({ onClose, onSave }) => {
    const [formData, setFormData] = useState({
        symbol: '',
        type: 'BUY',
        volume: 0.01,
        openPrice: 0,
        closePrice: 0,
        openTime: '',
        closeTime: '',
        profit: 0,
        mood: '',
        setup: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: ['volume', 'openPrice', 'closePrice', 'profit'].includes(name) ? Number(value) : value
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Basic Validation
        if (!formData.symbol || !formData.openTime || !formData.closeTime) {
            alert('Preencha os campos obrigatórios');
            return;
        }
        await onSave(formData);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <Card className="w-full max-w-lg relative animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-500 hover:text-slate-300"
                >
                    <X size={20} />
                </button>

                <h2 className="text-xl font-bold text-slate-100 mb-6">Adicionar Trade Manual</h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Ativo</label>
                            <input
                                name="symbol"
                                value={formData.symbol}
                                onChange={handleChange}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 uppercase"
                                placeholder="EURUSD"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Tipo</label>
                            <select
                                name="type"
                                value={formData.type}
                                onChange={handleChange}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
                            >
                                <option value="BUY">BUY</option>
                                <option value="SELL">SELL</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Volume</label>
                            <input
                                type="number" step="0.01"
                                name="volume"
                                value={formData.volume}
                                onChange={handleChange}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Lucro ($)</label>
                            <input
                                type="number" step="0.01"
                                name="profit"
                                value={formData.profit}
                                onChange={handleChange}
                                className={`w-full bg-slate-900 border border-slate-700 rounded p-2 font-bold ${formData.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Preço Entrada</label>
                            <input
                                type="number" step="0.00001"
                                name="openPrice"
                                value={formData.openPrice}
                                onChange={handleChange}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Preço Saída</label>
                            <input
                                type="number" step="0.00001"
                                name="closePrice"
                                value={formData.closePrice}
                                onChange={handleChange}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Abertura</label>
                            <input
                                type="datetime-local"
                                name="openTime"
                                value={formData.openTime}
                                onChange={handleChange}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 text-xs"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Fechamento</label>
                            <input
                                type="datetime-local"
                                name="closeTime"
                                value={formData.closeTime}
                                onChange={handleChange}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 text-xs"
                            />
                        </div>
                    </div>

                    <div className="border-t border-slate-800 pt-4 mt-2">
                        <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Humor & Setup</label>
                        <div className="grid grid-cols-2 gap-4">
                            <input
                                name="mood"
                                value={formData.mood}
                                onChange={handleChange}
                                placeholder="Humor ex: Calmo"
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
                            />
                            <input
                                name="setup"
                                value={formData.setup}
                                onChange={handleChange}
                                placeholder="Setup ex: Pullback"
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <Button type="submit" className="w-full sm:w-auto" icon={<Save size={16} />}>
                            Salvar Trade
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    );
};
