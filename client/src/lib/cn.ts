import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the custom scales from tailwind.config.js so e.g.
// `rounded-control` + `rounded-full` resolve to the last one.
const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            radius: ['card', 'control', 'hero', 'panel', 'pill'],
            shadow: ['glow', 'focus-accent', 'focus-danger', 'panel'],
        },
    },
});

/** Compose class names; later Tailwind classes override conflicting earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
