import React from 'react';
import { Check } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill';

interface AuthAsideProps {
    eyebrow?: string;
    title: React.ReactNode;
    description?: string;
    highlights: string[];
    footer?: React.ReactNode;
}

/** Brand column next to auth forms (desktop only). Content comes from props. */
export const AuthAside = ({ eyebrow, title, description, highlights, footer }: AuthAsideProps) => (
    <div className="space-y-6 pr-6">
        {eyebrow && <StatusPill>{eyebrow}</StatusPill>}

        <h2 className="text-4xl font-extrabold leading-[1.12] tracking-tight text-fg xl:text-5xl">{title}</h2>

        {description && <p className="max-w-lg text-base leading-relaxed text-fg-muted xl:text-lg">{description}</p>}

        <ul className="space-y-3.5 pt-1">
            {highlights.map((item) => (
                <li key={item} className="flex items-center gap-3.5">
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15">
                        <Check size={14} strokeWidth={3} className="text-accent-fg" />
                    </span>
                    <span className="text-base font-medium text-fg">{item}</span>
                </li>
            ))}
        </ul>

        {footer && <div className="pt-2">{footer}</div>}
    </div>
);
