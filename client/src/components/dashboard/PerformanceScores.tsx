import { Gauge } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ChartCard } from '../charts/ChartCard';
import { useLocale } from '../../context/LocaleContext';

interface PerformanceScoresProps {
    data: {
        consistency: number;
        riskManagement: number;
        discipline: number;
        profitability: number;
        winRate: number;
    };
    meta?: {
        usedJournalSignals?: boolean;
        sources?: {
            consistency?: 'legacy' | 'blended';
            riskManagement?: 'legacy' | 'blended';
            discipline?: 'legacy' | 'blended';
        };
        tips?: string[];
    };
}

const METRICS: {
    key: keyof PerformanceScoresProps['data'];
    label: string;
    labelEn: string;
    hint: string;
    hintEn: string;
    blendedHint?: string;
    blendedHintEn?: string;
}[] = [
    { key: 'consistency', label: 'Consistência', labelEn: 'Consistency', hint: '% de dias positivos', hintEn: '% of green sessions', blendedHint: '% de dias positivos + rotina do diário', blendedHintEn: '% green sessions + journal routine' },
    { key: 'profitability', label: 'Lucratividade', labelEn: 'Profitability', hint: 'Retenção líquida de lucro', hintEn: 'Net profit retention' },
    { key: 'riskManagement', label: 'Gestão de risco', labelEn: 'Risk Management', hint: 'Payoff e uso de stop', hintEn: 'Payoff & SL discipline', blendedHint: 'Payoff, stop e conforto/excursão do diário', blendedHintEn: 'Payoff, SL & journal excursion telemetry' },
    { key: 'discipline', label: 'Disciplina', labelEn: 'Discipline', hint: 'Estabilidade do lote', hintEn: 'Lot sizing stability', blendedHint: 'Estabilidade do lote + aderência ao plano', blendedHintEn: 'Lot stability + playbook adherence' },
    { key: 'winRate', label: 'Taxa de acerto', labelEn: 'Win Rate', hint: '% de trades vencedores', hintEn: '% winning executions' },
];

/** Severity band → status label + fill. Always shown with the number and label (never color alone). */
const band = (v: number, isEn: boolean) =>
    v >= 60
        ? { label: isEn ? 'Consistent' : 'Consistente', fill: 'bg-data-pos', text: 'text-accent-fg' }
        : v >= 40
          ? { label: isEn ? 'Moderate' : 'Moderado', fill: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
          : { label: isEn ? 'Developing' : 'Em evolução', fill: 'bg-data-neg', text: 'text-danger-fg' };

/** Replaces the radar: five 0–100 scores read faster and more precisely as meters. */
export const PerformanceScores = ({ data, meta }: PerformanceScoresProps) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const values = METRICS.map((m) => Math.max(0, Math.min(100, Math.round(Number(data?.[m.key]) || 0))));
    const overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const ob = band(overall, isEn);

    return (
        <ChartCard title={isEn ? 'Execution Score' : 'Score operacional'} icon={<Gauge size={14} />} subtitle={isEn ? '5-axis average (0–100)' : 'Média de 5 indicadores (0–100)'} className="h-full">
            <div className="mb-3 pb-3 border-b border-line flex items-baseline gap-1.5">
                <span className="text-3xl sm:text-4xl font-bold text-fg tabular-nums tracking-tight leading-none">{overall}</span>
                <span className="text-sm text-fg-subtle tabular-nums">/100</span>
                <span className={cn('ml-auto text-xs font-semibold', ob.text)}>{ob.label}</span>
            </div>

            <ul className="flex flex-1 flex-col justify-between gap-2.5">
                {METRICS.map((m, i) => {
                    const v = values[i];
                    const b = band(v, isEn);
                    const sourceKey = m.key as 'consistency' | 'riskManagement' | 'discipline';
                    const isBlended = Boolean(meta?.usedJournalSignals && meta?.sources?.[sourceKey] === 'blended');
                    const label = isEn ? m.labelEn : m.label;
                    const hint = isBlended && m.blendedHint
                        ? (isEn ? m.blendedHintEn : m.blendedHint)
                        : (isEn ? m.hintEn : m.hint);
                    return (
                        <li key={m.key}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-semibold text-fg">{label}</span>
                                <span className="text-xs font-semibold tabular-nums text-fg">
                                    {v}
                                    <span className="text-[11px] font-normal text-fg-subtle">/100</span>
                                    <span className="sr-only">, {b.label}</span>
                                </span>
                            </div>
                            <div
                                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2"
                                role="meter"
                                aria-label={label}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={v}
                            >
                                <div className={cn('h-full rounded-full transition-[width] duration-500', b.fill)} style={{ width: `${v}%` }} />
                            </div>
                            <p className="mt-0.5 text-[11px] text-fg-subtle">{hint}</p>
                        </li>
                    );
                })}
            </ul>
        </ChartCard>
    );
};
