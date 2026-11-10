import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, inputCls } from './primitives';
import { ALL_BACKTEST_SYMBOLS, BacktestStrategy } from '../../services/backtestWorkspaceStore';

const WINDOWS = ['Ásia', 'Londres', 'Nova Iorque', 'Londres + Nova Iorque', 'Todas as sessões'];

export interface StrategyFormValues {
    name: string;
    description: string;
    sessionTag: string;
    startingCapital: number;
    riskPerTrade: number;
    rrTarget: number;
    primarySymbol: string;
}

const fromStrategy = (s?: BacktestStrategy): StrategyFormValues => ({
    name: s?.name || '',
    description: s?.description || '',
    sessionTag: s?.sessionTag || 'Londres + Nova Iorque',
    startingCapital: s?.startingCapital || 100000,
    riskPerTrade: s?.riskPerTrade || 1,
    rrTarget: s?.rrTarget || 2,
    primarySymbol: s?.primarySymbol || 'XAUUSD',
});

/** Create or edit a strategy (the parameters sessions inherit). */
export const StrategyFormModal = ({
    open,
    initial,
    onClose,
    onSubmit,
}: {
    open: boolean;
    initial?: BacktestStrategy;
    onClose: () => void;
    onSubmit: (v: StrategyFormValues) => void;
}) => {
    const [v, setV] = useState<StrategyFormValues>(() => fromStrategy(initial));
    useEffect(() => {
        if (open) setV(fromStrategy(initial));
    }, [open, initial]);

    const set = <K extends keyof StrategyFormValues>(k: K, val: StrategyFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
    const invalid = !v.name.trim() || !(v.startingCapital > 0) || !(v.riskPerTrade > 0 && v.riskPerTrade <= 10) || !(v.rrTarget > 0);

    return (
        <Modal isOpen={open} onClose={onClose} title={initial ? 'Editar estratégia' : 'Nova estratégia'}>
            <form
                className="space-y-4 p-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!invalid) onSubmit({ ...v, name: v.name.trim(), description: v.description.trim() });
                }}
            >
                <Field label="Nome" htmlFor="sf-name">
                    <input id="sf-name" required autoFocus value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Silver Bullet NY" className={inputCls} />
                </Field>
                <Field label="Descrição" htmlFor="sf-desc" hint="As confluências que definem uma entrada válida.">
                    <textarea id="sf-desc" rows={2} value={v.description} onChange={(e) => set('description', e.target.value)} className={inputCls} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Janela operacional" htmlFor="sf-window">
                        <select id="sf-window" value={v.sessionTag} onChange={(e) => set('sessionTag', e.target.value)} className={inputCls}>
                            {[...new Set([...WINDOWS, v.sessionTag])].map((w) => (
                                <option key={w}>{w}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Ativo principal" htmlFor="sf-symbol">
                        <select id="sf-symbol" value={v.primarySymbol} onChange={(e) => set('primarySymbol', e.target.value)} className={inputCls}>
                            {ALL_BACKTEST_SYMBOLS.map((s) => (
                                <option key={s.ticker} value={s.ticker}>
                                    {s.ticker}
                                </option>
                            ))}
                        </select>
                    </Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <Field label="Capital ($)" htmlFor="sf-cap">
                        <input id="sf-cap" type="number" min="1" value={v.startingCapital} onChange={(e) => set('startingCapital', Number(e.target.value))} className={inputCls} />
                    </Field>
                    <Field label="Risco (%)" htmlFor="sf-risk">
                        <input id="sf-risk" type="number" step="0.25" min="0.1" max="10" value={v.riskPerTrade} onChange={(e) => set('riskPerTrade', Number(e.target.value))} className={inputCls} />
                    </Field>
                    <Field label="Alvo R:R" htmlFor="sf-rr">
                        <input id="sf-rr" type="number" step="0.5" min="0.5" value={v.rrTarget} onChange={(e) => set('rrTarget', Number(e.target.value))} className={inputCls} />
                    </Field>
                </div>
                {initial && <p className="text-[11px] text-fg-subtle">Sessões já criadas mantêm o capital e o risco com que foram criadas.</p>}
                <div className="flex justify-end gap-2 border-t border-line pt-4">
                    <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button type="submit" variant="brand" size="sm" disabled={invalid}>
                        {initial ? 'Guardar' : 'Criar estratégia'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};
