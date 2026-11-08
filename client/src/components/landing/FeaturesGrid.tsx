import { cn } from '../../lib/cn';
import { FEATURES, FeatureTone } from './content';
import { Section, SectionHeading } from './primitives';

// Full class strings so Tailwind's scanner picks them up.
const TONES: Record<FeatureTone, { tile: string; text: string }> = {
    emerald: { tile: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400' },
    blue: { tile: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400' },
    violet: { tile: 'bg-violet-500/10 border-violet-500/20', text: 'text-violet-400' },
    amber: { tile: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-400' },
    teal: { tile: 'bg-teal-500/10 border-teal-500/20', text: 'text-teal-400' },
    rose: { tile: 'bg-rose-500/10 border-rose-500/20', text: 'text-rose-400' },
};

export const FeaturesGrid = () => (
    <Section id="recursos" aria-labelledby="recursos-title" className="bg-canvas-subtle/80">
        <SectionHeading
            id="recursos-title"
            eyebrow="Recursos completos"
            title="Tudo o que você precisa para operar melhor."
            description="Ferramentas projetadas para traders ativos de futuros, forex e opções."
            className="mb-14"
        />

        <ul className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ title, description, tag, icon: Icon, tone }) => (
                <li
                    key={title}
                    className="group flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 transition-all duration-200 hover:-translate-y-px hover:border-accent/30 hover:shadow-panel"
                >
                    <div>
                        <div
                            aria-hidden
                            className={cn(
                                'mb-5 flex h-12 w-12 items-center justify-center rounded-xl border transition-transform motion-safe:group-hover:scale-110',
                                TONES[tone].tile,
                                TONES[tone].text
                            )}
                        >
                            <Icon size={22} />
                        </div>
                        <h3 className="mb-2 text-lg font-bold text-fg">{title}</h3>
                        <p className="text-sm leading-relaxed text-fg-muted">{description}</p>
                    </div>
                    <p className={cn('mt-6 border-t border-line pt-4 font-mono text-xs', TONES[tone].text)}>{tag}</p>
                </li>
            ))}
        </ul>
    </Section>
);
