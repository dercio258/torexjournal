import React from 'react';
import { cn } from '../../lib/cn';

/** Small rounded label with a pulsing "live" dot (eyebrows, status hints). */
export const StatusPill = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span
        className={cn(
            'inline-flex items-center gap-2 rounded-pill border border-accent/30 bg-surface px-3.5 py-1.5 text-xs font-semibold text-accent-fg backdrop-blur-md',
            className
        )}
    >
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent-fg motion-safe:animate-pulse" />
        {children}
    </span>
);
