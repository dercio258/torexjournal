import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { CandlestickHeroBackground } from './CandlestickBackground';
import { buttonVariants } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { getLandingContent, type LandingLocale } from './content';
import { Section } from './primitives';
import { buildTaggedUrl } from '../../lib/attribution';
import { trackButtonClick } from '../../lib/tracking';

export const ChecklistCta = ({ locale = 'pt' }: { locale?: LandingLocale }) => {
    const { checklist } = getLandingContent(locale);

    return (
        <Section aria-labelledby="checklist-title" className="isolate flex flex-col items-center py-24 md:py-32">
            <CandlestickHeroBackground opacity="opacity-70 sm:opacity-85" locale={locale} />

            <div className="relative z-20 mx-auto max-w-5xl text-center">
                <StatusPill className="mb-6">{checklist.eyebrow}</StatusPill>

                <h2 id="checklist-title" className="mb-4 text-3xl font-extrabold leading-[1.15] tracking-tight text-fg sm:text-5xl lg:text-6xl">
                    {checklist.title} <span className="text-accent-fg">{checklist.titleAccent}</span>
                </h2>

                <p className="mb-10 font-mono text-base font-bold tracking-wide text-accent-fg/90 sm:text-xl">{checklist.subtitle}</p>

                <ul className="mb-12 grid grid-cols-1 gap-3.5 text-left sm:grid-cols-2 lg:grid-cols-3">
                    {checklist.items.map((item, idx) => (
                        <li
                            key={item}
                            onClick={() =>
                                trackButtonClick({
                                    ctaTag: `lp_pt_checklist_item_${idx + 1}`,
                                    intent: 'feature_interest',
                                    label: item,
                                })
                            }
                            className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-raised/70 p-3.5 backdrop-blur-md transition-all hover:border-accent/40 hover:bg-surface/90"
                        >
                            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-accent-fg">
                                <Check size={14} strokeWidth={3} />
                            </span>
                            <span className="text-sm font-semibold text-fg">{item}</span>
                        </li>
                    ))}
                </ul>

                <Link
                    to={buildTaggedUrl('/register', { ctaTag: 'lp_pt_checklist_cta', intent: 'free_trial_checklist' })}
                    data-cta-tag="lp_pt_checklist_cta"
                    data-intent="free_trial_checklist"
                    className={buttonVariants({ variant: 'brand', size: 'lg', pill: true, className: 'px-8 font-bold' })}
                >
                    {checklist.ctaLabel} <ArrowRight size={16} strokeWidth={2.5} aria-hidden />
                </Link>
            </div>
        </Section>
    );
};
