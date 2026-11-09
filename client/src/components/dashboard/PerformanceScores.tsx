import { Gauge } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ChartCard } from '../charts/ChartCard';

interface PerformanceScoresProps {
    data: {
        consistency: number;
        riskManagement: number;
        discipline: number;
        profitability: number;
        winRate: number;
    };
}

const METRICS: { key: keyof PerformanceScoresProps['data']; label: string; hint: string }[] = [
    { key: 'consistency', label: 'Consistência', hint: '% de dias positivos' },
    { key: 'profitability', label: 'Lucratividade', hint: 'Fator de lucro vs. 2.5' },
    { key: 'riskManagement', label: 'Gestão de risco', hint: 'Payoff e uso de stop' },
    { key: 'discipline', label: 'Disciplina', hint: 'Estabilidade do lote' },
    { key: 'winRate', label: 'Taxa de acerto', hint: '% de trades vencedores' },
];

/** Severity band → status label + fill. Always shown with the number and label (never color alone). */
const band = (v: number) =>
    v >= 60
        ? { label: 'Bom', fill: 'bg-data-pos', text: 'text-accent-fg' }
        : v >= 40
          ? { label: 'Atenção', fill: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
          : { label: 'Fraco', fill: 'bg-data-neg', text: 'text-danger-fg' };

/** Replaces the radar: five 0–100 scores read faster and more precisely as meters. */
export const PerformanceScores = ({ data }: PerformanceScoresProps) => {
    const values = METRICS.map((m) => Math.max(0, Math.min(100, Math.round(Number(data?.[m.key]) || 0))));
    const overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const ob = band(overall);

    return (
        <ChartCard title="Score operacional" icon={<Gauge size={14} />} subtitle="Média de 5 indicadores (0–100)" className="h-full">
            <div className="mb-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-fg">{overall}</span>
                <span className="text-sm text-fg-subtle">/100</span>
                <span className={cn('ml-auto text-xs font-semibold', ob.text)}>{ob.label}</span>
            </div>

            <ul className="flex flex-1 flex-col justify-between gap-3">
                {METRICS.map((m, i) => {
                    const v = values[i];
                    const b = band(v);
                    return (
                        <li key={m.key}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-semibold text-fg">{m.label}</span>
                                <span className="text-xs font-semibold tabular-nums text-fg">
                                    {v}
                                    <span className="sr-only"> de 100, {b.label}</span>
                                </span>
                            </div>
                            <div
                                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
                                role="meter"
                                aria-label={m.label}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={v}
                            >
                                <div className={cn('h-full rounded-full transition-[width] duration-500', b.fill)} style={{ width: `${v}%` }} />
                            </div>
                            <p className="mt-0.5 text-[10.5px] text-fg-subtle">{m.hint}</p>
                        </li>
                    );
                })}
            </ul>
        </ChartCard>
    );
};
