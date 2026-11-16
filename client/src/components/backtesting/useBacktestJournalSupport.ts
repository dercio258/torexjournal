import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import {
    getCurrentUserScope,
    listJournalEntitiesFromIDB,
    upsertJournalEntityInIDB,
} from '../../services/offlineDb';
import {
    createGeneralNoteOfflineAware,
    deleteGeneralNoteOfflineAware,
    uploadJournalImageOfflineAware,
} from '../../services/offlineMutations';
import type { ReplayOrder } from '../kline-replay/types';
import type { BacktestReplaySession } from '../../services/backtestWorkspaceStore';
import {
    DAILY_PSYCH_DIMENSIONS,
    TRADE_PSYCH_QUESTIONS,
    cleanJournalImageUrl,
    type DailyPsychCheck,
    type GeneralNoteItem,
    type JournalTradeRow,
    type TradePsychCheck,
} from '../journal/types';

const LOCAL_BACKTEST_TEMPLATES_KEY = 'torex_backtest_journal_templates_v1';

function loadLegacyLocalTemplates(): GeneralNoteItem[] {
    try {
        const raw = localStorage.getItem(LOCAL_BACKTEST_TEMPLATES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Ensures legacy plain-text notes (from `<textarea>` or Replay drawer) display cleanly inside
 * `NoteWorkspaceEditor` (`contentEditable`), while passing HTML notes untouched.
 */
export function toEditorHtml(raw?: string | null): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/<(p|div|br|ul|ol|li|strong|b|em|i|s|strike|h[1-6]|blockquote)\b/i.test(trimmed)) {
        return raw;
    }
    return escapeHtml(raw).replace(/\r?\n/g, '<br/>');
}

/**
 * Strips HTML tags and normalizes whitespace for compact single-line previews in tables & cards.
 */
export function stripHtmlPreview(raw?: string | null): string {
    if (!raw) return '';
    return raw
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

export function countAnsweredDailyQuestions(psychCheck?: DailyPsychCheck | Record<string, string | null> | null): number {
    if (!psychCheck) return 0;
    return DAILY_PSYCH_DIMENSIONS.filter((dim) => Boolean((psychCheck as Record<string, any>)[dim.key])).length;
}

export function countAnsweredTradeQuestions(psychCheck?: TradePsychCheck | ReplayOrder['psychCheck'] | null): number {
    if (!psychCheck) return 0;
    return TRADE_PSYCH_QUESTIONS.filter((q) => Boolean((psychCheck as Record<string, any>)[q.key])).length;
}

export function countRealImages(images?: string[] | null): number {
    if (!Array.isArray(images)) return 0;
    return images.filter((img) => Boolean(cleanJournalImageUrl(img))).length;
}

export function hasOrderJournalData(order: ReplayOrder): boolean {
    return Boolean(
        stripHtmlPreview(order.journalContent) ||
            countAnsweredTradeQuestions(order.psychCheck) > 0 ||
            countRealImages(order.journalImages) > 0 ||
            (order.rating && order.rating > 0) ||
            (order.setup && order.setup.trim())
    );
}

/**
 * Maps a `ReplayOrder` + `BacktestReplaySession` into `JournalTradeRow` so `NoteWorkspaceEditor`
 * (`mode="trade"`) renders the exact same rich editor, `ANTES / DEPOIS` slots, MFE/MAE, Setup, Rating,
 * and 4 sequential execution questions as `/journal`.
 */
export function mapReplayOrderToJournalTradeRow(
    order: ReplayOrder,
    session: BacktestReplaySession
): JournalTradeRow {
    const openIso = new Date(order.openedAt || Date.now()).toISOString();
    const closeIso = order.closedAt ? new Date(order.closedAt).toISOString() : null;
    const dateKey = (closeIso || openIso).slice(0, 10);
    const startCap = session.startingCapital || 100000;
    const netPnl = Number((order.pnl || 0).toFixed(2));
    const pnlPct = startCap > 0 ? Number(((netPnl / startCap) * 100).toFixed(2)) : 0;
    const screenshots = Array.isArray(order.journalImages) ? order.journalImages : [];
    const htmlContent = toEditorHtml(order.journalContent);

    const hasNote =
        Boolean(htmlContent) ||
        screenshots.length > 0 ||
        Boolean(order.setup) ||
        Boolean(order.rating) ||
        countAnsweredTradeQuestions(order.psychCheck) > 0;

    const isClosed = order.status === 'WIN' || order.status === 'LOSS';
    const entryP = Number(order.entryPrice || 0);
    const exitP = Number(order.exitPrice ?? order.entryPrice ?? 0);
    const comm = Number(order.commission || 0);

    return {
        id: order.id,
        ticket: order.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || 'RPL',
        accountId: session.id,
        accountName: session.name,
        symbol: order.symbol || session.primarySymbol || 'XAUUSD',
        side: order.side,
        status: isClosed ? 'CLOSED' : 'OPEN',
        volume: Number(order.lots || 0),
        openPrice: entryP,
        closePrice: exitP,
        avgBuy: order.side === 'BUY' ? entryP : exitP,
        avgSell: order.side === 'SELL' ? entryP : exitP,
        openTime: openIso,
        closeTime: closeIso,
        dateKey,
        grossPnl: Number((netPnl + comm).toFixed(2)),
        netPnl,
        pnlPct,
        commission: comm,
        swap: 0,
        mfe: order.mfe ?? null,
        mae: order.mae ?? null,
        setup: order.setup ?? null,
        rating: Number(order.rating || 0),
        tradeNote: hasNote
            ? {
                  id: `bt-${order.id}`,
                  tradeId: order.id,
                  content: htmlContent,
                  screenshotUrl: cleanJournalImageUrl(screenshots[0]) || null,
                  screenshots,
                  setup: order.setup ?? null,
                  mistakes: null,
                  lessons: null,
                  rating: Number(order.rating || 0),
                  psychCheck: order.psychCheck
                      ? {
                            feeling: order.psychCheck.feeling ?? null,
                            followingPlan: order.psychCheck.followingPlan ?? null,
                            entryDriver: order.psychCheck.entryDriver ?? null,
                            riskComfort: order.psychCheck.riskComfort ?? null,
                        }
                      : undefined,
              }
            : null,
    };
}

export function useBacktestJournalSupport() {
    const [customTemplates, setCustomTemplates] = useState<GeneralNoteItem[]>(() =>
        loadLegacyLocalTemplates()
    );

    useEffect(() => {
        let active = true;
        const hasAuth = Boolean(localStorage.getItem('token') || localStorage.getItem('adminToken'));
        if (!hasAuth) return;

        const userScope = getCurrentUserScope();

        const loadTemplatesFromIDB = async () => {
            const rows = await listJournalEntitiesFromIDB(userScope, 'general');
            const idbTemplates = rows
                .map((r) => r.data as GeneralNoteItem)
                .filter((d) => Boolean(d?.isTemplate));

            const legacy = loadLegacyLocalTemplates();
            if (legacy.length > 0) {
                const existingIds = new Set(idbTemplates.map((t) => String(t.id)));
                const missing = legacy.filter((t) => t?.id && !existingIds.has(String(t.id)));
                if (missing.length > 0) {
                    await Promise.all(
                        missing.map((tpl) =>
                            upsertJournalEntityInIDB(
                                userScope,
                                'general',
                                String(tpl.id),
                                { ...tpl, isTemplate: true },
                                'all'
                            )
                        )
                    );
                    idbTemplates.push(...missing);
                }
                try {
                    localStorage.removeItem(LOCAL_BACKTEST_TEMPLATES_KEY);
                } catch {
                    // ignore storage errors
                }
            }

            if (active && idbTemplates.length > 0) {
                setCustomTemplates(idbTemplates);
            }
        };

        void loadTemplatesFromIDB();

        api.get('/dashboard/journal/overview')
            .then((res) => {
                if (!active) return;
                if (Array.isArray(res.data?.templates)) {
                    setCustomTemplates(res.data.templates);
                }
            })
            .catch(() => {
                // Keep local IDB cached templates silently if offline
            });

        const handleSyncDone = () => {
            void loadTemplatesFromIDB();
        };
        window.addEventListener('torex:offline-sync-completed', handleSyncDone);

        return () => {
            active = false;
            window.removeEventListener('torex:offline-sync-completed', handleSyncDone);
        };
    }, []);

    const handleUploadImage = useCallback(async (file: File): Promise<string> => {
        return uploadJournalImageOfflineAware(file);
    }, []);

    const handleSaveTemplate = useCallback(async (title: string, content: string) => {
        const res = await createGeneralNoteOfflineAware({
            title,
            category: 'GENERAL',
            content,
            images: [],
            pinned: false,
            isTemplate: true,
        });
        if (res.data) {
            setCustomTemplates((prev) => [
                res.data,
                ...prev.filter((t) => t.id !== res.data.id),
            ]);
        }
    }, []);

    const handleDeleteTemplate = useCallback(async (templateId: string) => {
        await deleteGeneralNoteOfflineAware(templateId);
        setCustomTemplates((prev) => prev.filter((t) => t.id !== templateId));
    }, []);

    return {
        customTemplates,
        onUploadImage: handleUploadImage,
        onSaveTemplate: handleSaveTemplate,
        onDeleteTemplate: handleDeleteTemplate,
    };
}
