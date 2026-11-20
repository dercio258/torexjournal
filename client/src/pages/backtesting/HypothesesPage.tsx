import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CloudDownload, Cpu, Database, FlaskConical, History, Lightbulb, Play, RefreshCw, Save, ShieldAlert, Sigma, Sliders, Sparkles, Trash2, TrendingUp } from 'lucide-react';
import api from '../../api';
import {
    deleteBacktestSessionOfflineAware,
    saveBacktestHypothesisOfflineAware,
} from '../../services/offlineMutations';
import { useAccount } from '../../context/AccountContext';
import { useBacktestWorkspaceStore } from '../../store/useBacktestWorkspaceStore';
import { Button } from '../../components/ui/Button';
import { ComparisonChart } from '../../components/backtesting/ComparisonChart';
import { QuantTearSheetPanel, type TearSheetData } from '../../components/backtesting/QuantTearSheetPanel';
import { runProjection, ProjectionInput } from '../../components/backtesting/projection';
import { stripHtmlPreview } from '../../components/backtesting/useBacktestJournalSupport';
import {
    Badge,
    EmptyState,
    Field,
    fmtDateTime,
    fmtMoney,
    fmtNum,
    inputCls,
    KpiCard,
    Panel,
    pnlTone,
    SubTabs,
    Toggle,
} from '../../components/backtesting/primitives';
import { cn } from '../../lib/cn';
import { getQuantAuthHeaders } from '../../lib/quantAuth';
import { useLocale } from '../../context/LocaleContext';

type View = 'account' | 'projection' | 'optimizer' | 'saved';

const RR_PRESETS = [1, 1.5, 2, 2.5, 3];

const Assumptions = ({ items, isEn }: { items: string[]; isEn: boolean }) => (
    <div className="rounded-lg border border-line bg-surface-2/50 p-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{isEn ? 'Assumptions' : 'Premissas'}</p>
        <ul className="space-y-1 text-[11px] leading-relaxed text-fg-muted">
            {items.map((t) => (
                <li key={t} className="flex gap-1.5">
                    <span aria-hidden>·</span>
                    {t}
                </li>
            ))}
        </ul>
    </div>
);

const RrPicker = ({ value, onChange, isEn }: { value: number; onChange: (v: number) => void; isEn: boolean }) => (
    <div role="radiogroup" aria-label={isEn ? 'Target R:R' : 'Alvo R:R'} className="flex flex-wrap gap-1.5">
        {RR_PRESETS.map((rr) => (
            <button
                key={rr}
                type="button"
                role="radio"
                aria-checked={value === rr}
                onClick={() => onChange(rr)}
                className={cn('min-w-[3.25rem] rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums transition-colors', value === rr ? 'border-fg bg-fg text-canvas' : 'border-line bg-surface-2 text-fg-muted hover:text-fg')}
            >
                1:{rr}
            </button>
        ))}
    </div>
);

/* ------------------------------------------------------- account what-if */

interface WhatIfResult {
    accountName: string;
    message?: string;
    comparison: any;
    equityCurve: { date: string; realEquity: number; simulatedEquity: number }[];
    insights: string[];
}

const ResultRow = ({ label, real, hyp, fmt, better }: { label: string; real: number | null; hyp: number | null; fmt: (v: number) => string; better: 'up' | 'down' }) => {
    const d = real !== null && hyp !== null ? hyp - real : null;
    const good = d !== null && (better === 'up' ? d > 0 : d < 0);
    const bad = d !== null && (better === 'up' ? d < 0 : d > 0);
    return (
        <tr>
            <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">
                {label}
            </th>
            <td className="px-4 py-2 text-right tabular-nums text-fg">{real === null ? '—' : fmt(real)}</td>
            <td className="px-4 py-2 text-right font-semibold tabular-nums text-fg">{hyp === null ? '—' : fmt(hyp)}</td>
            <td className={cn('px-4 py-2 text-right tabular-nums', good ? 'text-accent-fg' : bad ? 'text-danger-fg' : 'text-fg-subtle')}>
                {d === null || Math.abs(d) < 1e-9 ? '—' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d)).replace(/^[+−-]/, '')}`}
            </td>
        </tr>
    );
};

const AccountHypothesis = ({ isEn }: { isEn: boolean }) => {
    const { selectedAccountId, selectedAccount } = useAccount();
    const accountLabel = selectedAccount?.name || (isEn ? 'All Accounts' : 'Todas as contas');
    const [cfg, setCfg] = useState({ initialBalance: 10000, riskPerTrade: 1, rrTarget: 2, excludeAsian: false, excludeFridays: false });
    const [running, setRunning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<WhatIfResult | null>(null);

    useEffect(() => {
        const bal = Number(selectedAccount?.initialBalance || selectedAccount?.balance) || 10000;
        setCfg((c) => ({ ...c, initialBalance: bal }));
        setResult(null);
    }, [selectedAccount?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const accountParam = selectedAccountId !== 'all' ? selectedAccountId : undefined;

    const run = async () => {
        setRunning(true);
        setError(null);
        setSaved(false);
        try {
            const res = await api.post('/dashboard/backtest/simulate', { mode: 'ACCOUNT_HISTORY', ...cfg }, { params: { accountId: accountParam } });
            setResult(res.data);
        } catch (e: any) {
            setError(e?.response?.data?.message || (isEn ? 'Failed to run What-If simulation.' : 'Não foi possível executar a simulação.'));
        } finally {
            setRunning(false);
        }
    };

    const save = async () => {
        if (!result?.comparison) return;
        setSaving(true);
        try {
            await saveBacktestHypothesisOfflineAware(
                {
                    name: `${isEn ? 'Hypothesis' : 'Hipótese'} 1:${cfg.rrTarget} · ${cfg.riskPerTrade}%${cfg.excludeAsian ? (isEn ? ' · no Asia' : ' · sem Ásia') : ''}${cfg.excludeFridays ? (isEn ? ' · no Fridays' : ' · sem sextas') : ''}`,
                    mode: 'ACCOUNT_HISTORY',
                    strategy: isEn ? 'Account History What-If' : 'Hipótese sobre o histórico',
                    symbol: 'ALL',
                    config: cfg,
                    results: result.comparison,
                    notes: (result.insights || []).join(' '),
                },
                accountParam
            );
            setSaved(true);
        } finally {
            setSaving(false);
        }
    };

    const c = result?.comparison;
    const curve = useMemo(
        () =>
            (result?.equityCurve || []).map((p, i) => ({
                label: p.date && p.date !== 'N/A' ? (isEn ? `${p.date.slice(5, 7)}/${p.date.slice(8, 10)}` : `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`) : `#${i + 1}`,
                a: Math.round((p.realEquity - cfg.initialBalance) * 100) / 100,
                b: Math.round((p.simulatedEquity - cfg.initialBalance) * 100) / 100,
            })),
        [result, cfg.initialBalance, isEn]
    );

    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <Panel
                title={isEn ? 'What-If Hypothesis' : 'Hipótese'}
                subtitle={isEn ? 'Re-simulates position sizing and R:R rules across your historical trades.' : 'Reaplica regras de gestão aos trades que já fez.'}
            >
                <div className="space-y-4">
                    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/50 p-3 text-xs">
                        <Database size={15} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden />
                        <p className="text-fg-muted">
                            {isEn ? 'Source:' : 'Fonte:'} <strong className="text-fg">{isEn ? `closed executions from ${accountLabel}` : `trades fechados de ${accountLabel}`}</strong>{isEn ? ', ordered by close timestamp. Switch portfolio in the top selector.' : ', por ordem de fecho. Mude a conta no seletor do topo.'}
                        </p>
                    </div>
                    <Field label={isEn ? 'Target R:R per trade' : 'Alvo R:R por trade'}>
                        <RrPicker value={cfg.rrTarget} onChange={(v) => setCfg({ ...cfg, rrTarget: v })} isEn={isEn} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Risk (%)' : 'Risco (%)'} htmlFor="wi-risk">
                            <input id="wi-risk" type="number" step="0.25" min="0.1" max="10" value={cfg.riskPerTrade} onChange={(e) => setCfg({ ...cfg, riskPerTrade: Number(e.target.value) })} className={inputCls} />
                        </Field>
                        <Field label={isEn ? 'Starting Balance ($)' : 'Saldo inicial ($)'} htmlFor="wi-bal">
                            <input id="wi-bal" type="number" min="1" value={cfg.initialBalance} onChange={(e) => setCfg({ ...cfg, initialBalance: Number(e.target.value) })} className={inputCls} />
                        </Field>
                    </div>
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-fg">{isEn ? 'Session Filters' : 'Filtros'}</p>
                        <Toggle
                            checked={cfg.excludeAsian}
                            onChange={(v) => setCfg({ ...cfg, excludeAsian: v })}
                            label={isEn ? 'Exclude Asian Session' : 'Excluir sessão asiática'}
                            description={isEn ? 'Trades opened between 22:00 and 08:00 UTC (Sydney/Tokyo).' : 'Trades abertos entre 22h e 08h UTC (Sydney/Tóquio).'}
                        />
                        <Toggle
                            checked={cfg.excludeFridays}
                            onChange={(v) => setCfg({ ...cfg, excludeFridays: v })}
                            label={isEn ? 'Exclude Fridays' : 'Excluir sextas-feiras'}
                            description={isEn ? 'Filtered by close day in UTC.' : 'Pelo dia de fecho, em UTC.'}
                        />
                    </div>
                    <Assumptions
                        isEn={isEn}
                        items={
                            isEn
                                ? [
                                      'Each winning trade pays +R:R × risk; each loser costs −1 × risk.',
                                      'Risk compounds dynamically as a % of simulated equity.',
                                      'Breakeven trades are skipped; no extra spread or commissions applied.',
                                      'Assumes winners reach the simulated R:R target — an optimistic ceiling.',
                                  ]
                                : [
                                      'Cada trade vencedor passa a valer +R:R × risco; cada perdedor, −1 × risco.',
                                      'O risco é uma % do saldo simulado no momento (juros compostos).',
                                      'Trades a zero não contam; não há spread nem comissão adicionais.',
                                      'Assume que os ganhos teriam chegado ao alvo — um teto otimista.',
                                  ]
                        }
                    />
                    <Button variant="brand" fullWidth isLoading={running} icon={<Play size={14} fill="currentColor" />} onClick={run} disabled={!(cfg.riskPerTrade > 0) || !(cfg.initialBalance > 0)}>
                        {isEn ? 'Run Hypothesis' : 'Testar hipótese'}
                    </Button>
                </div>
            </Panel>

            <div className="min-w-0 space-y-4">
                {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger-fg">{error}</p>}
                {!result ? (
                    <EmptyState
                        icon={<Lightbulb size={20} />}
                        title={isEn ? 'Configure & run a hypothesis' : 'Defina a hipótese e teste'}
                        description={isEn ? 'Compares your actual equity curve against the same sequence of trades under revised risk rules.' : 'O resultado compara a conta real com a mesma sequência de trades sob as novas regras.'}
                    />
                ) : !c ? (
                    <EmptyState
                        title={isEn ? 'No trades to simulate' : 'Sem trades para simular'}
                        description={result.message || (isEn ? 'This account has no closed trades yet.' : 'Esta conta ainda não tem trades fechados.')}
                    />
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <KpiCard label={isEn ? 'Actual Net P&L' : 'Resultado real'} value={fmtMoney(c.realNetProfit, { sign: true })} tone={pnlTone(c.realNetProfit)} hint={`${c.realTrades} trades`} />
                            <KpiCard label={isEn ? 'Simulated Net P&L' : 'Com a hipótese'} value={fmtMoney(c.simulatedNetProfit, { sign: true })} tone={pnlTone(c.simulatedNetProfit)} hint={`${c.simulatedTrades} ${isEn ? 'trades included' : 'trades considerados'}`} />
                            <KpiCard label={isEn ? 'Net Variance' : 'Diferença'} value={fmtMoney(c.profitDelta, { sign: true })} tone={pnlTone(c.profitDelta)} hint={c.excludedTrades ? `${c.excludedTrades} ${isEn ? 'filtered out' : 'excluídos pelos filtros'}` : (isEn ? 'No trades excluded' : 'Sem trades excluídos')} className="col-span-2 md:col-span-1" />
                        </div>

                        <Panel title={isEn ? 'Cumulative Equity Curve' : 'Curva acumulada'} subtitle={isEn ? 'Trade-by-trade cumulative P&L by close date.' : 'P&L acumulado, trade a trade, pela data de fecho.'}>
                            <ComparisonChart data={curve} labelA={isEn ? 'Actual' : 'Real'} labelB={isEn ? 'Simulated' : 'Hipótese'} />
                        </Panel>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
                            <Panel
                                title={isEn ? 'Performance Comparison' : 'Comparação'}
                                bodyClassName="p-0"
                                actions={
                                    <Button variant="outline" size="sm" isLoading={saving} icon={<Save size={13} />} onClick={save} disabled={saved}>
                                        {saved ? (isEn ? 'Saved' : 'Guardada') : (isEn ? 'Save Simulation' : 'Guardar simulação')}
                                    </Button>
                                }
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[460px] text-sm">
                                        <thead>
                                            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-fg-subtle">
                                                <th className="px-4 py-2 text-left font-semibold">{isEn ? 'Metric' : 'Métrica'}</th>
                                                <th className="px-4 py-2 text-right font-semibold">{isEn ? 'Actual' : 'Real'}</th>
                                                <th className="px-4 py-2 text-right font-semibold">{isEn ? 'Simulated' : 'Hipótese'}</th>
                                                <th className="px-4 py-2 text-right font-semibold">{isEn ? 'Delta' : 'Diferença'}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line">
                                            <ResultRow label={isEn ? 'Net P&L' : 'Resultado líquido'} real={c.realNetProfit} hyp={c.simulatedNetProfit} fmt={(v) => fmtMoney(v)} better="up" />
                                            <ResultRow label={isEn ? 'Win Rate' : 'Taxa de acerto'} real={c.realWinRate ?? null} hyp={c.simulatedWinRate} fmt={(v) => `${fmtNum(v, 1)}%`} better="up" />
                                            <ResultRow label={isEn ? 'Profit Factor' : 'Profit factor'} real={c.realProfitFactor ?? null} hyp={c.simulatedProfitFactor ?? null} fmt={(v) => fmtNum(v)} better="up" />
                                            <ResultRow label={isEn ? 'Max Drawdown' : 'Drawdown máx.'} real={c.realMaxDrawdown ?? null} hyp={c.simulatedMaxDrawdown} fmt={(v) => fmtMoney(v)} better="down" />
                                            <ResultRow label={isEn ? 'Max Drawdown (%)' : 'Drawdown máx. (%)'} real={c.realMaxDrawdownPercent ?? null} hyp={c.simulatedMaxDrawdownPercent} fmt={(v) => `${fmtNum(v, 1)}%`} better="down" />
                                        </tbody>
                                    </table>
                                </div>
                            </Panel>
                            <Panel title={isEn ? 'Key Takeaways' : 'Leitura'}>
                                <ul className="space-y-2 text-xs leading-relaxed text-fg-muted">
                                    {(result.insights || []).map((t) => (
                                        <li key={t} className="flex gap-2">
                                            <span aria-hidden className="text-fg-subtle">→</span>
                                            {t}
                                        </li>
                                    ))}
                                </ul>
                            </Panel>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------ projection */

const Projection = ({ isEn }: { isEn: boolean }) => {
    const { selectedAccountId } = useAccount();
    const [inp, setInp] = useState<ProjectionInput>({ capital: 10000, riskPct: 1, rr: 2, winRatePct: 45, trades: 100, sizing: 'fixed', ruinPct: 20 });
    const [result, setResult] = useState(() => runProjection(inp));
    const [simulating, setSimulating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedMsg, setSavedMsg] = useState(false);
    const set = <K extends keyof ProjectionInput>(k: K, v: ProjectionInput[K]) => {
        setSavedMsg(false);
        setInp((p) => ({ ...p, [k]: v }));
    };
    const valid = inp.capital > 0 && inp.riskPct > 0 && inp.rr > 0 && inp.winRatePct >= 0 && inp.winRatePct <= 100 && inp.trades >= 1 && inp.trades <= 2000;
    const maxCount = Math.max(...result.histogram.map((h) => h.count), 1);

    const saveProjection = async () => {
        setSaving(true);
        try {
            await saveBacktestHypothesisOfflineAware(
                {
                    accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined,
                    name: `${isEn ? 'MC Projection' : 'Projeção MC'} · ${inp.winRatePct}% WR · ${inp.rr}R (${inp.trades} trades)`,
                    mode: 'STRATEGY_SIM',
                    config: inp,
                    results: {
                        simulatedTrades: inp.trades,
                        simulatedWinRate: inp.winRatePct,
                        simulatedNetProfit: result.percentiles.p50,
                        expectancyR: result.expectancyR,
                        probLoss: result.probLoss,
                        probRuin: result.probRuin,
                        medianMaxDdPct: result.medianMaxDdPct,
                        percentiles: result.percentiles,
                    },
                    notes: isEn
                        ? `Risk ${inp.riskPct}% (${inp.sizing === 'compound' ? 'compounded' : 'fixed'}) · Ruin (${inp.ruinPct}%): ${fmtNum(result.probRuin, 1)}%`
                        : `Risco ${inp.riskPct}% (${inp.sizing === 'compound' ? 'composto' : 'fixo'}) · Ruína (${inp.ruinPct}%): ${fmtNum(result.probRuin, 1)}%`,
                },
                selectedAccountId !== 'all' ? selectedAccountId : undefined
            );
            setSavedMsg(true);
        } catch {
            // silent fallback
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <Panel
                title={isEn ? 'Monte Carlo Parameters' : 'Parâmetros'}
                subtitle={isEn ? 'How much variance can this statistical edge produce?' : 'Quanto pode variar um resultado com esta vantagem?'}
            >
                <form
                    className="space-y-4"
                    onSubmit={async (e) => {
                        e.preventDefault();
                        if (!valid) return;
                        setSimulating(true);
                        const seed = Math.floor(Math.random() * 1e9);
                        try {
                            const res = await fetch('/api/quant/simulate/monte-carlo', {
                                method: 'POST',
                                headers: getQuantAuthHeaders({ 'Content-Type': 'application/json' }),
                                body: JSON.stringify({
                                    capital: inp.capital,
                                    riskPct: inp.riskPct,
                                    rr: inp.rr,
                                    winRatePct: inp.winRatePct,
                                    trades: inp.trades,
                                    sizing: inp.sizing,
                                    ruinPct: inp.ruinPct,
                                    runs: 2500,
                                    seed,
                                }),
                                signal: AbortSignal.timeout(3500),
                            });
                            if (res.ok) {
                                const pyData = await res.json();
                                if (pyData?.percentiles && Array.isArray(pyData?.histogram)) {
                                    setResult(pyData);
                                    return;
                                }
                            }
                        } catch {
                            // fallback below
                        } finally {
                            setSimulating(false);
                        }
                        setResult(runProjection({ ...inp, seed }));
                    }}
                >
                    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                        <Sigma size={15} className="mt-0.5 shrink-0" aria-hidden />
                        <p>
                            {isEn
                                ? 'Hypothetical: models random outcomes from the inputs below, not market ticks. Use for risk sizing, not edge validation.'
                                : 'Hipotético: não usa dados de mercado, só os números abaixo. Use para dimensionar risco, não para validar uma estratégia.'}
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Win Rate (%)' : 'Taxa de acerto (%)'}>
                            <input type="number" min="0" max="100" step="1" value={inp.winRatePct} onChange={(e) => set('winRatePct', Number(e.target.value))} className={inputCls} />
                        </Field>
                        <Field label="Trades">
                            <input type="number" min="1" max="2000" step="10" value={inp.trades} onChange={(e) => set('trades', Number(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <Field label={isEn ? 'Target R:R' : 'Alvo R:R'}>
                        <RrPicker value={inp.rr} onChange={(v) => set('rr', v)} isEn={isEn} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Risk (%)' : 'Risco (%)'}>
                            <input type="number" min="0.1" max="10" step="0.25" value={inp.riskPct} onChange={(e) => set('riskPct', Number(e.target.value))} className={inputCls} />
                        </Field>
                        <Field label={isEn ? 'Capital ($)' : 'Capital ($)'}>
                            <input type="number" min="1" value={inp.capital} onChange={(e) => set('capital', Number(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Position Sizing' : 'Dimensionamento'}>
                            <select value={inp.sizing} onChange={(e) => set('sizing', e.target.value as ProjectionInput['sizing'])} className={inputCls}>
                                <option value="fixed">{isEn ? 'Fixed Risk' : 'Risco fixo'}</option>
                                <option value="compound">{isEn ? 'Compounded' : 'Composto'}</option>
                            </select>
                        </Field>
                        <Field label={isEn ? 'Ruin Threshold (%)' : 'Limite de ruína (%)'} hint={isEn ? 'Drawdown from peak.' : 'Drawdown a partir do pico.'}>
                            <input type="number" min="1" max="100" step="1" value={inp.ruinPct} onChange={(e) => set('ruinPct', Number(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <Button type="submit" variant="brand" fullWidth isLoading={simulating} icon={<RefreshCw size={14} />} disabled={!valid}>
                        {isEn ? `Simulate ${result.runs.toLocaleString('en-US')} runs` : `Simular ${result.runs.toLocaleString('pt-BR')} cenários`}
                    </Button>
                </form>
            </Panel>

            <div className="min-w-0 space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <KpiCard label={isEn ? 'Expectancy' : 'Expectativa'} value={`${result.expectancyR > 0 ? '+' : ''}${fmtNum(result.expectancyR)}R`} tone={pnlTone(result.expectancyR)} hint={isEn ? `Breakeven: ${fmtNum(result.breakevenWinRate, 1)}% WR` : `Equilíbrio: ${fmtNum(result.breakevenWinRate, 1)}% de acerto`} />
                    <KpiCard label={isEn ? 'Median Outcome' : 'Resultado mediano'} value={fmtMoney(result.percentiles.p50, { sign: true })} tone={pnlTone(result.percentiles.p50)} hint={isEn ? `after ${inp.trades} trades` : `após ${inp.trades} trades`} />
                    <KpiCard label={isEn ? 'Loss Probability' : 'Probabilidade de prejuízo'} value={`${fmtNum(result.probLoss, 1)}%`} hint={isEn ? 'Runs ending below start capital' : 'Cenários que acabam abaixo do capital'} />
                    <KpiCard label={isEn ? `Risk of Ruin (${inp.ruinPct}%)` : `Risco de ruína (${inp.ruinPct}%)`} value={`${fmtNum(result.probRuin, 1)}%`} tone={result.probRuin >= 10 ? 'text-danger-fg' : undefined} hint={`${isEn ? 'Median Max DD' : 'Drawdown mediano'} ${fmtNum(result.medianMaxDdPct, 1)}%`} />
                </div>

                <Panel
                    title={isEn ? 'Outcome Distribution' : 'Distribuição do resultado final'}
                    subtitle={`${result.runs.toLocaleString(isEn ? 'en-US' : 'pt-BR')} ${isEn ? 'randomized trade sequences with identical edge parameters' : 'sequências aleatórias com os mesmos parâmetros'}`}
                    actions={
                        <Button
                            variant="outline"
                            size="sm"
                            icon={<Save size={13} />}
                            isLoading={saving}
                            disabled={savedMsg || !valid}
                            onClick={saveProjection}
                        >
                            {savedMsg ? (isEn ? 'Saved' : 'Guardada') : (isEn ? 'Save Projection' : 'Guardar projeção')}
                        </Button>
                    }
                >
                    <div className="flex h-40 items-end gap-0.5" role="img" aria-label={isEn ? `From worst 5% (${fmtMoney(result.percentiles.p5)}) to best 5% (${fmtMoney(result.percentiles.p95)})` : `Do pior 5% (${fmtMoney(result.percentiles.p5)}) ao melhor 5% (${fmtMoney(result.percentiles.p95)})`}>
                        {result.histogram.map((h, i) => {
                            const mid = (h.from + h.to) / 2;
                            return (
                                <div
                                    key={i}
                                    title={`${fmtMoney(h.from)} ${isEn ? 'to' : 'a'} ${fmtMoney(h.to)}: ${h.count} ${isEn ? 'runs' : 'cenários'}`}
                                    className={cn('min-w-0 flex-1 rounded-t-[3px]', mid < 0 ? 'bg-data-neg/70' : 'bg-data-pos/70')}
                                    style={{ height: `${Math.max(1, (h.count / maxCount) * 100)}%` }}
                                />
                            );
                        })}
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] tabular-nums text-fg-subtle">
                        <span>{fmtMoney(result.histogram[0]?.from ?? 0)}</span>
                        <span>{fmtMoney(result.histogram[result.histogram.length - 1]?.to ?? 0)}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-5 gap-2 border-t border-line pt-3 text-center">
                        {(
                            [
                                [isEn ? 'Worst 5%' : 'Pior 5%', result.percentiles.p5],
                                ['25%', result.percentiles.p25],
                                [isEn ? 'Median' : 'Mediana', result.percentiles.p50],
                                ['75%', result.percentiles.p75],
                                [isEn ? 'Best 5%' : 'Melhor 5%', result.percentiles.p95],
                            ] as const
                        ).map(([k, v]) => (
                            <div key={k}>
                                <dt className="text-[11px] text-fg-subtle">{k}</dt>
                                <dd className={cn('mt-0.5 text-sm font-semibold tabular-nums', pnlTone(v))}>{fmtMoney(v, { sign: true, decimals: 0 })}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mt-3 text-[11px] text-fg-subtle">
                        {isEn
                            ? `Median longest losing streak: ${result.longestLosingStreakMedian} consecutive losses.`
                            : `Sequência de perdas mais longa (mediana): ${result.longestLosingStreakMedian} trades seguidos.`}
                    </p>
                </Panel>
            </div>
        </div>
    );
};

/* ---------------------------------------------------------------- saved */

const Saved = ({ isEn }: { isEn: boolean }) => {
    const { selectedAccountId } = useAccount();
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/dashboard/backtest/history', { params: { accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined } });
            setItems(Array.isArray(res.data) ? res.data : []);
        } catch {
            setError(isEn ? 'Failed to load saved simulations.' : 'Não foi possível carregar as simulações guardadas.');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        load();
    }, [selectedAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

    const typeLabel = (m: string) =>
        m === 'REPLAY_SESSION'
            ? isEn ? 'Replay Session' : 'Sessão de replay'
            : m === 'STRATEGY_SIM'
            ? isEn ? 'Projection' : 'Projeção'
            : isEn ? 'Hypothesis' : 'Hipótese';

    const handleDeleteSaved = async (id: string) => {
        try {
            await deleteBacktestSessionOfflineAware(id);
            setItems((prev) => prev.filter((item) => item.id !== id));
        } catch {
            // ignore error
        }
    };

    return (
        <Panel
            title={isEn ? 'Saved Simulations' : 'Simulações guardadas'}
            subtitle={isEn ? 'Stored server-side (latest 20 for selected portfolio).' : 'Guardadas no servidor (últimas 20 da conta selecionada).'}
            actions={
                <Button variant="outline" size="sm" icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />} onClick={load}>
                    {isEn ? 'Refresh' : 'Atualizar'}
                </Button>
            }
            bodyClassName="p-0"
        >
            {error ? (
                <p className="px-5 py-8 text-center text-xs text-danger-fg">{error}</p>
            ) : items.length === 0 ? (
                <p className="px-5 py-10 text-center text-xs text-fg-muted">
                    {loading ? (isEn ? 'Loading…' : 'A carregar…') : (isEn ? 'No saved simulations yet.' : 'Ainda não guardou nenhuma simulação.')}
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                <th className="px-4 py-2 font-semibold">{isEn ? 'Name' : 'Nome'}</th>
                                <th className="px-3 py-2 font-semibold">{isEn ? 'Type' : 'Tipo'}</th>
                                <th className="px-3 py-2 font-semibold">{isEn ? 'Account' : 'Conta'}</th>
                                <th className="px-3 py-2 text-right font-semibold">Trades</th>
                                <th className="px-3 py-2 text-right font-semibold">{isEn ? 'Win Rate' : 'Acerto'}</th>
                                <th className="px-3 py-2 text-right font-semibold">{isEn ? 'Outcome' : 'Resultado'}</th>
                                <th className="px-3 py-2 text-right font-semibold">{isEn ? 'Date' : 'Data'}</th>
                                <th className="w-10 px-3 py-2 text-right font-semibold" aria-label={isEn ? 'Actions' : 'Ações'} />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {items.map((s) => {
                                const r = s.results || {};
                                const tradesCount = r.simulatedTrades ?? r.closedTradesCount;
                                const winRateVal = r.simulatedWinRate ?? r.winRate;
                                const net = Number(r.simulatedNetProfit ?? r.netPnl ?? 0);
                                const cleanNote = stripHtmlPreview(s.notes);
                                return (
                                    <tr key={s.id} className="hover:bg-surface-2/50">
                                        <td className="max-w-[18rem] px-4 py-2">
                                            <p className="truncate font-semibold text-fg">{s.name}</p>
                                            {cleanNote && <p className="truncate text-[11px] text-fg-muted">{cleanNote}</p>}
                                        </td>
                                        <td className="px-3 py-2">
                                            <Badge>{typeLabel(s.mode)}</Badge>
                                        </td>
                                        <td className="px-3 py-2 text-fg-muted">{s.account?.name || '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{tradesCount ?? '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{winRateVal !== undefined ? `${fmtNum(Number(winRateVal), 1)}%` : '—'}</td>
                                        <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', pnlTone(net))}>{fmtMoney(net, { sign: true })}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right text-fg-muted">{fmtDateTime(s.createdAt)}</td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                type="button"
                                                title={isEn ? 'Remove saved entry' : 'Remover registo guardado'}
                                                onClick={() => void handleDeleteSaved(s.id)}
                                                className="inline-flex items-center justify-center rounded-md p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </Panel>
    );
};

/* --------------------------------------------------- quant optimizer (vectorbt + optuna) */

type StrategyFamilyOption = 'SMC_DONCHIAN_ATR' | 'EMA_CROSS_RSI' | 'BOLLINGER_MEAN_REV';
type ObjectiveMetricOption = 'composite' | 'sharpe' | 'calmar' | 'profit_factor';

interface VectorSweepConfigRow {
    rank: number;
    fastPeriod: number;
    slowPeriod: number;
    slAtrMult: number;
    rrTarget: number;
    totalTrades: number;
    winRatePct: number;
    profitFactor: number;
    sharpeRatio: number;
    sortinoRatio: number;
    totalReturnPct: number;
    netProfitUsd: number;
    maxDrawdownPct: number;
    score: number;
}

interface HeatmapCell {
    xLabel: string;
    yLabel: string;
    xVal: number;
    yVal: number;
    sharpeRatio: number;
    totalReturnPct: number;
    winRatePct: number;
    trades: number;
}

type DataModeOption = 'REAL' | 'AUTO' | 'SYNTHETIC';
type SessionFilterOption = 'ALL' | 'LONDON_NY' | 'LONDON_ONLY' | 'NY_ONLY' | 'NO_ASIA';

interface ParquetDatasetEntry {
    symbol: string;
    timeframe: string;
    source: string;
    isRealMarket: boolean;
    barsCount: number;
    fromTimestamp: number;
    toTimestamp: number;
    fileSizeBytes: number;
    updatedAtIso: string;
    filePath: string;
}

interface ParquetCatalogResponse {
    datasets: ParquetDatasetEntry[];
    totalDatasets: number;
    realDatasetsCount: number;
    totalBars: number;
}

interface RealisticVerificationSummary {
    engine: string;
    totalTrades: number;
    winRatePct: number;
    profitFactor: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    netPnlUsd: number;
    totalSpreadCostUsd: number;
    totalSlippageCostUsd: number;
    totalCommissionCostUsd: number;
    totalFrictionUsd: number;
    signalsGenerated: number;
    signalsFilteredBySession: number;
    avgMfeR: number;
    avgMaeR: number;
    expectancyR: number;
    verdict: string;
}

interface VectorSweepResponse {
    engine: string;
    symbol: string;
    timeframe: string;
    strategyFamily: StrategyFamilyOption;
    barsProcessed: number;
    totalCombinations: number;
    elapsedMs: number;
    combinationsPerSec: number;
    topConfigs: VectorSweepConfigRow[];
    heatmapCells: HeatmapCell[];
    summaryText: string;
    dataSourceUsed?: string;
    isRealMarketData?: boolean;
    sessionFilter?: SessionFilterOption;
    signalsFilteredBySession?: number;
}

interface WalkForwardSplitMetrics {
    totalTrades: number;
    winRatePct: number;
    profitFactor: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    totalReturnPct: number;
    netProfitUsd: number;
    maxDrawdownPct: number;
}

interface OptunaOptimizeResponse {
    engine: string;
    symbol: string;
    timeframe: string;
    strategyFamily: StrategyFamilyOption;
    objectiveMetric: string;
    barsProcessed: number;
    trainBars: number;
    testBars: number;
    nTrialsCompleted: number;
    elapsedMs: number;
    bestScore: number;
    bestParams: {
        fastPeriod: number;
        slowPeriod: number;
        slAtrMult: number;
        rrTarget: number;
        riskPct: number;
        rsiThreshold: number;
    };
    inSampleMetrics: WalkForwardSplitMetrics;
    outOfSampleMetrics: WalkForwardSplitMetrics;
    robustnessVerdict: string;
    robustnessTone: 'accent' | 'warn' | 'danger';
    paramImportances: Record<string, number>;
    topTrials: Array<{
        trialNumber: number;
        score: number;
        fastPeriod: number;
        slowPeriod: number;
        slAtrMult: number;
        rrTarget: number;
        riskPct: number;
        trades: number;
        sharpeRatio: number;
        totalReturnPct: number;
        maxDrawdownPct: number;
    }>;
    equityCurve: Array<{
        idx: number;
        phase: 'IN_SAMPLE' | 'OUT_OF_SAMPLE';
        equity: number;
        drawdownPct: number;
    }>;
    dataSourceUsed?: string;
    isRealMarketData?: boolean;
    sessionFilter?: SessionFilterOption;
    realisticVerification?: RealisticVerificationSummary | null;
    realisticTearsheet?: TearSheetData | null;
    realisticOrdersCount?: number;
}

const WalkForwardEquitySvg = ({
    points,
    initialCapital,
    isEn,
}: {
    points: OptunaOptimizeResponse['equityCurve'];
    initialCapital: number;
    isEn: boolean;
}) => {
    if (!points || points.length < 2) return null;
    const width = 760;
    const height = 210;
    const padX = 12;
    const padY = 16;

    const equities = points.map((p) => p.equity);
    const minEq = Math.min(initialCapital, ...equities);
    const maxEq = Math.max(initialCapital, ...equities);
    const span = Math.max(1, maxEq - minEq);

    const toX = (i: number) => padX + (i / Math.max(1, points.length - 1)) * (width - padX * 2);
    const toY = (v: number) => height - padY - ((v - minEq) / span) * (height - padY * 2);

    const oosStartIdx = points.findIndex((p) => p.phase === 'OUT_OF_SAMPLE');
    const splitIndex = oosStartIdx > 0 ? oosStartIdx : Math.floor(points.length * 0.7);

    const isPoints = points
        .slice(0, splitIndex + 1)
        .map((p, i) => `${toX(i).toFixed(1)},${toY(p.equity).toFixed(1)}`)
        .join(' ');
    const oosPoints = points
        .slice(splitIndex)
        .map((p, offset) => `${toX(splitIndex + offset).toFixed(1)},${toY(p.equity).toFixed(1)}`)
        .join(' ');
    const baselineY = toY(initialCapital);
    const splitX = toX(splitIndex);

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-fg-muted">
                <div className="flex items-center gap-4">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                        {isEn ? 'In-Sample (70%)' : 'Treino In-Sample (70%)'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        {isEn ? 'Out-of-Sample Validation (30%)' : 'Validação Out-of-Sample (30%)'}
                    </span>
                </div>
                <span className="tabular-nums font-mono">
                    {fmtMoney(points[points.length - 1].equity)} (Min {fmtMoney(minEq)} · Max {fmtMoney(maxEq)})
                </span>
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full rounded-lg border border-line bg-surface-2/40">
                <line
                    x1={padX}
                    y1={baselineY}
                    x2={width - padX}
                    y2={baselineY}
                    stroke="currentColor"
                    strokeOpacity="0.2"
                    strokeDasharray="4 4"
                />
                <line
                    x1={splitX}
                    y1={padY}
                    x2={splitX}
                    y2={height - padY}
                    stroke="#f59e0b"
                    strokeOpacity="0.7"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                />
                {isPoints && (
                    <polyline
                        fill="none"
                        stroke="#0ea5e9"
                        strokeWidth="2.4"
                        strokeLinejoin="round"
                        points={isPoints}
                    />
                )}
                {oosPoints && (
                    <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.6"
                        strokeLinejoin="round"
                        points={oosPoints}
                    />
                )}
            </svg>
        </div>
    );
};

const QuantOptimizerView = ({ isEn }: { isEn: boolean }) => {
    const navigate = useNavigate();
    const { selectedAccountId } = useAccount();
    const strategies = useBacktestWorkspaceStore((s) => s.strategies);
    const createStrategy = useBacktestWorkspaceStore((s) => s.createStrategy);
    const createSession = useBacktestWorkspaceStore((s) => s.createSession);
    const updateSession = useBacktestWorkspaceStore((s) => s.updateSession);

    const [symbol, setSymbol] = useState('XAUUSD');
    const [timeframe, setTimeframe] = useState('15m');
    const [strategyFamily, setStrategyFamily] = useState<StrategyFamilyOption>('SMC_DONCHIAN_ATR');
    const [barsCount, setBarsCount] = useState(5000);
    const [nTrials, setNTrials] = useState(25);
    const [objectiveMetric, setObjectiveMetric] = useState<ObjectiveMetricOption>('composite');
    const [initialCapital, setInitialCapital] = useState(100000);

    const [dataMode, setDataMode] = useState<DataModeOption>('AUTO');
    const [sessionFilter, setSessionFilter] = useState<SessionFilterOption>('LONDON_NY');
    const [avoidFridayLate, setAvoidFridayLate] = useState(true);
    const [slippageBps, setSlippageBps] = useState(1.5);

    const [catalog, setCatalog] = useState<ParquetCatalogResponse | null>(null);
    const [syncLoading, setSyncLoading] = useState(false);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);

    const [sweepLoading, setSweepLoading] = useState(false);
    const [optunaLoading, setOptunaLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sweepResult, setSweepResult] = useState<VectorSweepResponse | null>(null);
    const [optunaResult, setOptunaResult] = useState<OptunaOptimizeResponse | null>(null);
    const [savingSetup, setSavingSetup] = useState(false);
    const [savedSetup, setSavedSetup] = useState(false);
    const [playbookAppliedId, setPlaybookAppliedId] = useState<string | null>(null);
    const [launchingReplay, setLaunchingReplay] = useState(false);

    const loadCatalog = async () => {
        try {
            const res = await fetch('/api/quant/market-data/catalog', {
                headers: getQuantAuthHeaders(),
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok) {
                const json: ParquetCatalogResponse = await res.json();
                setCatalog(json);
            }
        } catch {
            // optional background status refresh
        }
    };

    useEffect(() => {
        void loadCatalog();
    }, []);

    const syncParquetReal = async () => {
        setSyncLoading(true);
        setSyncMessage(null);
        setError(null);
        try {
            const res = await fetch('/api/quant/market-data/sync', {
                method: 'POST',
                headers: getQuantAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    symbol,
                    timeframe,
                    barsCount,
                    sourcePreference: 'AUTO',
                    forceRefresh: true,
                }),
                signal: AbortSignal.timeout(60000),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            if (data?.isRealMarket) {
                setDataMode('REAL');
            }
            setSyncMessage(
                isEn
                    ? `${data.barsCount.toLocaleString('en-US')} bars cached (${data.source})`
                    : `${data.barsCount.toLocaleString('pt-BR')} velas em Parquet (${data.source})`
            );
            await loadCatalog();
        } catch (err) {
            setError(
                isEn
                    ? `Failed to sync real Parquet feed: ${(err as Error).message}`
                    : `Falha ao sincronizar feed Parquet real: ${(err as Error).message}`
            );
        } finally {
            setSyncLoading(false);
        }
    };

    const runVectorSweep = async () => {
        setSweepLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/quant/vector-sweep', {
                method: 'POST',
                headers: getQuantAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    symbol,
                    timeframe,
                    barsCount,
                    strategyFamily,
                    initialCapital,
                    dataMode,
                    sessionFilter,
                    avoidFridayLate,
                    slippageBps,
                    locale: isEn ? 'en' : 'pt',
                }),
                signal: AbortSignal.timeout(90000),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data: VectorSweepResponse = await res.json();
            setSweepResult(data);
        } catch (err) {
            setError(
                isEn
                    ? `Failed to run VectorBT sweep: ${(err as Error).message}`
                    : `Falha ao executar varredura VectorBT: ${(err as Error).message}`
            );
        } finally {
            setSweepLoading(false);
        }
    };

    const runOptunaOptimize = async () => {
        setOptunaLoading(true);
        setSavedSetup(false);
        setPlaybookAppliedId(null);
        setError(null);
        try {
            const res = await fetch('/api/quant/optimize', {
                method: 'POST',
                headers: getQuantAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    symbol,
                    timeframe,
                    barsCount,
                    strategyFamily,
                    nTrials,
                    objectiveMetric,
                    initialCapital,
                    dataMode,
                    sessionFilter,
                    avoidFridayLate,
                    slippageBps,
                    verifyRealistic: true,
                    locale: isEn ? 'en' : 'pt',
                }),
                signal: AbortSignal.timeout(120000),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data: OptunaOptimizeResponse = await res.json();
            setOptunaResult(data);
        } catch (err) {
            setError(
                isEn
                    ? `Failed to run Optuna Walk-Forward optimization: ${(err as Error).message}`
                    : `Falha na otimização Optuna Walk-Forward: ${(err as Error).message}`
            );
        } finally {
            setOptunaLoading(false);
        }
    };

    const ensureQuantPlaybookStrategy = (params: {
        sym: string;
        tf: string;
        family: StrategyFamilyOption;
        fastPeriod: number;
        slowPeriod: number;
        slAtrMult: number;
        rrTarget: number;
        riskPct: number;
        rsiThreshold: number;
        verdict?: string;
    }) => {
        const stratName = `Quant · ${params.sym} ${params.tf} (${params.family})`;
        const existing = strategies.find((s) => s.id === playbookAppliedId || s.name === stratName);
        if (existing) {
            setPlaybookAppliedId(existing.id);
            return existing;
        }
        const sessionLabel =
            sessionFilter === 'LONDON_NY'
                ? 'London / New York'
                : sessionFilter === 'LONDON_ONLY'
                ? 'London'
                : sessionFilter === 'NY_ONLY'
                ? 'New York'
                : 'Multi-Session';

        const created = createStrategy({
            name: stratName,
            tradingMethod: params.family,
            description:
                params.verdict ||
                `Otimizado com Optuna + VectorBT (${params.sym} ${params.tf}) · Killzone ${sessionFilter}`,
            sessionTag: sessionLabel,
            status: 'ACTIVE',
            startingCapital: initialCapital,
            currency: 'USD',
            riskMode: 'FIXED_RISK',
            riskPerTrade: params.riskPct,
            defaultTimeframe: params.tf,
            rrTarget: params.rrTarget,
            primarySymbol: params.sym,
            symbols: [params.sym],
            rules: [
                {
                    id: 'q1',
                    text: `${params.family} · Fast ${params.fastPeriod} / Slow ${params.slowPeriod} (RSI ${params.rsiThreshold})`,
                    required: true,
                },
                {
                    id: 'q2',
                    text: `Stop Loss ${params.slAtrMult}x ATR · Take Profit 1:${params.rrTarget} R:R`,
                    required: true,
                },
                {
                    id: 'q3',
                    text: `Risco por Operação ${params.riskPct}% · Slippage ${slippageBps} bps`,
                    required: true,
                },
                {
                    id: 'q4',
                    text: `Sessão UTC: ${sessionFilter}${avoidFridayLate ? ' (Sem entradas Sexta >= 19h UTC)' : ''}`,
                    required: true,
                },
            ],
        });
        setPlaybookAppliedId(created.id);
        return created;
    };

    const handleApplyToPlaybook = () => {
        if (!optunaResult) return;
        const bp = optunaResult.bestParams;
        ensureQuantPlaybookStrategy({
            sym: optunaResult.symbol,
            tf: optunaResult.timeframe,
            family: optunaResult.strategyFamily,
            fastPeriod: bp.fastPeriod,
            slowPeriod: bp.slowPeriod,
            slAtrMult: bp.slAtrMult,
            rrTarget: bp.rrTarget,
            riskPct: bp.riskPct,
            rsiThreshold: bp.rsiThreshold,
            verdict: optunaResult.robustnessVerdict,
        });
    };

    const launchConfigInReplay = (params: {
        sym: string;
        tf: string;
        family: StrategyFamilyOption;
        fastPeriod: number;
        slowPeriod: number;
        slAtrMult: number;
        rrTarget: number;
        riskPct: number;
        rsiThreshold: number;
        isRealData?: boolean;
        verdict?: string;
    }) => {
        setLaunchingReplay(true);
        try {
            const strat = ensureQuantPlaybookStrategy(params);
            const todayIso = new Date().toISOString().slice(0, 10);
            const fromIso = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
            const sess = createSession({
                name: `Quant Replay · ${params.sym} ${params.tf} (F${params.fastPeriod}/S${params.slowPeriod})`,
                strategyId: strat.id,
                pairs: [params.sym],
                primarySymbol: params.sym,
                timeframe: params.tf,
                fromDate: fromIso,
                toDate: todayIso,
                keepEndFollowingToday: true,
                randomStartDate: false,
                riskPerTrade: params.riskPct,
                fundedMode: {
                    enabled: false,
                    profitTargetPct: 10,
                    maxDailyLossPct: 5,
                    maxTotalLossPct: 10,
                },
            });

            const symUpper = params.sym.toUpperCase();
            const defaultSpread = symUpper.includes('XAU')
                ? 0.25
                : symUpper.includes('BTC')
                ? 12.0
                : 0.00015;
            const indicators =
                params.family === 'BOLLINGER_MEAN_REV'
                    ? ['BOLL', 'RSI', 'VOL']
                    : ['EMA', 'RSI', 'VOL'];

            updateSession(sess.id, {
                rrTarget: params.rrTarget,
                startingCapital: initialCapital,
                currentBalance: initialCapital,
                dataSource: params.isRealData || dataMode === 'REAL' ? 'TRADINGVIEW' : 'DEMO',
                activeIndicators: indicators,
                indicatorParamsByCode: {
                    EMA: `${params.fastPeriod},${params.slowPeriod}`,
                    RSI: '14',
                },
                ticketDefaults: {
                    orderSide: 'BUY',
                    orderType: 'MARKET',
                    riskPercent: params.riskPct,
                    slDistancePct: Number(Math.max(0.15, Math.min(2.5, params.slAtrMult * 0.35)).toFixed(2)),
                    rrTarget: params.rrTarget,
                    spread: defaultSpread,
                    commission: 7,
                },
            });
            navigate(`/backtesting/replay/${sess.id}`);
        } finally {
            setLaunchingReplay(false);
        }
    };

    const saveOptunaSetup = async () => {
        if (!optunaResult) return;
        setSavingSetup(true);
        try {
            const oos = optunaResult.outOfSampleMetrics;
            const bp = optunaResult.bestParams;
            await saveBacktestHypothesisOfflineAware(
                {
                    accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined,
                    name: `Optuna WF · ${optunaResult.symbol} ${optunaResult.timeframe} (${optunaResult.strategyFamily})`,
                    mode: 'STRATEGY_SIM',
                    config: {
                        symbol: optunaResult.symbol,
                        timeframe: optunaResult.timeframe,
                        strategyFamily: optunaResult.strategyFamily,
                        bestParams: bp,
                        nTrials: optunaResult.nTrialsCompleted,
                        objectiveMetric: optunaResult.objectiveMetric,
                        dataMode,
                        sessionFilter,
                        slippageBps,
                    },
                    results: {
                        simulatedTrades: oos.totalTrades,
                        simulatedWinRate: oos.winRatePct,
                        simulatedNetProfit: oos.netProfitUsd,
                        simulatedProfitFactor: oos.profitFactor,
                        simulatedMaxDrawdownPercent: oos.maxDrawdownPct,
                        inSampleMetrics: optunaResult.inSampleMetrics,
                        outOfSampleMetrics: oos,
                        realisticVerification: optunaResult.realisticVerification,
                        robustnessVerdict: optunaResult.robustnessVerdict,
                        bestParams: bp,
                    },
                    notes: `${optunaResult.robustnessVerdict} | Fast ${bp.fastPeriod} · Slow ${bp.slowPeriod} · SL ${bp.slAtrMult}x ATR · RR 1:${bp.rrTarget} · Risk ${bp.riskPct}% · ${sessionFilter}`,
                },
                selectedAccountId !== 'all' ? selectedAccountId : undefined
            );
            setSavedSetup(true);
        } catch {
            // handled gracefully
        } finally {
            setSavingSetup(false);
        }
    };

    const heatmapGrid = useMemo(() => {
        if (!sweepResult?.heatmapCells?.length) return null;
        const xCols = Array.from(new Set(sweepResult.heatmapCells.map((c) => c.xLabel)));
        const yRows = Array.from(new Set(sweepResult.heatmapCells.map((c) => c.yLabel)));
        const cellMap = new Map(sweepResult.heatmapCells.map((c) => [`${c.yLabel}__${c.xLabel}`, c]));
        return { xCols, yRows, cellMap };
    }, [sweepResult]);

    const sortedImportances = useMemo(() => {
        if (!optunaResult?.paramImportances) return [];
        return Object.entries(optunaResult.paramImportances).sort((a, b) => b[1] - a[1]);
    }, [optunaResult]);

    const toneCls = (tone: OptunaOptimizeResponse['robustnessTone']) =>
        tone === 'accent'
            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : tone === 'warn'
            ? 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200'
            : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300';

    const heatColor = (sharpe: number) => {
        if (sharpe >= 1.8) return 'bg-emerald-500/30 border-emerald-500/50 text-emerald-700 dark:text-emerald-200';
        if (sharpe >= 1.0) return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300';
        if (sharpe >= 0.3) return 'bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-200';
        return 'bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-300';
    };

    const matchedDataset = useMemo(
        () => catalog?.datasets?.find((d) => d.symbol === symbol.toUpperCase() && d.timeframe === timeframe),
        [catalog, symbol, timeframe]
    );

    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <Panel
                title={isEn ? 'Quant Engine Setup' : 'Motor Quant (Parquet Real + Optuna)'}
                subtitle={
                    isEn
                        ? 'Real market Parquet lake, Killzone filter & realistic audit.'
                        : 'Data Lake Parquet real, filtro Killzone e auditoria barra-a-barra.'
                }
            >
                <div className="space-y-4">
                    <div className="rounded-lg border border-accent/25 bg-accent/10 p-3 text-xs text-fg-muted">
                        <div className="flex items-center justify-between gap-2 font-semibold text-accent-fg">
                            <span className="inline-flex items-center gap-1.5">
                                <Cpu size={14} />
                                <span>Polars + VectorBT + QuantStats</span>
                            </span>
                            {catalog && (
                                <Badge tone={catalog.realDatasetsCount > 0 ? 'accent' : 'neutral'}>
                                    {catalog.realDatasetsCount} {isEn ? 'real files' : 'Parquets reais'}
                                </Badge>
                            )}
                        </div>
                        <p className="mt-1 leading-relaxed">
                            {matchedDataset
                                ? isEn
                                    ? `Cached: ${matchedDataset.barsCount.toLocaleString('en-US')} real bars (${matchedDataset.source}).`
                                    : `Em cache: ${matchedDataset.barsCount.toLocaleString('pt-BR')} velas reais (${matchedDataset.source}).`
                                : isEn
                                ? 'Sync real historical OHLCV from MT5/Binance/Yahoo into Zstd Parquet or test synthetic mode.'
                                : 'Sincronize OHLCV real (MT5/Binance/Yahoo) para Zstd Parquet ou valide sob slippage e sessões UTC.'}
                        </p>
                        <div className="mt-2.5 flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                fullWidth
                                isLoading={syncLoading}
                                icon={<CloudDownload size={13} />}
                                onClick={() => void syncParquetReal()}
                            >
                                {isEn ? 'Sync Real Parquet' : 'Sincronizar Parquet Real'}
                            </Button>
                        </div>
                        {syncMessage && (
                            <p className="mt-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300">
                                {syncMessage}
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Symbol' : 'Ativo'}>
                            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={inputCls}>
                                <option value="XAUUSD">XAUUSD</option>
                                <option value="BTCUSD">BTCUSD</option>
                                <option value="EURUSD">EURUSD</option>
                                <option value="GBPUSD">GBPUSD</option>
                                <option value="NAS100">NAS100</option>
                            </select>
                        </Field>
                        <Field label="Timeframe">
                            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className={inputCls}>
                                <option value="5m">5m</option>
                                <option value="15m">15m</option>
                                <option value="1h">1h</option>
                                <option value="4h">4h</option>
                            </select>
                        </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Data Feed' : 'Fonte de Dados'}>
                            <select value={dataMode} onChange={(e) => setDataMode(e.target.value as DataModeOption)} className={inputCls}>
                                <option value="AUTO">{isEn ? 'Auto (Real -> Syn)' : 'Auto (Real c/ Fallback)'}</option>
                                <option value="REAL">{isEn ? 'Real Market Only' : 'Parquet Real'}</option>
                                <option value="SYNTHETIC">{isEn ? 'Synthetic Lab' : 'Sintético Determinístico'}</option>
                            </select>
                        </Field>
                        <Field label={isEn ? 'Killzone / Session' : 'Sessão UTC'}>
                            <select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value as SessionFilterOption)} className={inputCls}>
                                <option value="LONDON_NY">London + NY (07h–17h)</option>
                                <option value="LONDON_ONLY">London (07h–12h)</option>
                                <option value="NY_ONLY">New York (12h–17h)</option>
                                <option value="NO_ASIA">Sem Ásia (07h–21h)</option>
                                <option value="ALL">24h (Sem Filtro)</option>
                            </select>
                        </Field>
                    </div>

                    <Field label={isEn ? 'Strategy Family' : 'Família de Estratégia'}>
                        <select
                            value={strategyFamily}
                            onChange={(e) => setStrategyFamily(e.target.value as StrategyFamilyOption)}
                            className={inputCls}
                        >
                            <option value="SMC_DONCHIAN_ATR">
                                {isEn ? 'SMC Donchian Breakout + ATR' : 'SMC Donchian Breakout + ATR Stop'}
                            </option>
                            <option value="EMA_CROSS_RSI">
                                {isEn ? 'EMA Cross + RSI Filter' : 'Cruzamento EMA + Filtro RSI'}
                            </option>
                            <option value="BOLLINGER_MEAN_REV">
                                {isEn ? 'Bollinger Mean Reversion' : 'Reversão Bollinger + ATR'}
                            </option>
                        </select>
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Polars Bars' : 'Velas (Polars)'}>
                            <select
                                value={barsCount}
                                onChange={(e) => setBarsCount(Number(e.target.value))}
                                className={inputCls}
                            >
                                <option value={3000}>3,000</option>
                                <option value={5000}>5,000</option>
                                <option value={8000}>8,000</option>
                            </select>
                        </Field>
                        <Field label={isEn ? 'Slippage (bps)' : 'Slippage (bps)'}>
                            <input
                                type="number"
                                min={0}
                                max={25}
                                step={0.5}
                                value={slippageBps}
                                onChange={(e) => setSlippageBps(Math.max(0, Number(e.target.value) || 0))}
                                className={inputCls}
                            />
                        </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label={isEn ? 'Capital ($)' : 'Capital ($)'}>
                            <input
                                type="number"
                                min={1000}
                                step={5000}
                                value={initialCapital}
                                onChange={(e) => setInitialCapital(Math.max(1000, Number(e.target.value) || 100000))}
                                className={inputCls}
                            />
                        </Field>
                        <Field label={isEn ? 'Optuna Trials' : 'Trials Optuna'}>
                            <select
                                value={nTrials}
                                onChange={(e) => setNTrials(Number(e.target.value))}
                                className={inputCls}
                            >
                                <option value={25}>25 trials</option>
                                <option value={35}>35 trials</option>
                                <option value={50}>50 trials</option>
                            </select>
                        </Field>
                    </div>

                    <Field label={isEn ? 'Objective' : 'Objetivo'}>
                        <select
                            value={objectiveMetric}
                            onChange={(e) => setObjectiveMetric(e.target.value as ObjectiveMetricOption)}
                            className={inputCls}
                        >
                            <option value="composite">{isEn ? 'Composite Edge' : 'Score Composto'}</option>
                            <option value="sharpe">Sharpe Ratio</option>
                            <option value="calmar">Calmar Ratio</option>
                            <option value="profit_factor">Profit Factor</option>
                        </select>
                    </Field>

                    <Toggle
                        checked={avoidFridayLate}
                        onChange={setAvoidFridayLate}
                        label={isEn ? 'Block Friday Late Entries (>= 19h UTC)' : 'Bloquear Entradas Sexta >= 19h UTC'}
                    />

                    <div className="space-y-2.5 pt-1">
                        <Button
                            type="button"
                            variant="outline"
                            fullWidth
                            isLoading={sweepLoading}
                            icon={<Sliders size={14} />}
                            onClick={() => void runVectorSweep()}
                        >
                            {isEn ? 'Run VectorBT Sweep' : 'Executar Varredura VectorBT'}
                        </Button>
                        <Button
                            type="button"
                            variant="brand"
                            fullWidth
                            isLoading={optunaLoading}
                            icon={<Sparkles size={14} />}
                            onClick={() => void runOptunaOptimize()}
                        >
                            {isEn
                                ? 'Auto-Optimize with Optuna (Walk-Forward)'
                                : 'Auto-Otimizar com Optuna (Walk-Forward)'}
                        </Button>
                    </div>

                    {error && (
                        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger-fg">
                            {error}
                        </div>
                    )}
                </div>
            </Panel>

            <div className="min-w-0 space-y-4">
                {!sweepResult && !optunaResult && (
                    <Panel
                        title={isEn ? 'Vectorized Backtesting & Walk-Forward Lab' : 'Laboratório Quantitativo (Parquet + VectorBT + Optuna)'}
                        subtitle={
                            isEn
                                ? 'Sync real data or run a sweep/Optuna optimization on the left to inspect Heatmaps, Realistic Bar-by-Bar Audit, and QuantStats Tear-Sheet.'
                                : 'Sincronize o histórico real Parquet ou execute o motor Quant à esquerda para auditar IS, OOS VectorBT, Simulação Realista e Tear-Sheet QuantStats.'
                        }
                    >
                        <EmptyState
                            icon={<TrendingUp size={20} />}
                            title={isEn ? 'Ready for Phase 2 Quant Validation' : 'Pronto para Auditoria Quantitativa Fase 2'}
                            description={
                                isEn
                                    ? 'Zero look-ahead bias: Optuna optimizes parameters on 70% In-Sample, validates on 30% VectorBT OOS, and stress-tests bar-by-bar with real slippage & Killzones.'
                                    : 'Sem viés de futuro: o Optuna otimiza nos primeiros 70%, valida nos últimos 30% em VectorBT e reaudita barra-a-barra com spread, slippage e filtro de sessão.'
                            }
                        />
                    </Panel>
                )}

                {sweepResult && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                            <KpiCard
                                label={isEn ? 'Combinations' : 'Combinações'}
                                value={sweepResult.totalCombinations.toLocaleString('pt-BR')}
                                hint={`${sweepResult.barsProcessed.toLocaleString('pt-BR')} velas · ${sweepResult.isRealMarketData ? 'Real' : 'Sintético'}`}
                            />
                            <KpiCard
                                label={isEn ? 'Throughput' : 'Velocidade'}
                                value={`${Math.round(sweepResult.combinationsPerSec).toLocaleString('pt-BR')}/s`}
                                tone="text-accent-fg"
                                hint={`${sweepResult.elapsedMs.toFixed(0)} ms · ${sweepResult.sessionFilter || sessionFilter}`}
                            />
                            <KpiCard
                                label={isEn ? 'Top Sharpe' : 'Melhor Sharpe'}
                                value={fmtNum(sweepResult.topConfigs[0]?.sharpeRatio ?? 0, 2)}
                                tone={pnlTone(sweepResult.topConfigs[0]?.sharpeRatio ?? 0)}
                                hint={`WR ${fmtNum(sweepResult.topConfigs[0]?.winRatePct ?? 0, 1)}% · Filtrados: ${sweepResult.signalsFilteredBySession ?? 0}`}
                            />
                            <KpiCard
                                label={isEn ? 'Best Net Profit' : 'Melhor Retorno ($)'}
                                value={fmtMoney(sweepResult.topConfigs[0]?.netProfitUsd ?? 0, { sign: true })}
                                tone={pnlTone(sweepResult.topConfigs[0]?.netProfitUsd ?? 0)}
                                hint={`Fast ${sweepResult.topConfigs[0]?.fastPeriod} / Slow ${sweepResult.topConfigs[0]?.slowPeriod} · DD ${fmtNum(sweepResult.topConfigs[0]?.maxDrawdownPct ?? 0, 1)}%`}
                            />
                        </div>

                        {heatmapGrid && (
                            <Panel
                                title={isEn ? 'VectorBT Heatmap (Fast × Slow)' : 'Mapa de Calor VectorBT (Fast × Slow)'}
                                subtitle={sweepResult.summaryText}
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full border-separate border-spacing-1.5 text-center text-xs">
                                        <thead>
                                            <tr>
                                                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase text-fg-subtle">
                                                    Fast \ Slow
                                                </th>
                                                {heatmapGrid.xCols.map((x) => (
                                                    <th key={x} className="px-2 py-1 font-mono text-[11px] font-semibold text-fg-muted">
                                                        {x}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {heatmapGrid.yRows.map((y) => (
                                                <tr key={y}>
                                                    <th className="px-2 py-1 text-left font-mono text-[11px] font-semibold text-fg-muted">
                                                        {y}
                                                    </th>
                                                    {heatmapGrid.xCols.map((x) => {
                                                        const cell = heatmapGrid.cellMap.get(`${y}__${x}`);
                                                        if (!cell) {
                                                            return (
                                                                <td
                                                                    key={x}
                                                                    className="rounded-md border border-line/50 bg-surface-2/30 px-2 py-2 text-[11px] text-fg-subtle"
                                                                >
                                                                    —
                                                                </td>
                                                            );
                                                        }
                                                        return (
                                                            <td
                                                                key={x}
                                                                title={`Fast ${y} / Slow ${x} · Sharpe ${cell.sharpeRatio} · Ret ${cell.totalReturnPct}% · WR ${cell.winRatePct}% (${cell.trades} trades)`}
                                                                className={cn(
                                                                    'rounded-md border px-2 py-2 font-mono tabular-nums',
                                                                    heatColor(cell.sharpeRatio)
                                                                )}
                                                            >
                                                                <div className="text-xs font-bold">{cell.sharpeRatio.toFixed(2)}</div>
                                                                <div className="text-[10px] opacity-85">
                                                                    {cell.totalReturnPct >= 0 ? '+' : ''}
                                                                    {cell.totalReturnPct.toFixed(1)}%
                                                                </div>
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Panel>
                        )}

                        <Panel
                            title={isEn ? 'Top 12 Configurations' : 'Top 12 Configurações Ranqueadas'}
                            subtitle={isEn ? 'Ranked by composite Sharpe, Profit Factor, Return, and Drawdown control.' : 'Ordenado por Sharpe, Profit Factor, Retorno e controle de Drawdown.'}
                            bodyClassName="p-0"
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[820px] text-xs">
                                    <thead>
                                        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                            <th className="px-3 py-2">#</th>
                                            <th className="px-3 py-2">Fast / Slow</th>
                                            <th className="px-3 py-2 text-right">SL ATR</th>
                                            <th className="px-3 py-2 text-right">R:R</th>
                                            <th className="px-3 py-2 text-right">Trades</th>
                                            <th className="px-3 py-2 text-right">Win Rate</th>
                                            <th className="px-3 py-2 text-right">PF</th>
                                            <th className="px-3 py-2 text-right">Sharpe</th>
                                            <th className="px-3 py-2 text-right">Max DD</th>
                                            <th className="px-3 py-2 text-right">{isEn ? 'Net Profit' : 'Retorno $'}</th>
                                            <th className="px-4 py-2 text-right">{isEn ? 'Action' : 'Replay'}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line tabular-nums">
                                        {sweepResult.topConfigs.map((row) => (
                                            <tr key={row.rank} className="hover:bg-surface-2/40">
                                                <td className="px-3 py-2 font-mono font-bold text-fg-subtle">{row.rank}</td>
                                                <td className="px-3 py-2 font-mono font-semibold text-fg">
                                                    {row.fastPeriod} / {row.slowPeriod}
                                                </td>
                                                <td className="px-3 py-2 text-right">{row.slAtrMult.toFixed(1)}x</td>
                                                <td className="px-3 py-2 text-right">1:{row.rrTarget.toFixed(1)}</td>
                                                <td className="px-3 py-2 text-right">{row.totalTrades}</td>
                                                <td className="px-3 py-2 text-right">{row.winRatePct.toFixed(1)}%</td>
                                                <td className="px-3 py-2 text-right">{row.profitFactor.toFixed(2)}</td>
                                                <td className={cn('px-3 py-2 text-right font-semibold', pnlTone(row.sharpeRatio))}>
                                                    {row.sharpeRatio.toFixed(2)}
                                                </td>
                                                <td className="px-3 py-2 text-right text-fg-muted">{row.maxDrawdownPct.toFixed(1)}%</td>
                                                <td className={cn('px-3 py-2 text-right font-semibold', pnlTone(row.netProfitUsd))}>
                                                    {fmtMoney(row.netProfitUsd, { sign: true })}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            launchConfigInReplay({
                                                                sym: sweepResult.symbol,
                                                                tf: sweepResult.timeframe,
                                                                family: sweepResult.strategyFamily,
                                                                fastPeriod: row.fastPeriod,
                                                                slowPeriod: row.slowPeriod,
                                                                slAtrMult: row.slAtrMult,
                                                                rrTarget: row.rrTarget,
                                                                riskPct: 1.0,
                                                                rsiThreshold: 52,
                                                                isRealData: sweepResult.isRealMarketData,
                                                                verdict: sweepResult.summaryText,
                                                            })
                                                        }
                                                        className="inline-flex items-center gap-1 rounded border border-line bg-surface-2 px-2 py-1 text-[11px] font-semibold text-fg hover:border-accent hover:text-accent-fg"
                                                    >
                                                        <Play size={11} />
                                                        {isEn ? 'Replay' : 'Abrir no Replay'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                    </div>
                )}

                {optunaResult && (
                    <div className="space-y-4">
                        <div className={cn('rounded-xl border p-4', toneCls(optunaResult.robustnessTone))}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge tone={optunaResult.robustnessTone === 'danger' ? 'danger' : optunaResult.robustnessTone === 'warn' ? 'warn' : 'accent'}>
                                            Optuna TPE · {optunaResult.nTrialsCompleted} trials ({optunaResult.elapsedMs.toFixed(0)} ms)
                                        </Badge>
                                        <Badge tone={optunaResult.isRealMarketData ? 'accent' : 'neutral'}>
                                            {optunaResult.isRealMarketData
                                                ? `Parquet Real · ${optunaResult.dataSourceUsed}`
                                                : `Sintético · ${optunaResult.dataSourceUsed || 'synthetic-parquet'}`}
                                        </Badge>
                                        <span className="text-xs font-mono opacity-85">
                                            {optunaResult.symbol} · {optunaResult.timeframe} · {optunaResult.sessionFilter || sessionFilter}
                                        </span>
                                    </div>
                                    <p className="text-sm font-semibold">{optunaResult.robustnessVerdict}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        icon={<Save size={13} />}
                                        isLoading={savingSetup}
                                        disabled={savedSetup}
                                        onClick={() => void saveOptunaSetup()}
                                    >
                                        {savedSetup
                                            ? isEn
                                                ? 'Saved!'
                                                : 'Guardado!'
                                            : isEn
                                            ? 'Save Setup'
                                            : 'Guardar Setup'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        icon={<CheckCircle2 size={13} />}
                                        onClick={handleApplyToPlaybook}
                                    >
                                        {playbookAppliedId
                                            ? isEn
                                                ? 'Applied to Playbook'
                                                : 'Aplicado ao Playbook'
                                            : isEn
                                            ? 'Apply to Playbook'
                                            : 'Aplicar ao Playbook'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="brand"
                                        size="sm"
                                        isLoading={launchingReplay}
                                        icon={<Play size={13} />}
                                        onClick={() =>
                                            launchConfigInReplay({
                                                sym: optunaResult.symbol,
                                                tf: optunaResult.timeframe,
                                                family: optunaResult.strategyFamily,
                                                fastPeriod: optunaResult.bestParams.fastPeriod,
                                                slowPeriod: optunaResult.bestParams.slowPeriod,
                                                slAtrMult: optunaResult.bestParams.slAtrMult,
                                                rrTarget: optunaResult.bestParams.rrTarget,
                                                riskPct: optunaResult.bestParams.riskPct,
                                                rsiThreshold: optunaResult.bestParams.rsiThreshold,
                                                isRealData: optunaResult.isRealMarketData,
                                                verdict: optunaResult.robustnessVerdict,
                                            })
                                        }
                                    >
                                        {isEn ? 'Test Now in Replay' : 'Testar Agora no Replay'}
                                    </Button>
                                </div>
                            </div>
                            {playbookAppliedId && (
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                                    <span>
                                        {isEn
                                            ? 'Playbook strategy created with rules, Killzone filter & Optuna ATR/RR risk parameters.'
                                            : 'Estratégia adicionada ao Playbook com regras completas, filtro Killzone e risco Optuna.'}
                                    </span>
                                    <Link to="/backtesting/strategies" className="inline-flex items-center gap-1 font-semibold underline">
                                        {isEn ? 'Open Playbook' : 'Ver no Playbook'}
                                        <ArrowRight size={12} />
                                    </Link>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                            <KpiCard label="Fast Period" value={optunaResult.bestParams.fastPeriod} />
                            <KpiCard label="Slow Period" value={optunaResult.bestParams.slowPeriod} />
                            <KpiCard label="ATR Stop" value={`${optunaResult.bestParams.slAtrMult}x`} />
                            <KpiCard label="Alvo R:R" value={`1:${optunaResult.bestParams.rrTarget}`} />
                            <KpiCard label={isEn ? 'Risk / Trade' : 'Risco %'} value={`${optunaResult.bestParams.riskPct}%`} />
                            <KpiCard label="RSI Filtro" value={optunaResult.bestParams.rsiThreshold} />
                        </div>

                        <Panel
                            title={isEn ? 'Walk-Forward Equity Curve (In-Sample vs Out-of-Sample)' : 'Curva de Capital Walk-Forward (Treino vs Validação)'}
                            subtitle={`${optunaResult.trainBars.toLocaleString('pt-BR')} velas In-Sample · ${optunaResult.testBars.toLocaleString('pt-BR')} velas Out-of-Sample`}
                        >
                            <WalkForwardEquitySvg
                                points={optunaResult.equityCurve}
                                initialCapital={initialCapital}
                                isEn={isEn}
                            />
                        </Panel>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                            <Panel
                                title={isEn ? 'Triple Verification: In-Sample vs OOS VectorBT vs Realistic Bar-by-Bar' : 'Tripla Auditoria: In-Sample vs OOS VectorBT vs Realista Barra-a-Barra'}
                                subtitle={
                                    optunaResult.realisticVerification
                                        ? optunaResult.realisticVerification.verdict
                                        : isEn
                                        ? 'Zero look-ahead validation.'
                                        : 'Validação rigorosa sem viés.'
                                }
                                bodyClassName="p-0"
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[540px] text-sm">
                                        <thead>
                                            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                                <th className="px-4 py-2 font-semibold">{isEn ? 'Metric' : 'Métrica'}</th>
                                                <th className="px-3 py-2 text-right font-semibold">In-Sample (70%)</th>
                                                <th className="px-3 py-2 text-right font-semibold">OOS VectorBT (30%)</th>
                                                <th className="px-4 py-2 text-right font-semibold text-accent-fg">
                                                    {isEn ? 'Realistic OOS' : 'Realista Barra-a-Barra'}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line tabular-nums">
                                            <tr>
                                                <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">
                                                    {isEn ? 'Return (%)' : 'Retorno (%)'}
                                                </th>
                                                <td className="px-3 py-2 text-right font-semibold">{optunaResult.inSampleMetrics.totalReturnPct.toFixed(2)}%</td>
                                                <td className={cn('px-3 py-2 text-right font-bold', pnlTone(optunaResult.outOfSampleMetrics.totalReturnPct))}>
                                                    {optunaResult.outOfSampleMetrics.totalReturnPct >= 0 ? '+' : ''}
                                                    {optunaResult.outOfSampleMetrics.totalReturnPct.toFixed(2)}%
                                                </td>
                                                <td className={cn('px-4 py-2 text-right font-bold', pnlTone(optunaResult.realisticVerification?.totalReturnPct ?? 0))}>
                                                    {optunaResult.realisticVerification
                                                        ? `${optunaResult.realisticVerification.totalReturnPct >= 0 ? '+' : ''}${optunaResult.realisticVerification.totalReturnPct.toFixed(2)}%`
                                                        : '—'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">
                                                    {isEn ? 'Net Profit ($)' : 'Lucro Líquido ($)'}
                                                </th>
                                                <td className="px-3 py-2 text-right">{fmtMoney(optunaResult.inSampleMetrics.netProfitUsd, { sign: true })}</td>
                                                <td className={cn('px-3 py-2 text-right font-bold', pnlTone(optunaResult.outOfSampleMetrics.netProfitUsd))}>
                                                    {fmtMoney(optunaResult.outOfSampleMetrics.netProfitUsd, { sign: true })}
                                                </td>
                                                <td className={cn('px-4 py-2 text-right font-bold', pnlTone(optunaResult.realisticVerification?.netPnlUsd ?? 0))}>
                                                    {optunaResult.realisticVerification
                                                        ? fmtMoney(optunaResult.realisticVerification.netPnlUsd, { sign: true })
                                                        : '—'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">Sharpe Ratio</th>
                                                <td className="px-3 py-2 text-right">{optunaResult.inSampleMetrics.sharpeRatio.toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right font-semibold">{optunaResult.outOfSampleMetrics.sharpeRatio.toFixed(2)}</td>
                                                <td className="px-4 py-2 text-right font-semibold">
                                                    {optunaResult.realisticVerification ? optunaResult.realisticVerification.sharpe.toFixed(2) : '—'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">Profit Factor</th>
                                                <td className="px-3 py-2 text-right">{optunaResult.inSampleMetrics.profitFactor.toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right font-semibold">{optunaResult.outOfSampleMetrics.profitFactor.toFixed(2)}</td>
                                                <td className="px-4 py-2 text-right font-semibold">
                                                    {optunaResult.realisticVerification ? optunaResult.realisticVerification.profitFactor.toFixed(2) : '—'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">Win Rate</th>
                                                <td className="px-3 py-2 text-right">{optunaResult.inSampleMetrics.winRatePct.toFixed(1)}%</td>
                                                <td className="px-3 py-2 text-right font-semibold">{optunaResult.outOfSampleMetrics.winRatePct.toFixed(1)}%</td>
                                                <td className="px-4 py-2 text-right font-semibold">
                                                    {optunaResult.realisticVerification ? `${optunaResult.realisticVerification.winRatePct.toFixed(1)}%` : '—'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">Max Drawdown</th>
                                                <td className="px-3 py-2 text-right">{optunaResult.inSampleMetrics.maxDrawdownPct.toFixed(2)}%</td>
                                                <td className="px-3 py-2 text-right font-semibold">{optunaResult.outOfSampleMetrics.maxDrawdownPct.toFixed(2)}%</td>
                                                <td className="px-4 py-2 text-right font-semibold">
                                                    {optunaResult.realisticVerification ? `${optunaResult.realisticVerification.maxDrawdownPct.toFixed(2)}%` : '—'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">Trades</th>
                                                <td className="px-3 py-2 text-right">{optunaResult.inSampleMetrics.totalTrades}</td>
                                                <td className="px-3 py-2 text-right font-semibold">{optunaResult.outOfSampleMetrics.totalTrades}</td>
                                                <td className="px-4 py-2 text-right font-semibold">
                                                    {optunaResult.realisticVerification ? optunaResult.realisticVerification.totalTrades : '—'}
                                                </td>
                                            </tr>
                                            {optunaResult.realisticVerification && (
                                                <>
                                                    <tr className="bg-surface-2/30 text-xs">
                                                        <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">
                                                            {isEn ? 'Total Friction (Spread+Slip+Comm)' : 'Fricção Total (Spread+Slip+Comm)'}
                                                        </th>
                                                        <td className="px-3 py-2 text-right text-fg-subtle">—</td>
                                                        <td className="px-3 py-2 text-right text-fg-subtle">—</td>
                                                        <td className="px-4 py-2 text-right font-mono font-semibold text-amber-600 dark:text-amber-300">
                                                            -{fmtMoney(optunaResult.realisticVerification.totalFrictionUsd)}
                                                        </td>
                                                    </tr>
                                                    <tr className="bg-surface-2/30 text-xs">
                                                        <th scope="row" className="px-4 py-2 text-left font-medium text-fg-muted">
                                                            {isEn ? 'Killzone Filtered · Exp R' : 'Sinais Bloqueados · Exp R'}
                                                        </th>
                                                        <td className="px-3 py-2 text-right text-fg-subtle">—</td>
                                                        <td className="px-3 py-2 text-right text-fg-subtle">—</td>
                                                        <td className="px-4 py-2 text-right font-mono text-fg">
                                                            {optunaResult.realisticVerification.signalsFilteredBySession} bloq. ·{' '}
                                                            {optunaResult.realisticVerification.expectancyR >= 0 ? '+' : ''}
                                                            {optunaResult.realisticVerification.expectancyR.toFixed(2)}R
                                                        </td>
                                                    </tr>
                                                </>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </Panel>

                            <Panel
                                title={isEn ? 'Hyperparameter Importance' : 'Importância dos Hiperparâmetros'}
                                subtitle={isEn ? 'fANOVA sensitivity impact on Optuna objective.' : 'Impacto percentual fANOVA no objetivo Optuna.'}
                            >
                                <div className="space-y-2.5">
                                    {sortedImportances.map(([param, pct]) => (
                                        <div key={param} className="space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-mono font-semibold text-fg">{param}</span>
                                                <span className="tabular-nums text-fg-muted">{pct.toFixed(1)}%</span>
                                            </div>
                                            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                                                <div
                                                    className="h-full rounded-full bg-accent"
                                                    style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                    {optunaResult.realisticVerification && (
                                        <div className="mt-4 rounded-lg border border-line bg-surface-2/50 p-2.5 text-[11px] text-fg-muted">
                                            <div className="flex items-center gap-1.5 font-semibold text-fg">
                                                <ShieldAlert size={13} />
                                                <span>{isEn ? 'Friction Breakdown (OOS)' : 'Detalhe de Fricção (OOS)'}</span>
                                            </div>
                                            <div className="mt-1 space-y-0.5 tabular-nums">
                                                <div>Spread: {fmtMoney(optunaResult.realisticVerification.totalSpreadCostUsd)}</div>
                                                <div>Slippage: {fmtMoney(optunaResult.realisticVerification.totalSlippageCostUsd)}</div>
                                                <div>Comissão: {fmtMoney(optunaResult.realisticVerification.totalCommissionCostUsd)}</div>
                                                <div>MFE / MAE médio: +{optunaResult.realisticVerification.avgMfeR}R / -{optunaResult.realisticVerification.avgMaeR}R</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Panel>
                        </div>

                        {optunaResult.realisticTearsheet && (
                            <QuantTearSheetPanel
                                precomputedData={optunaResult.realisticTearsheet}
                                initialBalance={initialCapital}
                                symbol={optunaResult.symbol}
                                isEn={isEn}
                                title={isEn ? 'Out-of-Sample Realistic Tear-Sheet (QuantStats)' : 'Tear-Sheet Out-of-Sample Realista (QuantStats)'}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ page */

export const HypothesesPage = () => {
    const [params, setParams] = useSearchParams();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const view = (['account', 'projection', 'optimizer', 'saved'].includes(params.get('view') || '') ? params.get('view') : 'account') as View;
    return (
        <div className="space-y-4">
            <SubTabs
                label={isEn ? 'Analysis Mode' : 'Tipo de análise'}
                value={view}
                onChange={(v) => setParams(v === 'account' ? {} : { view: v }, { replace: true })}
                options={[
                    { value: 'account', label: isEn ? 'Account What-If' : 'Hipóteses sobre a conta', icon: <FlaskConical size={15} /> },
                    { value: 'projection', label: isEn ? 'Expectancy Projection' : 'Projeção de expectativa', icon: <Sigma size={15} /> },
                    { value: 'optimizer', label: isEn ? 'Quant Optimizer (Vector + Optuna)' : 'Otimizador Quant (Vector + Optuna)', icon: <Cpu size={15} /> },
                    { value: 'saved', label: isEn ? 'Saved' : 'Guardadas', icon: <History size={15} /> },
                ]}
            />
            {view === 'account' && <AccountHypothesis isEn={isEn} />}
            {view === 'projection' && <Projection isEn={isEn} />}
            {view === 'optimizer' && <QuantOptimizerView isEn={isEn} />}
            {view === 'saved' && <Saved isEn={isEn} />}
        </div>
    );
};
