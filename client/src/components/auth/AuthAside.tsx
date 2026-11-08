import React from 'react';
import { Check } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill';

interface AuthAsideProps {
    eyebrow?: string;
    title: React.ReactNode;
    description?: string;
    highlights: string[];
}

/** Brand column next to auth forms (desktop only). Content comes from props. */
export const AuthAside = ({ eyebrow, title, description, highlights }: AuthAsideProps) => (
    <div className="space-y-8 pr-6">
        {eyebrow && <StatusPill>{eyebrow}</StatusPill>}

        <h2 className="text-5xl font-extrabold leading-[1.15] tracking-tight text-fg">{title}</h2>

        {description && <p className="max-w-md text-lg leading-relaxed text-fg-muted">{description}</p>}

        <ul className="space-y-4 pt-2">
            {highlights.map((item) => (
                <li key={item} className="flex items-center gap-3.5">
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15">
                        <Check size={14} strokeWidth={3} className="text-accent-fg" />
                    </span>
                    <span className="text-base font-medium text-fg">{item}</span>
                </li>
            ))}
        </ul>
    </div>
);
