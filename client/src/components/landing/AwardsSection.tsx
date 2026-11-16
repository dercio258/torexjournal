import { Link } from 'react-router-dom';
import { ArrowRight, Award } from 'lucide-react';
import { buttonVariants } from '../ui/Button';
import { getLandingContent, LANDING_ASSETS, type LandingLocale } from './content';
import { Eyebrow, Section } from './primitives';
import { buildTaggedUrl } from '../../lib/attribution';

const Step = ({ index, title, description, highlight }: { index: number; title: string; description: string; highlight?: boolean }) => (
    <li
        className={
            highlight
                ? 'flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 p-3.5'
                : 'flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5'
        }
    >
        <span
            aria-hidden
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold text-accent-fg ${highlight ? 'bg-accent/20' : 'bg-accent/10'}`}
        >
            {String(index).padStart(2, '0')}
        </span>
        <div>
            <h3 className={`text-sm font-bold ${highlight ? 'text-accent-fg' : 'text-fg'}`}>{title}</h3>
            <p className={`mt-0.5 text-xs ${highlight ? 'text-accent-fg/80' : 'text-fg-subtle'}`}>{description}</p>
        </div>
    </li>
);

export const AwardsSection = ({ locale = 'pt' }: { locale?: LandingLocale }) => {
    const { awards } = getLandingContent(locale);
    const headingId = `${awards.sectionId}-title`;

    return (
        <Section id={awards.sectionId} aria-labelledby={headingId}>
            <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 lg:grid-cols-12">
                <figure className="group relative overflow-hidden rounded-2xl border border-accent/30 bg-raised shadow-panel lg:col-span-6">
                    <img
                        src={LANDING_ASSETS.awardImage}
                        alt={awards.imageAlt}
                        loading="lazy"
                        decoding="async"
                        className="h-auto w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.02]"
                    />
                    <figcaption className="absolute inset-x-3 bottom-3 flex items-center justify-between rounded-xl border border-line-strong bg-canvas/90 p-3 backdrop-blur-md">
                        <span className="flex items-center gap-2 text-xs font-bold text-fg">
                            <Award size={18} aria-hidden className="text-accent-fg" /> {awards.imageCaption}
                        </span>
                        <span className="rounded border border-accent/30 bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-accent-fg">
                            {awards.officialBadge}
                        </span>
                    </figcaption>
                </figure>

                <div className="lg:col-span-6">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <Eyebrow className="mb-0">{awards.eyebrow}</Eyebrow>
                        <span className="flex items-center gap-2 rounded-full border border-accent/30 bg-surface px-3 py-1">
                            <img src={LANDING_ASSETS.mascotRocket} alt="" loading="lazy" className="h-7 w-7 object-contain" />
                            <span className="font-mono text-[11px] font-bold text-accent-fg">Torex Pro</span>
                        </span>
                    </div>

                    <h2 id={headingId} className="mb-4 text-3xl font-extrabold tracking-tight text-fg sm:text-4xl">
                        {awards.title}
                    </h2>
                    <p className="mb-8 text-sm leading-relaxed text-fg-muted sm:text-base">{awards.description}</p>

                    <ol className="mb-8 space-y-4">
                        {awards.items.map((item, i) => (
                            <Step key={item.title} index={i + 1} {...item} />
                        ))}
                        <Step index={awards.items.length + 1} {...awards.requirement} highlight />
                    </ol>

                    <Link
                        to={buildTaggedUrl('/register', { ctaTag: 'lp_pt_awards_cta', intent: 'pro_award_signup' })}
                        data-cta-tag="lp_pt_awards_cta"
                        data-intent="pro_award_signup"
                        className={buttonVariants({ variant: 'brand', size: 'lg', pill: true, className: 'px-7' })}
                    >
                        {awards.ctaLabel} <ArrowRight size={16} strokeWidth={2.5} aria-hidden />
                    </Link>
                </div>
            </div>
        </Section>
    );
};
