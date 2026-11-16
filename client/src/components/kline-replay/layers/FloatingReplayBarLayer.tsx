import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
    Play, Pause, SkipForward, SkipBack, FastForward,
    ChevronDown, Scissors, Plus, FileText, Upload, CheckCircle2, Calendar,
    Pin, PinOff,
} from 'lucide-react';
import { useLocale } from '../../../context/LocaleContext';

function toLocalDateTimeInputValue(ts: number): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const REPLAY_BAR_POS_KEY = 'torex_replay_bar_pos_v1';
const REPLAY_BAR_DOCKED_KEY = 'cossa.replay.barDocked.v1';

function readSavedBarDocked(): boolean {
    try {
        const raw = localStorage.getItem(REPLAY_BAR_DOCKED_KEY);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
    } catch (_) {}
    return typeof window !== 'undefined' ? window.innerWidth < 1366 : false;
}

function readSavedBarPos(): { x: number; y: number } {
    try {
        const raw = localStorage.getItem(REPLAY_BAR_POS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
                return {
                    x: Math.max(8, Math.min(1200, parsed.x)),
                    y: Math.max(8, Math.min(800, parsed.y)),
                };
            }
        }
    } catch (_) {}
    return { x: 84, y: 52 };
}

function computeNextUtcSessionTimestamp(baseTs: number, targetUtcHour: number): number {
    const d = new Date(baseTs);
    const candidate = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), targetUtcHour, 0, 0, 0)
    );
    if (candidate.getTime() <= baseTs) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    while (candidate.getUTCDay() === 6 || candidate.getUTCDay() === 0) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate.getTime();
}

interface FloatingReplayBarLayerProps {
    autoPlaying: boolean;
    replaySpeedLabel: string;
    syncEnabled: boolean;
    cutCandleMode: boolean;
    savingSession: boolean;
    savedSuccess: boolean;
    currentReplayTimestamp?: number | null;
    onStepBackward: () => void;
    onTogglePlay: () => void;
    onStepForward: () => void;
    onFastForward: () => void;
    onChangeSpeed: (label: string) => void;
    onToggleSync: () => void;
    onActivateCutCandle: () => void;
    onJumpToRatio: (ratio: number) => void;
    onJumpToTimestamp: (timestampMs: number) => void;
    onToggleTradeDrawer: () => void;
    onToggleJournalDrawer: () => void;
    onSaveSession: () => void;
}

export const FloatingReplayBarLayer: React.FC<FloatingReplayBarLayerProps> = memo(({
    autoPlaying,
    replaySpeedLabel,
    syncEnabled,
    cutCandleMode,
    savingSession,
    savedSuccess,
    currentReplayTimestamp,
    onStepBackward,
    onTogglePlay,
    onStepForward,
    onFastForward,
    onChangeSpeed,
    onToggleSync,
    onActivateCutCandle,
    onJumpToRatio,
    onJumpToTimestamp,
    onToggleTradeDrawer,
    onToggleJournalDrawer,
    onSaveSession,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [docked, setDocked] = useState<boolean>(readSavedBarDocked);
    const [goToMenuOpen, setGoToMenuOpen] = useState(false);
    const [customDateTime, setCustomDateTime] = useState<string>('');
    const pillElementRef = useRef<HTMLDivElement | null>(null);
    const posRef = useRef<{ x: number; y: number }>(readSavedBarPos());
    const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({
        dragging: false, startX: 0, startY: 0, origX: posRef.current.x, origY: posRef.current.y
    });

    const toggleDocked = useCallback(() => {
        setDocked((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(REPLAY_BAR_DOCKED_KEY, String(next));
            } catch (_) {}
            return next;
        });
    }, []);

    const clampFloatingPosition = useCallback(() => {
        if (docked) return;
        const el = pillElementRef.current;
        const parent = el?.parentElement;
        if (!el || !parent) return;
        const maxX = Math.max(8, parent.clientWidth - el.offsetWidth - 8);
        const maxY = Math.max(8, parent.clientHeight - el.offsetHeight - 8);
        const clampedX = Math.max(8, Math.min(maxX, posRef.current.x));
        const clampedY = Math.max(8, Math.min(maxY, posRef.current.y));
        if (clampedX !== posRef.current.x || clampedY !== posRef.current.y) {
            posRef.current = { x: clampedX, y: clampedY };
        }
        el.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
    }, [docked]);

    useEffect(() => {
        if (docked) return;
        clampFloatingPosition();
        const parent = pillElementRef.current?.parentElement;
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(clampFloatingPosition) : null;
        if (ro && parent) ro.observe(parent);
        window.addEventListener('resize', clampFloatingPosition);
        return () => {
            ro?.disconnect();
            window.removeEventListener('resize', clampFloatingPosition);
        };
    }, [docked, clampFloatingPosition]);

    useEffect(() => {
        if (!goToMenuOpen) return;
        if (currentReplayTimestamp && !customDateTime) {
            setCustomDateTime(toLocalDateTimeInputValue(currentReplayTimestamp));
        }
        const onPointerDown = (e: PointerEvent) => {
            if (pillElementRef.current && !pillElementRef.current.contains(e.target as Node)) {
                setGoToMenuOpen(false);
            }
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        return () => window.removeEventListener('pointerdown', onPointerDown, true);
    }, [goToMenuOpen, currentReplayTimestamp]);

    // GPU-accelerated 60fps drag without triggering React re-renders
    const handleMouseDown = (e: React.MouseEvent) => {
        if (docked) return;
        dragRef.current = {
            dragging: true,
            startX: e.clientX,
            startY: e.clientY,
            origX: posRef.current.x,
            origY: posRef.current.y,
        };
    };

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current.dragging || !pillElementRef.current) return;
            const parent = pillElementRef.current.parentElement;
            const maxX = parent ? Math.max(8, parent.clientWidth - pillElementRef.current.offsetWidth - 8) : 1400;
            const maxY = parent ? Math.max(8, parent.clientHeight - pillElementRef.current.offsetHeight - 8) : 900;
            const nextX = Math.max(8, Math.min(maxX, dragRef.current.origX + (e.clientX - dragRef.current.startX)));
            const nextY = Math.max(8, Math.min(maxY, dragRef.current.origY + (e.clientY - dragRef.current.startY)));
            posRef.current = { x: nextX, y: nextY };
            pillElementRef.current.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
        };
        const onUp = () => {
            if (dragRef.current.dragging) {
                dragRef.current.dragging = false;
                try {
                    localStorage.setItem(REPLAY_BAR_POS_KEY, JSON.stringify(posRef.current));
                } catch (_) {}
            }
        };
        window.addEventListener('mousemove', onMove, { passive: true });
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

    const handleResetBarPosition = () => {
        const def = { x: 84, y: 52 };
        posRef.current = def;
        if (pillElementRef.current && !docked) {
            pillElementRef.current.style.transform = `translate3d(${def.x}px, ${def.y}px, 0)`;
        }
        try {
            localStorage.removeItem(REPLAY_BAR_POS_KEY);
        } catch (_) {}
    };

    const handleApplyDateJump = () => {
        if (!customDateTime) return;
        const ts = new Date(customDateTime).getTime();
        if (!Number.isNaN(ts) && ts > 0) {
            setGoToMenuOpen(false);
            onJumpToTimestamp(ts);
        }
    };

    return (
        <div
            ref={pillElementRef}
            style={docked ? undefined : { transform: `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)` }}
            className={
                docked
                    ? 'absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[calc(100%-24px)] z-40 flex flex-wrap justify-center items-center gap-1.5 px-2.5 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md bg-surface/95 border-line-strong text-fg'
                    : 'absolute left-0 top-0 z-40 flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md will-change-transform bg-surface/95 border-line-strong text-fg max-w-[calc(100%-16px)]'
            }
        >
            {/* Dock / Undock toggle + Drag Grip (=) */}
            <button
                type="button"
                onClick={toggleDocked}
                className="p-1 rounded-md text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
                title={
                    docked
                        ? isEn
                            ? 'Undock bar (floating draggable mode)'
                            : 'Desafixar barra (modo flutuante)'
                        : isEn
                          ? 'Dock bar at bottom center'
                          : 'Ancorar barra no rodapé'
                }
            >
                {docked ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
            {!docked && (
                <div
                    onMouseDown={handleMouseDown}
                    onDoubleClick={handleResetBarPosition}
                    className="cursor-grab active:cursor-grabbing px-1 text-fg-subtle hover:text-fg-muted font-bold text-sm select-none"
                    title={isEn ? 'Drag Replay Bar (Double-click to reset position)' : 'Arrastar Barra de Replay (Duplo-clique para reposicionar)'}
                >
                    =
                </div>
            )}

            {/* Step Backward */}
            <button
                onClick={onStepBackward}
                className="p-1.5 rounded-lg text-fg-subtle hover:text-fg transition-colors cursor-pointer"
                title={isEn ? 'Step Back 1 Candle (←)' : 'Voltar 1 Vela (←)'}
            >
                <SkipBack size={15} />
            </button>

            {/* Big Play / Pause Button */}
            <button
                onClick={onTogglePlay}
                className="w-8 h-8 rounded-xl bg-accent hover:bg-accent-hover text-accent-on flex items-center justify-center shadow-md cursor-pointer transition-transform active:scale-95"
                title={
                    autoPlaying
                        ? isEn
                            ? 'Pause Replay (Space)'
                            : 'Pausar Replay (Espaço)'
                        : isEn
                          ? 'Play Replay (Space)'
                          : 'Iniciar Replay (Espaço)'
                }
            >
                {autoPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>

            {/* Step Forward */}
            <button
                onClick={onStepForward}
                className="p-1.5 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
                title={isEn ? 'Step Forward 1 Candle (→)' : 'Avançar 1 Vela (→)'}
            >
                <SkipForward size={15} />
            </button>

            {/* Fast Forward */}
            <button
                onClick={onFastForward}
                className="p-1.5 rounded-lg text-fg-subtle hover:text-fg transition-colors cursor-pointer"
                title={isEn ? 'Fast Forward 5 Candles' : 'Avançar 5 Velas Rápido'}
            >
                <FastForward size={15} />
            </button>

            <div className="h-4 w-px mx-0.5 bg-surface-3" />

            {/* Speed Selector */}
            <div className="flex items-center gap-1 text-xs">
                <span className="text-fg-subtle font-medium text-[11px]">{isEn ? 'Spd' : 'Vel.'}</span>
                <select
                    value={replaySpeedLabel}
                    onChange={e => onChangeSpeed(e.target.value)}
                    className="px-1.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer bg-surface-2 border-line text-fg"
                >
                    <option value="0.5x">0.5x</option>
                    <option value="1x">1x</option>
                    <option value="2x">2x</option>
                    <option value="5x">5x</option>
                    <option value="10x">10x</option>
                </select>
            </div>

            {/* Sync Switch */}
            <div className="flex items-center gap-1 text-xs">
                <span className="text-fg-subtle font-medium text-[11px]">Sync</span>
                <button
                    onClick={onToggleSync}
                    className={`w-8 h-4.5 rounded-full transition-colors p-0.5 cursor-pointer ${
                        syncEnabled ? 'bg-accent' : 'bg-surface-3'
                    }`}
                    title={
                        isEn
                            ? 'Sync Timestamp across Timeframes & Multi-Chart Panes'
                            : 'Sincronizar Timestamp entre Timeframes e Layouts Multi-Tela'
                    }
                >
                    <div className={`w-3.5 h-3.5 rounded-full bg-surface shadow transition-transform ${
                        syncEnabled ? 'translate-x-3.5' : 'translate-x-0'
                    }`} />
                </button>
            </div>

            {/* Direct Cut Candle / Scissor Button (Cortar Gráfico — Único local canônico) */}
            <button
                type="button"
                onClick={onActivateCutCandle}
                title={
                    isEn
                        ? 'Slice Chart / Choose Replay Start Candle (Shortcut: C)'
                        : 'Cortar Gráfico / Escolher Vela Inicial do Replay (Atalho: C)'
                }
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    cutCandleMode
                        ? 'bg-amber-500 text-white border-amber-500 shadow-md animate-pulse'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20'
                }`}
            >
                <Scissors size={13} />
                <span>{isEn ? 'Slice' : 'Cortar'}</span>
            </button>

            {/* Go to Menu */}
            <div className="relative">
                <button
                    onClick={() => setGoToMenuOpen(o => !o)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border cursor-pointer bg-surface-2 border-line text-fg hover:bg-surface-3/70"
                >
                    <Calendar size={12} />
                    <span>{isEn ? 'Go to' : 'Ir para'}</span>
                    <ChevronDown size={11} />
                </button>
                {goToMenuOpen && (
                    <div
                        className={`absolute left-0 w-64 rounded-xl border shadow-2xl p-2 z-[120] text-xs bg-surface border-line ${
                            docked ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                        }`}
                    >
                        <button
                            onClick={() => {
                                setGoToMenuOpen(false);
                                onActivateCutCandle();
                            }}
                            className="w-full px-2.5 py-2 rounded-lg text-left font-bold text-accent-fg hover:bg-accent/10 flex items-center gap-1.5 cursor-pointer"
                        >
                            <Scissors size={13} />
                            {isEn ? 'Pick Candle with Mouse' : 'Escolher Vela com o Mouse'}
                        </button>

                        <div className="h-px my-1.5 bg-surface-2" />

                        {/* Calendar Date & Time Picker */}
                        <div className="px-2 py-1 space-y-1.5">
                            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-60">
                                <Calendar size={11} /> {isEn ? 'Jump to Exact Date / Time' : 'Ir para Data / Hora Exata'}
                            </label>
                            <div className="flex items-center gap-1">
                                <input
                                    type="datetime-local"
                                    value={customDateTime}
                                    onChange={e => setCustomDateTime(e.target.value)}
                                    className={`flex-1 px-2 py-1 rounded border text-[11px] font-mono ${
                                        'bg-surface-2 border-line text-fg'
                                    }`}
                                />
                                <button
                                    onClick={handleApplyDateJump}
                                    className="px-2.5 py-1 rounded bg-accent hover:bg-accent-hover text-accent-on font-bold text-[11px] cursor-pointer"
                                >
                                    {isEn ? 'Go' : 'Ir'}
                                </button>
                            </div>
                        </div>

                        <div className={`h-px my-1.5 ${'bg-surface-2'}`} />

                        {/* Institutional Session Open Jumps (Killzones) */}
                        <div className="px-2 pt-0.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                            {isEn ? 'Jump to Next Session' : 'Saltar para Próxima Sessão'}
                        </div>
                        <button
                            onClick={() => {
                                setGoToMenuOpen(false);
                                onJumpToTimestamp(computeNextUtcSessionTimestamp(currentReplayTimestamp || Date.now(), 8));
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 flex items-center justify-between cursor-pointer"
                        >
                            <span>{isEn ? 'London Open' : 'Abertura Londres'}</span>
                            <span className="text-[10px] font-mono text-fg-muted">08:00 UTC</span>
                        </button>
                        <button
                            onClick={() => {
                                setGoToMenuOpen(false);
                                onJumpToTimestamp(computeNextUtcSessionTimestamp(currentReplayTimestamp || Date.now(), 13));
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 flex items-center justify-between cursor-pointer"
                        >
                            <span>{isEn ? 'New York Open' : 'Abertura Nova Iorque'}</span>
                            <span className="text-[10px] font-mono text-fg-muted">13:00 UTC</span>
                        </button>
                        <button
                            onClick={() => {
                                setGoToMenuOpen(false);
                                onJumpToTimestamp(computeNextUtcSessionTimestamp(currentReplayTimestamp || Date.now(), 0));
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 flex items-center justify-between cursor-pointer"
                        >
                            <span>{isEn ? 'Asian Session' : 'Sessão Asiática'}</span>
                            <span className="text-[10px] font-mono text-fg-muted">00:00 UTC</span>
                        </button>

                        <div className={`h-px my-1.5 ${'bg-surface-2'}`} />

                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(0.4); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 cursor-pointer"
                        >
                            {isEn ? 'Session Start (40%)' : 'Início da Sessão (40%)'}
                        </button>
                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(0.65); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 cursor-pointer"
                        >
                            {isEn ? 'Mid Session (65%)' : 'Meio da Sessão (65%)'}
                        </button>
                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(0.85); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 cursor-pointer"
                        >
                            {isEn ? 'Late Session (85%)' : 'Final da Sessão (85%)'}
                        </button>
                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(1.0); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left text-accent-fg font-semibold hover:bg-accent/10 cursor-pointer"
                        >
                            {isEn ? 'Real-Time (100%)' : 'Tempo Real (100%)'}
                        </button>
                    </div>
                )}
            </div>

            {/* Quick Trade (+) */}
            <button
                onClick={onToggleTradeDrawer}
                className="p-1.5 rounded-lg text-fg-muted hover:text-accent-fg cursor-pointer"
                title={isEn ? 'Open Order Ticket (+ Trade)' : 'Abrir Boleta de Ordem (+ Trade)'}
            >
                <Plus size={16} className="border border-current rounded-full p-0.5" />
            </button>

            {/* Journal */}
            <button
                onClick={onToggleJournalDrawer}
                className="p-1.5 rounded-lg text-fg-muted hover:text-accent-fg cursor-pointer"
                title={isEn ? 'Session Journal Notes' : 'Anotações do Diário (Journal)'}
            >
                <FileText size={15} />
            </button>

            {/* Save */}
            <button
                onClick={onSaveSession}
                disabled={savingSession}
                className="p-1.5 rounded-lg text-fg-muted hover:text-accent-fg cursor-pointer"
                title={isEn ? 'Save Backtesting Session' : 'Salvar Sessão de Backtest'}
            >
                {savedSuccess ? <CheckCircle2 size={15} className="text-accent-fg" /> : <Upload size={15} />}
            </button>
        </div>
    );
});
