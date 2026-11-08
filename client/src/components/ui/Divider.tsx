import { cn } from '../../lib/cn';

/** Horizontal rule with an optional centered label. Background-agnostic (no masking). */
export const Divider = ({ label, className }: { label?: string; className?: string }) => (
    <div role="separator" className={cn('flex items-center gap-4', className)}>
        <span className="h-px flex-1 bg-line" />
        {label && <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{label}</span>}
        <span className="h-px flex-1 bg-line" />
    </div>
);
