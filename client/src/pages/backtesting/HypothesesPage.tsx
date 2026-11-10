import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Database, FlaskConical, History, Lightbulb, Play, RefreshCw, Save, Sigma } from 'lucide-react';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';
import { Button } from '../../components/ui/Button';
import { ComparisonChart } from '../../components/backtesting/ComparisonChart';
import { runProjection, ProjectionInput } from '../../components/backtesting/projection';
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

type View = 'account' | 'projection' | 'saved';

const RR_PRESETS = [1, 1.5, 2, 2.5, 3];

const Assumptions = ({ items }: { items: string[] }) => (
    <div className="rounded-lg border border-line bg-surface-2/50 p-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Premissas</p>
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

const RrPicker = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <div role="radiogroup" aria-label="Alvo R:R" className="flex flex-wrap gap-1.5">
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

const AccountHypothesis = () => {
    const { selectedAccountId, selectedAccount } = useAccount();
    const accountLabel = selectedAccount?.name || 'Todas as contas';
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
            setError(e?.response?.data?.message || 'Não foi possível executar a simulação.');
        } finally {
            setRunning(false);
        }
    };

    const save = async () => {
        if (!result?.comparison) return;
        setSaving(true);
        try {
            await api.post(
                '/dashboard/backtest/save',
                {
                    name: `Hipótese 1:${cfg.rrTarget} · ${cfg.riskPerTrade}%${cfg.excludeAsian ? ' · sem Ásia' : ''}${cfg.excludeFridays ? ' · sem sextas' : ''}`,
                    mode: 'ACCOUNT_HISTORY',
                    strategy: 'Hipótese sobre o histórico',
                    symbol: 'ALL',
                    config: cfg,
                    results: result.comparison,
                    notes: (result.insights || []).join(' '),
                },
                { params: { accountId: accountParam } }
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
                label: p.date && p.date !== 'N/A' ? `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}` : `#${i + 1}`,
                a: Math.round((p.realEquity - cfg.initialBalance) * 100) / 100,
                b: Math.round((p.simulatedEquity - cfg.initialBalance) * 100) / 100,
            })),
        [result, cfg.initialBalance]
    );

    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <Panel title="Hipótese" subtitle="Reaplica regras de gestão aos trades que já fez.">
                <div className="space-y-4">
                    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/50 p-3 text-xs">
                        <Database size={15} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden />
                        <p className="text-fg-muted">
                            Fonte: <strong className="text-fg">trades fechados de {accountLabel}</strong>, por ordem de fecho. Mude a conta no seletor do topo.
                        </p>
                    </div>
                    <Field label="Alvo R:R por trade">
                        <RrPicker value={cfg.rrTarget} onChange={(v) => setCfg({ ...cfg, rrTarget: v })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Risco (%)" htmlFor="wi-risk">
                            <input id="wi-risk" type="number" step="0.25" min="0.1" max="10" value={cfg.riskPerTrade} onChange={(e) => setCfg({ ...cfg, riskPerTrade: Number(e.target.value) })} className={inputCls} />
                        </Field>
                        <Field label="Saldo inicial ($)" htmlFor="wi-bal">
                            <input id="wi-bal" type="number" min="1" value={cfg.initialBalance} onChange={(e) => setCfg({ ...cfg, initialBalance: Number(e.target.value) })} className={inputCls} />
                        </Field>
                    </div>
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-fg">Filtros</p>
                        <Toggle checked={cfg.excludeAsian} onChange={(v) => setCfg({ ...cfg, excludeAsian: v })} label="Excluir sessão asiática" description="Trades abertos entre 22h e 08h UTC (Sydney/Tóquio)." />
                        <Toggle checked={cfg.excludeFridays} onChange={(v) => setCfg({ ...cfg, excludeFridays: v })} label="Excluir sextas-feiras" description="Pelo dia de fecho, em UTC." />
                    </div>
                    <Assumptions
                        items={[
                            'Cada trade vencedor passa a valer +R:R × risco; cada perdedor, −1 × risco.',
                            'O risco é uma % do saldo simulado no momento (juros compostos).',
                            'Trades a zero não contam; não há spread nem comissão adicionais.',
                            'Assume que os ganhos teriam chegado ao alvo — um teto otimista.',
                        ]}
                    />
                    <Button variant="brand" fullWidth isLoading={running} icon={<Play size={14} fill="currentColor" />} onClick={run} disabled={!(cfg.riskPerTrade > 0) || !(cfg.initialBalance > 0)}>
                        Testar hipótese
                    </Button>
                </div>
            </Panel>

            <div className="min-w-0 space-y-4">
                {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger-fg">{error}</p>}
                {!result ? (
                    <EmptyState icon={<Lightbulb size={20} />} title="Defina a hipótese e teste" description="O resultado compara a conta real com a mesma sequência de trades sob as novas regras." />
                ) : !c ? (
                    <EmptyState title="Sem trades para simular" description={result.message || 'Esta conta ainda não tem trades fechados.'} />
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <KpiCard label="Resultado real" value={fmtMoney(c.realNetProfit, { sign: true })} tone={pnlTone(c.realNetProfit)} hint={`${c.realTrades} trades`} />
                            <KpiCard label="Com a hipótese" value={fmtMoney(c.simulatedNetProfit, { sign: true })} tone={pnlTone(c.simulatedNetProfit)} hint={`${c.simulatedTrades} trades considerados`} />
                            <KpiCard label="Diferença" value={fmtMoney(c.profitDelta, { sign: true })} tone={pnlTone(c.profitDelta)} hint={c.excludedTrades ? `${c.excludedTrades} excluídos pelos filtros` : 'Sem trades excluídos'} className="col-span-2 md:col-span-1" />
                        </div>

                        <Panel title="Curva acumulada" subtitle="P&L acumulado, trade a trade, pela data de fecho.">
                            <ComparisonChart data={curve} labelA="Real" labelB="Hipótese" />
                        </Panel>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
                            <Panel
                                title="Comparação"
                                bodyClassName="p-0"
                                actions={
                                    <Button variant="outline" size="sm" isLoading={saving} icon={<Save size={13} />} onClick={save} disabled={saved}>
                                        {saved ? 'Guardada' : 'Guardar simulação'}
                                    </Button>
                                }
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[460px] text-sm">
                                        <thead>
                                            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-fg-subtle">
                                                <th className="px-4 py-2 text-left font-semibold">Métrica</th>
                                                <th className="px-4 py-2 text-right font-semibold">Real</th>
                                                <th className="px-4 py-2 text-right font-semibold">Hipótese</th>
                                                <th className="px-4 py-2 text-right font-semibold">Diferença</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line">
                                            <ResultRow label="Resultado líquido" real={c.realNetProfit} hyp={c.simulatedNetProfit} fmt={(v) => fmtMoney(v)} better="up" />
                                            <ResultRow label="Taxa de acerto" real={c.realWinRate ?? null} hyp={c.simulatedWinRate} fmt={(v) => `${fmtNum(v, 1)}%`} better="up" />
                                            <ResultRow label="Profit factor" real={c.realProfitFactor ?? null} hyp={c.simulatedProfitFactor ?? null} fmt={(v) => fmtNum(v)} better="up" />
                                            <ResultRow label="Drawdown máx." real={c.realMaxDrawdown ?? null} hyp={c.simulatedMaxDrawdown} fmt={(v) => fmtMoney(v)} better="down" />
                                            <ResultRow label="Drawdown máx. (%)" real={c.realMaxDrawdownPercent ?? null} hyp={c.simulatedMaxDrawdownPercent} fmt={(v) => `${fmtNum(v, 1)}%`} better="down" />
                                        </tbody>
                                    </table>
                                </div>
                            </Panel>
                            <Panel title="Leitura">
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

const Projection = () => {
    const [inp, setInp] = useState<ProjectionInput>({ capital: 10000, riskPct: 1, rr: 2, winRatePct: 45, trades: 100, sizing: 'fixed', ruinPct: 20 });
    const [result, setResult] = useState(() => runProjection(inp));
    const set = <K extends keyof ProjectionInput>(k: K, v: ProjectionInput[K]) => setInp((p) => ({ ...p, [k]: v }));
    const valid = inp.capital > 0 && inp.riskPct > 0 && inp.rr > 0 && inp.winRatePct >= 0 && inp.winRatePct <= 100 && inp.trades >= 1 && inp.trades <= 2000;
    const maxCount = Math.max(...result.histogram.map((h) => h.count), 1);

    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <Panel title="Parâmetros" subtitle="Quanto pode variar um resultado com esta vantagem?">
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (valid) setResult(runProjection({ ...inp, seed: Math.floor(Math.random() * 1e9) }));
                    }}
                >
                    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                        <Sigma size={15} className="mt-0.5 shrink-0" aria-hidden />
                        <p>Hipotético: não usa dados de mercado, só os números abaixo. Use para dimensionar risco, não para validar uma estratégia.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Taxa de acerto (%)">
                            <input type="number" min="0" max="100" step="1" value={inp.winRatePct} onChange={(e) => set('winRatePct', Number(e.target.value))} className={inputCls} />
                        </Field>
                        <Field label="Trades">
                            <input type="number" min="1" max="2000" step="10" value={inp.trades} onChange={(e) => set('trades', Number(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <Field label="Alvo R:R">
                        <RrPicker value={inp.rr} onChange={(v) => set('rr', v)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Risco (%)">
                            <input type="number" min="0.1" max="10" step="0.25" value={inp.riskPct} onChange={(e) => set('riskPct', Number(e.target.value))} className={inputCls} />
                        </Field>
                        <Field label="Capital ($)">
                            <input type="number" min="1" value={inp.capital} onChange={(e) => set('capital', Number(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Dimensionamento">
                            <select value={inp.sizing} onChange={(e) => set('sizing', e.target.value as ProjectionInput['sizing'])} className={inputCls}>
                                <option value="fixed">Risco fixo</option>
                                <option value="compound">Composto</option>
                            </select>
                        </Field>
                        <Field label="Limite de ruína (%)" hint="Drawdown a partir do pico.">
                            <input type="number" min="1" max="100" step="1" value={inp.ruinPct} onChange={(e) => set('ruinPct', Number(e.target.value))} className={inputCls} />
                        </Field>
                    </div>
                    <Button type="submit" variant="brand" fullWidth icon={<RefreshCw size={14} />} disabled={!valid}>
                        Simular {result.runs.toLocaleString('pt-BR')} cenários
                    </Button>
                </form>
            </Panel>

            <div className="min-w-0 space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <KpiCard label="Expectativa" value={`${result.expectancyR > 0 ? '+' : ''}${fmtNum(result.expectancyR)}R`} tone={pnlTone(result.expectancyR)} hint={`Equilíbrio: ${fmtNum(result.breakevenWinRate, 1)}% de acerto`} />
                    <KpiCard label="Resultado mediano" value={fmtMoney(result.percentiles.p50, { sign: true })} tone={pnlTone(result.percentiles.p50)} hint={`após ${inp.trades} trades`} />
                    <KpiCard label="Probabilidade de prejuízo" value={`${fmtNum(result.probLoss, 1)}%`} hint="Cenários que acabam abaixo do capital" />
                    <KpiCard label={`Risco de ruína (${inp.ruinPct}%)`} value={`${fmtNum(result.probRuin, 1)}%`} tone={result.probRuin >= 10 ? 'text-danger-fg' : undefined} hint={`Drawdown mediano ${fmtNum(result.medianMaxDdPct, 1)}%`} />
                </div>

                <Panel title="Distribuição do resultado final" subtitle={`${result.runs.toLocaleString('pt-BR')} sequências aleatórias com os mesmos parâmetros`}>
                    <div className="flex h-40 items-end gap-0.5" role="img" aria-label={`Do pior 5% (${fmtMoney(result.percentiles.p5)}) ao melhor 5% (${fmtMoney(result.percentiles.p95)})`}>
                        {result.histogram.map((h, i) => {
                            const mid = (h.from + h.to) / 2;
                            return (
                                <div
                                    key={i}
                                    title={`${fmtMoney(h.from)} a ${fmtMoney(h.to)}: ${h.count} cenários`}
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
                                ['Pior 5%', result.percentiles.p5],
                                ['25%', result.percentiles.p25],
                                ['Mediana', result.percentiles.p50],
                                ['75%', result.percentiles.p75],
                                ['Melhor 5%', result.percentiles.p95],
                            ] as const
                        ).map(([k, v]) => (
                            <div key={k}>
                                <dt className="text-[11px] text-fg-subtle">{k}</dt>
                                <dd className={cn('mt-0.5 text-sm font-semibold tabular-nums', pnlTone(v))}>{fmtMoney(v, { sign: true, decimals: 0 })}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mt-3 text-[11px] text-fg-subtle">Sequência de perdas mais longa (mediana): {result.longestLosingStreakMedian} trades seguidos.</p>
                </Panel>
            </div>
        </div>
    );
};

/* ---------------------------------------------------------------- saved */

const Saved = () => {
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
            setError('Não foi possível carregar as simulações guardadas.');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        load();
    }, [selectedAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

    const typeLabel = (m: string) => (m === 'REPLAY_SESSION' ? 'Sessão de replay' : m === 'STRATEGY_SIM' ? 'Projeção' : 'Hipótese');

    return (
        <Panel
            title="Simulações guardadas"
            subtitle="Guardadas no servidor (últimas 20 da conta selecionada)."
            actions={
                <Button variant="outline" size="sm" icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />} onClick={load}>
                    Atualizar
                </Button>
            }
            bodyClassName="p-0"
        >
            {error ? (
                <p className="px-5 py-8 text-center text-xs text-danger-fg">{error}</p>
            ) : items.length === 0 ? (
                <p className="px-5 py-10 text-center text-xs text-fg-muted">{loading ? 'A carregar…' : 'Ainda não guardou nenhuma simulação.'}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                                <th className="px-4 py-2 font-semibold">Nome</th>
                                <th className="px-3 py-2 font-semibold">Tipo</th>
                                <th className="px-3 py-2 font-semibold">Conta</th>
                                <th className="px-3 py-2 text-right font-semibold">Trades</th>
                                <th className="px-3 py-2 text-right font-semibold">Acerto</th>
                                <th className="px-3 py-2 text-right font-semibold">Resultado</th>
                                <th className="px-4 py-2 text-right font-semibold">Data</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {items.map((s) => {
                                const r = s.results || {};
                                const net = Number(r.simulatedNetProfit ?? 0);
                                return (
                                    <tr key={s.id} className="hover:bg-surface-2/50">
                                        <td className="max-w-[18rem] px-4 py-2">
                                            <p className="truncate font-semibold text-fg">{s.name}</p>
                                            {s.notes && <p className="truncate text-[11px] text-fg-muted">{s.notes}</p>}
                                        </td>
                                        <td className="px-3 py-2">
                                            <Badge>{typeLabel(s.mode)}</Badge>
                                        </td>
                                        <td className="px-3 py-2 text-fg-muted">{s.account?.name || '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{r.simulatedTrades ?? '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{r.simulatedWinRate !== undefined ? `${fmtNum(Number(r.simulatedWinRate), 1)}%` : '—'}</td>
                                        <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', pnlTone(net))}>{fmtMoney(net, { sign: true })}</td>
                                        <td className="whitespace-nowrap px-4 py-2 text-right text-fg-muted">{fmtDateTime(s.createdAt)}</td>
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

/* ------------------------------------------------------------------ page */

export const HypothesesPage = () => {
    const [params, setParams] = useSearchParams();
    const view = (['account', 'projection', 'saved'].includes(params.get('view') || '') ? params.get('view') : 'account') as View;
    return (
        <div className="space-y-4">
            <SubTabs
                label="Tipo de análise"
                value={view}
                onChange={(v) => setParams(v === 'account' ? {} : { view: v }, { replace: true })}
                options={[
                    { value: 'account', label: 'Hipóteses sobre a conta', icon: <FlaskConical size={15} /> },
                    { value: 'projection', label: 'Projeção de expectativa', icon: <Sigma size={15} /> },
                    { value: 'saved', label: 'Guardadas', icon: <History size={15} /> },
                ]}
            />
            {view === 'account' && <AccountHypothesis />}
            {view === 'projection' && <Projection />}
            {view === 'saved' && <Saved />}
        </div>
    );
};
