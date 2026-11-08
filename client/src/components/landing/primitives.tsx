import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';

/** In-page anchors (`#id`) render as <a>; app routes as router <Link>. */
export const SmartLink = ({
    href,
    className,
    children,
    onClick,
}: {
    href: string;
    className?: string;
    children: React.ReactNode;
    onClick?: () => void;
}) =>
    href.startsWith('#') ? (
        <a href={href} className={className} onClick={onClick}>
            {children}
        </a>
    ) : (
        <Link to={href} className={className} onClick={onClick}>
            {children}
        </Link>
    );

/** Standard landing section: consistent padding, divider and anchor offset for the fixed navbar. */
export const Section = ({
    id,
    className,
    children,
    'aria-labelledby': labelledBy,
}: {
    id?: string;
    className?: string;
    children: React.ReactNode;
    'aria-labelledby'?: string;
}) => (
    <section
        id={id}
        aria-labelledby={labelledBy}
        className={cn('relative z-10 scroll-mt-20 overflow-hidden border-t border-line px-4 py-20 sm:px-6 md:py-28 lg:px-8', className)}
    >
        {children}
    </section>
);

export const Eyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <p className={cn('mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-fg', className)}>{children}</p>
);

export const SectionHeading = ({
    id,
    eyebrow,
    title,
    description,
    className,
}: {
    id: string;
    eyebrow?: string;
    title: React.ReactNode;
    description?: string;
    className?: string;
}) => (
    <div className={cn('mx-auto max-w-3xl text-center', className)}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 id={id} className="mb-4 text-3xl font-extrabold tracking-tight text-fg sm:text-4xl md:text-5xl">
            {title}
        </h2>
        {description && <p className="mx-auto max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base">{description}</p>}
    </div>
);

/** Rounded "device frame" with ambient accent glow, used for product screenshots. */
export const ShowcaseFrame = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={cn('relative', className)}>
        <div aria-hidden className="pointer-events-none absolute -inset-3 rounded-3xl bg-gradient-to-r from-accent/30 via-accent/20 to-teal-500/15 opacity-70 blur-2xl" />
        <div className="relative overflow-hidden rounded-2xl border border-accent/40 bg-raised p-2 shadow-panel sm:p-2.5">{children}</div>
    </div>
);
