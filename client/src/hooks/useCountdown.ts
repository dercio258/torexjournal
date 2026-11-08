import { useCallback, useEffect, useState } from 'react';

/**
 * Seconds-based countdown. `start(n)` (re)starts it, `reset()` clears it.
 * `remaining` is 0 when idle.
 */
export const useCountdown = () => {
    const [remaining, setRemaining] = useState(0);
    const active = remaining > 0;

    useEffect(() => {
        if (!active) return;
        const id = window.setInterval(() => {
            setRemaining((s) => (s <= 1 ? 0 : s - 1));
        }, 1000);
        return () => window.clearInterval(id);
    }, [active]);

    const start = useCallback((seconds: number) => setRemaining(Math.max(0, Math.floor(seconds))), []);
    const reset = useCallback(() => setRemaining(0), []);

    return { remaining, active, start, reset };
};
