import React, { useState, useRef, useEffect, memo } from 'react';
import {
    Play, Pause, SkipForward, SkipBack, FastForward,
    ChevronDown, Scissors, Plus, FileText, Upload, CheckCircle2, Calendar
} from 'lucide-react';

interface FloatingReplayBarLayerProps {
    autoPlaying: boolean;
    replaySpeedLabel: string;
    syncEnabled: boolean;
    cutCandleMode: boolean;
    savingSession: boolean;
    savedSuccess: boolean;
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
    const [goToMenuOpen, setGoToMenuOpen] = useState(false);
    const [customDateTime, setCustomDateTime] = useState<string>('');
    const pillElementRef = useRef<HTMLDivElement | null>(null);
    const posRef = useRef<{ x: number; y: number }>({ x: 110, y: 245 });
    const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({
        dragging: false, startX: 0, startY: 0, origX: 110, origY: 245
    });

    // GPU-accelerated 60fps drag without triggering React re-renders
    const handleMouseDown = (e: React.MouseEvent) => {
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
            const nextX = Math.max(8, dragRef.current.origX + (e.clientX - dragRef.current.startX));
            const nextY = Math.max(8, dragRef.current.origY + (e.clientY - dragRef.current.startY));
            posRef.current = { x: nextX, y: nextY };
            pillElementRef.current.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
        };
        const onUp = () => {
            dragRef.current.dragging = false;
        };
        window.addEventListener('mousemove', onMove, { passive: true });
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

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
            style={{ transform: `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)` }}
            className={`absolute left-0 top-0 z-30 flex flex-wrap items-center gap-2 px-3 py-2 rounded-2xl border shadow-2xl backdrop-blur-md will-change-transform ${
                'bg-surface/95 border-line/90 text-fg'
            }`}
        >
            {/* Drag Grip (=) */}
            <div
                onMouseDown={handleMouseDown}
                className="cursor-grab active:cursor-grabbing px-1 text-fg-subtle hover:text-fg-muted font-bold text-sm select-none"
                title="Arrastar Barra de Replay (60 FPS)"
            >
                =
            </div>

            {/* Step Backward */}
            <button
                onClick={onStepBackward}
                className="p-1.5 rounded-lg text-fg-subtle hover:text-fg transition-colors cursor-pointer"
                title="Voltar 1 Vela (←)"
            >
                <SkipBack size={15} />
            </button>

            {/* Big Play / Pause Button */}
            <button
                onClick={onTogglePlay}
                className="w-9 h-9 rounded-xl bg-accent hover:bg-accent-hover text-accent-on flex items-center justify-center shadow-md cursor-pointer transition-transform active:scale-95 dark:bg-accent dark:hover:bg-accent-hover"
                title={autoPlaying ? 'Pausar Replay (Espaço)' : 'Iniciar Replay (Espaço)'}
            >
                {autoPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>

            {/* Step Forward */}
            <button
                onClick={onStepForward}
                className="p-1.5 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer"
                title="Avançar 1 Vela (→)"
            >
                <SkipForward size={15} />
            </button>

            {/* Fast Forward */}
            <button
                onClick={onFastForward}
                className="p-1.5 rounded-lg text-fg-subtle hover:text-fg transition-colors cursor-pointer"
                title="Avançar 5 Velas Rápido"
            >
                <FastForward size={15} />
            </button>

            <div className={`h-5 w-px mx-0.5 ${'bg-surface-3'}`} />

            {/* Speed Selector */}
            <div className="flex items-center gap-1.5 text-xs">
                <span className="text-fg-subtle font-medium">Speed</span>
                <select
                    value={replaySpeedLabel}
                    onChange={e => onChangeSpeed(e.target.value)}
                    className={`px-2 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${
                        'bg-surface-2 border-line text-fg'
                    }`}
                >
                    <option value="1m">1m</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="10x">10x</option>
                </select>
            </div>

            {/* Sync Switch */}
            <div className="flex items-center gap-1.5 text-xs">
                <span className="text-fg-subtle font-medium">Sync</span>
                <button
                    onClick={onToggleSync}
                    className={`w-8 h-4.5 rounded-full transition-colors p-0.5 cursor-pointer ${
                        syncEnabled ? 'bg-accent' : 'bg-surface-3'
                    }`}
                    title="Sincronizar Timestamp entre Timeframes e Split-Screen"
                >
                    <div className={`w-3.5 h-3.5 rounded-full bg-surface shadow transition-transform ${
                        syncEnabled ? 'translate-x-3.5' : 'translate-x-0'
                    }`} />
                </button>
            </div>

            {/* Go to Menu */}
            <div className="relative">
                <button
                    onClick={() => setGoToMenuOpen(o => !o)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                        cutCandleMode
                            ? 'bg-accent text-accent-on border-accent'
                            : 'bg-surface-2 border-line text-fg hover:bg-surface-3/70'
                    }`}
                >
                    <span>Go to</span>
                    <ChevronDown size={12} />
                </button>
                {goToMenuOpen && (
                    <div className={`absolute left-0 top-full mt-1.5 w-64 rounded-xl border shadow-2xl p-2 z-50 text-xs ${
                        'bg-surface border-line'
                    }`}>
                        <button
                            onClick={() => {
                                setGoToMenuOpen(false);
                                onActivateCutCandle();
                            }}
                            className="w-full px-2.5 py-2 rounded-lg text-left font-bold text-accent-fg hover:bg-accent/10 flex items-center gap-1.5 cursor-pointer"
                        >
                            <Scissors size={13} />
                            Escolher Vela com o Mouse
                        </button>

                        <div className={`h-px my-1.5 ${'bg-surface-2'}`} />

                        {/* Calendar Date & Time Picker */}
                        <div className="px-2 py-1 space-y-1.5">
                            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-60">
                                <Calendar size={11} /> Ir para Data / Hora Exata
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
                                    Ir
                                </button>
                            </div>
                        </div>

                        <div className={`h-px my-1.5 ${'bg-surface-2'}`} />

                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(0.4); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 cursor-pointer"
                        >
                            Início da Sessão (40%)
                        </button>
                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(0.65); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 cursor-pointer"
                        >
                            Meio da Sessão (65%)
                        </button>
                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(0.85); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-accent/10 cursor-pointer"
                        >
                            Final da Sessão (85%)
                        </button>
                        <button
                            onClick={() => { setGoToMenuOpen(false); onJumpToRatio(1.0); }}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left text-accent-fg font-semibold hover:bg-accent/10 cursor-pointer"
                        >
                            Tempo Real (100%)
                        </button>
                    </div>
                )}
            </div>

            {/* Quick Trade (+) */}
            <button
                onClick={onToggleTradeDrawer}
                className="p-1.5 rounded-lg text-fg-muted hover:text-accent-fg cursor-pointer"
                title="Abrir Boleta de Ordem (+ Trade)"
            >
                <Plus size={16} className="border border-current rounded-full p-0.5" />
            </button>

            {/* Journal */}
            <button
                onClick={onToggleJournalDrawer}
                className="p-1.5 rounded-lg text-fg-muted hover:text-accent-fg cursor-pointer"
                title="Anotações do Diário (Journal)"
            >
                <FileText size={15} />
            </button>

            {/* Save */}
            <button
                onClick={onSaveSession}
                disabled={savingSession}
                className="p-1.5 rounded-lg text-fg-muted hover:text-accent-fg cursor-pointer"
                title="Salvar Sessão de Backtest"
            >
                {savedSuccess ? <CheckCircle2 size={15} className="text-accent-fg" /> : <Upload size={15} />}
            </button>
        </div>
    );
});
