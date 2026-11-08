import React, { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { PREVIEW_TABS } from './content';
import { Section, SectionHeading } from './primitives';

/** Product module switcher implemented as an accessible tablist (arrow keys, Home/End). */
export const PlatformShowcase = () => {
    const [activeId, setActiveId] = useState(PREVIEW_TABS[0].id);
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const activeIndex = Math.max(0, PREVIEW_TABS.findIndex((t) => t.id === activeId));
    const current = PREVIEW_TABS[activeIndex];

    const focusTab = (index: number) => {
        const i = (index + PREVIEW_TABS.length) % PREVIEW_TABS.length;
        setActiveId(PREVIEW_TABS[i].id);
        tabRefs.current[i]?.focus();
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const keys: Record<string, number> = {
            ArrowRight: activeIndex + 1,
            ArrowLeft: activeIndex - 1,
            Home: 0,
            End: PREVIEW_TABS.length - 1,
        };
        if (e.key in keys) {
            e.preventDefault();
            focusTab(keys[e.key]);
        }
    };

    return (
        <Section id="plataforma" aria-labelledby="plataforma-title">
            <SectionHeading
                id="plataforma-title"
                eyebrow="Plataforma interativa"
                title="Visualize cada dimensão do seu operacional"
                description="Alterne entre os módulos analíticos do Torex Journal para gerenciar suas operações com precisão."
            />

            <div
                role="tablist"
                aria-label="Módulos da plataforma"
                onKeyDown={onKeyDown}
                className="relative z-10 mx-auto mb-10 mt-8 flex max-w-6xl flex-wrap items-center justify-center gap-2.5 sm:gap-3"
            >
                {PREVIEW_TABS.map((tab, i) => {
                    const Icon = tab.icon;
                    const selected = tab.id === activeId;
                    return (
                        <button
                            key={tab.id}
                            ref={(el) => (tabRefs.current[i] = el)}
                            id={`tab-${tab.id}`}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls="plataforma-panel"
                            tabIndex={selected ? 0 : -1}
                            onClick={() => setActiveId(tab.id)}
                            className={cn(
                                'flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-bold transition-all sm:px-5 sm:text-sm',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                                selected
                                    ? 'border-accent bg-accent text-accent-on shadow-glow'
                                    : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg'
                            )}
                        >
                            <Icon size={16} aria-hidden className={selected ? 'text-accent-on' : 'text-accent-fg'} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="relative z-10 mx-auto max-w-6xl">
                <div aria-hidden className="pointer-events-none absolute -inset-2 rounded-2xl bg-gradient-to-b from-accent/20 via-accent/5 to-transparent opacity-60 blur-2xl" />

                <div
                    id="plataforma-panel"
                    role="tabpanel"
                    aria-labelledby={`tab-${current.id}`}
                    className="relative overflow-hidden rounded-2xl border border-line-strong bg-raised p-2.5 shadow-panel sm:p-4"
                >
                    <div className="mb-3 flex items-center justify-between rounded-t-xl border-b border-line bg-surface px-3 py-2">
                        <div className="flex items-center gap-2" aria-hidden>
                            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                            <span className="ml-2 hidden font-mono text-xs text-fg-subtle sm:inline">torexjournal.com/{current.id}</span>
                        </div>
                        <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-accent-fg">
                            {current.label}
                        </span>
                    </div>

                    <div className="relative overflow-hidden rounded-xl bg-canvas">
                        <img
                            key={current.id}
                            src={current.image}
                            alt={current.alt}
                            loading="lazy"
                            decoding="async"
                            className="block h-auto w-full rounded-xl border border-line object-contain animate-fade-in-up"
                        />
                    </div>

                    <p className="mt-3 flex items-center gap-2 rounded-lg bg-surface/60 px-3 py-2 text-xs text-fg-muted">
                        <CheckCircle2 size={14} aria-hidden className="shrink-0 text-accent-fg" />
                        {current.description}
                    </p>
                </div>
            </div>

        </Section>
    );
};
