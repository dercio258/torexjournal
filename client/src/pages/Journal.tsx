import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CalendarPlus,
    Download,
    FileText,
    Image as ImageIcon,
    Pin,
    Plus,
    Search,
    Star,
    X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import {
    createGeneralNoteOfflineAware,
    deleteDailyNoteOfflineAware,
    deleteGeneralNoteOfflineAware,
    deleteTradeNoteOfflineAware,
    saveDailyNoteOfflineAware,
    saveTradeNoteOfflineAware,
    updateGeneralNoteOfflineAware,
    uploadJournalImageOfflineAware,
} from '../services/offlineMutations';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useDashboardFilters } from '../context/DashboardFilterContext';
import { useLocale } from '../context/LocaleContext';
import {
    DocumentFormat,
    exportTradingDocument,
} from '../utils/documentExporter';
import { parseTradeTimestamp, toLocalDateKey } from '../utils/timezone';
import { DailyBlockCard } from '../components/journal/DailyBlockCard';
import { extractTradeBehaviorFlags } from '../components/trades/BehaviorMlBadge';
import {
    EditorSavePayload,
    NoteWorkspaceEditor,
} from '../components/journal/NoteWorkspaceEditor';
import { DayTradesTable } from '../components/journal/DayTradesTable';
import { JournalSkeleton } from '../components/ui/Skeleton';
import {
    cleanJournalImageUrl,
    computeClientDailyMetrics,
    DailyJournalBlock,
    DailyNotePayload,
    formatJournalBlockDate,
    formatSignedCurrency,
    GENERAL_CATEGORY_META,
    GeneralNoteCategory,
    GeneralNoteItem,
    JournalTab,
    JournalTradeRow,
    parseJournalImages,
    stripHtmlPreview,
    TRADE_PSYCH_QUESTIONS,
} from '../components/journal/types';

const FALLBACK_STORAGE_KEY = 'torex_journal_fallback_v2';

interface FallbackStore {
    dailyNotes: Record<string, DailyNotePayload>;
    tradeNotes: Record<
        string,
        {
            content: string;
            screenshots: string[];
            setup: string | null;
            rating: number;
            mfe: number | null;
            mae: number | null;
        }
    >;
    generalNotes: GeneralNoteItem[];
    templates: GeneralNoteItem[];
}

function loadFallbackStore(): FallbackStore {
    try {
        const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                dailyNotes: parsed.dailyNotes || {},
                tradeNotes: parsed.tradeNotes || {},
                generalNotes: Array.isArray(parsed.generalNotes) ? parsed.generalNotes : [],
                templates: Array.isArray(parsed.templates) ? parsed.templates : [],
            };
        }
    } catch {
        // ignore storage errors
    }
    return {
        dailyNotes: {},
        tradeNotes: {},
        generalNotes: [],
        templates: [],
    };
}

function saveFallbackStore(store: FallbackStore) {
    try {
        localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(store));
    } catch {
        // ignore quota errors
    }
}

function fileToDataUrl(file: File, isEn = false): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(isEn ? 'Failed to read image' : 'Falha ao ler imagem'));
        reader.readAsDataURL(file);
    });
}

export const Journal: React.FC = () => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { token } = useAuth();
    const { selectedAccountId, selectedAccount } = useAccount();
    const { queryDates, filters, setAvailableSymbols } = useDashboardFilters();
    const lastSavePromiseRef = useRef<Promise<void> | null>(null);

    const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

    const [activeTab, setActiveTab] = useState<JournalTab>('daily');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [tradeListFilter, setTradeListFilter] = useState<'all' | 'annotated'>('all');
    const [generalCatFilter, setGeneralCatFilter] = useState<'ALL' | GeneralNoteCategory>('ALL');

    const [dailyBlocks, setDailyBlocks] = useState<DailyJournalBlock[]>([]);
    const [generalNotes, setGeneralNotes] = useState<GeneralNoteItem[]>([]);
    const [customTemplates, setCustomTemplates] = useState<GeneralNoteItem[]>([]);

    const [selectedDate, setSelectedDate] = useState<string>(todayKey);
    const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
    const [selectedGeneralId, setSelectedGeneralId] = useState<string | null>(null);

    const [showNewDatePicker, setShowNewDatePicker] = useState<boolean>(false);
    const [newNoteDate, setNewNoteDate] = useState<string>(todayKey);

    const [loading, setLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [usingFallbackApi, setUsingFallbackApi] = useState<boolean>(false);

    const buildFallbackOverview = useCallback(
        async (params: Record<string, string>) => {
            const store = loadFallbackStore();
            const res = await api.get('/dashboard/trades', { params });
            const rawTrades: any[] = Array.isArray(res.data) ? res.data : [];

            const normalizedTrades: JournalTradeRow[] = rawTrades.map((t: any) => {
                const refTime = t.closeTime || t.openTime || new Date().toISOString();
                const dateKey = toLocalDateKey(refTime) || new Date(refTime).toISOString().slice(0, 10);
                const parsedOpenObj = parseTradeTimestamp(t.openTime);
                const parsedCloseObj = parseTradeTimestamp(t.closeTime);
                const upperType = String(t.type || 'BUY').toUpperCase();
                const side: 'BUY' | 'SELL' =
                    upperType.includes('SELL') || upperType.includes('PUT')
                        ? 'SELL'
                        : 'BUY';
                const gross = Number(t.profit) || 0;
                const comm = Math.abs(Number(t.commission) || 0);
                const swap = Number(t.swap) || 0;
                const net =
                    t.netPnl !== undefined && t.netPnl !== null
                        ? Number(t.netPnl)
                        : gross - comm + swap;
                const openPrice = Number(t.openPrice) || 0;
                const closePrice = Number(t.closePrice) || 0;
                const pctMove =
                    openPrice > 0
                        ? Number(
                              (
                                  ((side === 'BUY'
                                      ? closePrice - openPrice
                                      : openPrice - closePrice) /
                                      openPrice) *
                                  100
                              ).toFixed(2)
                          )
                        : null;

                const id = String(t.id || t.ticket);
                const savedTn = store.tradeNotes[id];
                const { behavioralMl, behavioralFeedback } = extractTradeBehaviorFlags(t);

                return {
                    id,
                    ticket: String(t.ticket || id.slice(0, 8)),
                    accountId: String(t.accountId || ''),
                    accountName: String(t.accountName || (isEn ? 'Account' : 'Conta')),
                    symbol: String(t.symbol || (isEn ? 'ASSET' : 'ATIVO')),
                    side,
                    status: 'CLOSED',
                    openTime: parsedOpenObj ? parsedOpenObj.toISOString() : null,
                    closeTime: parsedCloseObj ? parsedCloseObj.toISOString() : null,
                    dateKey,
                    openPrice,
                    closePrice,
                    avgBuy: side === 'BUY' ? openPrice : closePrice,
                    avgSell: side === 'SELL' ? openPrice : closePrice,
                    volume: Number(t.volume) || 0,
                    grossPnl: Number(gross.toFixed(2)),
                    netPnl: Number(net.toFixed(2)),
                    pnlPct: pctMove,
                    commission: Number(comm.toFixed(2)),
                    swap: Number(swap.toFixed(2)),
                    mfe:
                        savedTn?.mfe ??
                        (t.mfe !== undefined && t.mfe !== null ? Number(t.mfe) : null),
                    mae:
                        savedTn?.mae ??
                        (t.mae !== undefined && t.mae !== null ? Number(t.mae) : null),
                    setup: savedTn?.setup ?? t.setup ?? null,
                    rating: savedTn?.rating ?? Number(t.rating || 0),
                    behavioralMl,
                    behavioralFeedback,
                    tradeNote: savedTn
                        ? {
                              id: `local-${id}`,
                              tradeId: id,
                              content: savedTn.content,
                              screenshotUrl: savedTn.screenshots[0] || null,
                              screenshots: savedTn.screenshots,
                              setup: savedTn.setup,
                              mistakes: null,
                              lessons: null,
                              rating: savedTn.rating,
                          }
                        : t.lesson
                        ? {
                              id: null,
                              tradeId: id,
                              content: `<p>${t.lesson}</p>`,
                              screenshotUrl: null,
                              screenshots: [],
                              setup: t.setup || null,
                              mistakes: null,
                              lessons: t.lesson,
                              rating: Number(t.rating || 0),
                          }
                        : null,
                };
            });

            const dateSet = new Set<string>();
            normalizedTrades.forEach((tr) => dateSet.add(tr.dateKey));
            Object.keys(store.dailyNotes).forEach((d) => dateSet.add(d));
            if (dateSet.size === 0) dateSet.add(todayKey);

            const sortedDates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
            const blocks: DailyJournalBlock[] = sortedDates.map((d) => {
                const dayTrades = normalizedTrades.filter((tr) => tr.dateKey === d);
                return {
                    date: d,
                    metrics: computeClientDailyMetrics(dayTrades),
                    note: store.dailyNotes[d] || null,
                    trades: dayTrades,
                };
            });

            return {
                dailyBlocks: blocks,
                generalNotes: store.generalNotes,
                templates: store.templates,
            };
        },
        [todayKey]
    );

    const fetchJournalOverview = useCallback(
        async (silent = false) => {
            if (!token) return;
            if (!silent) setLoading(true);

            const params: Record<string, string> = {};
            if (selectedAccountId) params.accountId = selectedAccountId;
            if (queryDates.start) params.startDate = queryDates.start;
            if (queryDates.end) params.endDate = queryDates.end;

            try {
                const res = await api.get('/dashboard/journal/overview', { params });
                setUsingFallbackApi(false);

                const blocks: DailyJournalBlock[] = Array.isArray(res.data?.dailyBlocks)
                    ? res.data.dailyBlocks
                    : [];
                const gNotes: GeneralNoteItem[] = Array.isArray(res.data?.generalNotes)
                    ? res.data.generalNotes
                    : [];
                const tpls: GeneralNoteItem[] = Array.isArray(res.data?.templates)
                    ? res.data.templates
                    : [];

                setDailyBlocks(blocks);
                setGeneralNotes(gNotes);
                setCustomTemplates(tpls);

                // Alimentar símbolos disponíveis para o Header
                const symSet = new Set<string>();
                blocks.forEach((b) => b.trades.forEach((t) => t.symbol && symSet.add(t.symbol)));
                if (symSet.size > 0) {
                    setAvailableSymbols(Array.from(symSet).sort());
                }

                setSelectedDate((prev) => {
                    if (blocks.some((b) => b.date === prev)) return prev;
                    return blocks[0]?.date || todayKey;
                });

                if (gNotes.length > 0) {
                    setSelectedGeneralId((prev) =>
                        prev && gNotes.some((g) => g.id === prev) ? prev : gNotes[0].id
                    );
                }
            } catch (err: any) {
                if (err?.response?.status === 404) {
                    setUsingFallbackApi(true);
                    const fb = await buildFallbackOverview(params);
                    setDailyBlocks(fb.dailyBlocks);
                    setGeneralNotes(fb.generalNotes);
                    setCustomTemplates(fb.templates);
                    setSelectedDate((prev) =>
                        fb.dailyBlocks.some((b) => b.date === prev)
                            ? prev
                            : fb.dailyBlocks[0]?.date || todayKey
                    );
                } else {
                    console.error('Erro ao carregar /journal:', err);
                }
            } finally {
                if (!silent) setLoading(false);
            }
        },
        [
            token,
            selectedAccountId,
            queryDates.start,
            queryDates.end,
            setAvailableSymbols,
            todayKey,
            buildFallbackOverview,
        ]
    );

    useEffect(() => {
        void fetchJournalOverview();
    }, [fetchJournalOverview]);

    useEffect(() => {
        const onSynced = () => {
            void fetchJournalOverview(true);
        };
        window.addEventListener('torex:offline-sync-completed', onSynced);
        return () => window.removeEventListener('torex:offline-sync-completed', onSynced);
    }, [fetchJournalOverview]);

    // Aplicar filtros operacionais globais do Header (Ativo, Direção, Resultado)
    const filteredDailyBlocks = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();

        return dailyBlocks
            .map((block) => {
                const filteredTrades = block.trades.filter((t) => {
                    if (
                        filters.symbols.length > 0 &&
                        !filters.symbols.includes(t.symbol)
                    ) {
                        return false;
                    }
                    if (filters.side !== 'ALL') {
                        if (filters.side === 'BUY' && t.side !== 'BUY') return false;
                        if (filters.side === 'SELL' && t.side !== 'SELL') return false;
                    }
                    if (filters.outcome !== 'ALL') {
                        if (filters.outcome === 'WIN' && t.netPnl <= 0.004) return false;
                        if (filters.outcome === 'LOSS' && t.netPnl >= -0.004) return false;
                        if (
                            filters.outcome === 'BE' &&
                            Math.abs(t.netPnl) > 0.004
                        ) {
                            return false;
                        }
                    }
                    return true;
                });

                const hasOperationalFilter =
                    filters.symbols.length > 0 ||
                    filters.side !== 'ALL' ||
                    filters.outcome !== 'ALL';

                const nextBlock: DailyJournalBlock = hasOperationalFilter
                    ? {
                          ...block,
                          trades: filteredTrades,
                          metrics: computeClientDailyMetrics(filteredTrades),
                      }
                    : block;

                return nextBlock;
            })
            .filter((block) => {
                const hasAnyOperationalFilter =
                    filters.symbols.length > 0 ||
                    filters.side !== 'ALL' ||
                    filters.outcome !== 'ALL';
                if (
                    hasAnyOperationalFilter &&
                    block.trades.length === 0 &&
                    !block.note?.content
                ) {
                    return false;
                }

                if (!q) return true;
                const matchDate =
                    block.date.includes(q) ||
                    formatJournalBlockDate(block.date).toLowerCase().includes(q);
                const matchNote = (block.note?.content || '')
                    .toLowerCase()
                    .includes(q);
                const matchSymbol = block.trades.some(
                    (t) =>
                        t.symbol.toLowerCase().includes(q) ||
                        t.ticket.toLowerCase().includes(q)
                );
                return matchDate || matchNote || matchSymbol;
            });
    }, [dailyBlocks, filters.symbols, filters.side, filters.outcome, searchQuery]);

    // Lista achatada de todos os trades filtrados para a aba Trade Notes
    const allFilteredTrades = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const list: JournalTradeRow[] = [];
        filteredDailyBlocks.forEach((b) => {
            b.trades.forEach((t) => {
                const hasTradePsych = Boolean(
                    t.tradeNote?.psychCheck &&
                        Object.values(t.tradeNote.psychCheck).some(Boolean)
                );
                const hasNote =
                    Boolean(stripHtmlPreview(t.tradeNote?.content, 10)) ||
                    (t.tradeNote?.screenshots?.length ?? 0) > 0 ||
                    hasTradePsych;
                if (tradeListFilter === 'annotated' && !hasNote) return;
                if (q) {
                    const match =
                        t.symbol.toLowerCase().includes(q) ||
                        t.ticket.toLowerCase().includes(q) ||
                        (t.setup || '').toLowerCase().includes(q) ||
                        (t.tradeNote?.content || '').toLowerCase().includes(q);
                    if (!match) return;
                }
                list.push(t);
            });
        });
        return list;
    }, [filteredDailyBlocks, tradeListFilter, searchQuery]);

    // Notas Gerais filtradas
    const filteredGeneralNotes = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return generalNotes.filter((n) => {
            if (generalCatFilter !== 'ALL' && n.category !== generalCatFilter) {
                return false;
            }
            if (!q) return true;
            return (
                n.title.toLowerCase().includes(q) ||
                n.content.toLowerCase().includes(q)
            );
        });
    }, [generalNotes, generalCatFilter, searchQuery]);

    // Bloco Diário Ativo
    const activeDailyBlock: DailyJournalBlock = useMemo(() => {
        const found = dailyBlocks.find((b) => b.date === selectedDate);
        if (found) return found;
        return {
            date: selectedDate,
            metrics: computeClientDailyMetrics([]),
            note: null,
            trades: [],
        };
    }, [dailyBlocks, selectedDate]);

    // Trade Selecionado
    const selectedTrade: JournalTradeRow | null = useMemo(() => {
        if (!selectedTradeId) return allFilteredTrades[0] || null;
        for (const b of dailyBlocks) {
            const found = b.trades.find((t) => t.id === selectedTradeId);
            if (found) return found;
        }
        return allFilteredTrades[0] || null;
    }, [dailyBlocks, selectedTradeId, allFilteredTrades]);

    // Nota Geral Selecionada
    const selectedGeneralNote: GeneralNoteItem | null = useMemo(() => {
        if (generalNotes.length === 0) return null;
        if (selectedGeneralId) {
            const found = generalNotes.find((g) => g.id === selectedGeneralId);
            if (found) return found;
        }
        return generalNotes[0] || null;
    }, [generalNotes, selectedGeneralId]);

    // Ação rápida "+ New Note"
    const handleQuickNewNote = async () => {
        if (activeTab === 'daily') {
            setNewNoteDate(todayKey);
            setShowNewDatePicker((prev) => !prev);
            return;
        }

        if (activeTab === 'trade') {
            setTradeListFilter('all');
            if (allFilteredTrades.length > 0) {
                const candidate =
                    allFilteredTrades.find(
                        (t) => !stripHtmlPreview(t.tradeNote?.content, 5)
                    ) || allFilteredTrades[0];
                setSelectedTradeId(candidate.id);
                setSelectedDate(candidate.dateKey);
            }
            return;
        }

        // Aba General: criar nova nota geral imediatamente
        setIsSaving(true);
        try {
            if (usingFallbackApi) {
                const store = loadFallbackStore();
                const created: GeneralNoteItem = {
                    id: `local-gen-${Date.now()}`,
                    title: isEn ? 'New Playbook Note' : 'Nova Nota do Plano',
                    category: generalCatFilter === 'ALL' ? 'PLAYBOOK' : generalCatFilter,
                    content: '',
                    images: [],
                    pinned: false,
                    isTemplate: false,
                    updatedAt: new Date().toISOString(),
                };
                store.generalNotes = [created, ...store.generalNotes];
                saveFallbackStore(store);
                setGeneralNotes(store.generalNotes);
                setSelectedGeneralId(created.id);
            } else {
                const res = await createGeneralNoteOfflineAware({
                    title: isEn ? 'New Playbook Note' : 'Nova Nota do Plano',
                    category: generalCatFilter === 'ALL' ? 'PLAYBOOK' : generalCatFilter,
                    content: '',
                    images: [],
                    pinned: false,
                    isTemplate: false,
                });
                const created: GeneralNoteItem = res.data;
                setGeneralNotes((prev) => [created, ...prev]);
                setSelectedGeneralId(created.id);
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleConfirmNewDateBlock = () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newNoteDate)) return;
        setDailyBlocks((prev) => {
            if (prev.some((b) => b.date === newNoteDate)) return prev;
            const createdBlock: DailyJournalBlock = {
                date: newNoteDate,
                metrics: computeClientDailyMetrics([]),
                note: null,
                trades: [],
            };
            return [...prev, createdBlock].sort((a, b) => b.date.localeCompare(a.date));
        });
        setSelectedDate(newNoteDate);
        setActiveTab('daily');
        setShowNewDatePicker(false);
    };

    // Persistência unificada do Editor (suporta flush seguro ao trocar de aba/item)
    const handleSaveEditor = async (payload: EditorSavePayload) => {
        const modeToSave = payload.targetMode ?? activeTab;
        const dateToSave = payload.targetDate ?? selectedDate;
        const tradeIdToSave = payload.targetTradeId ?? selectedTrade?.id ?? null;
        const generalIdToSave = payload.targetGeneralId ?? selectedGeneralNote?.id ?? null;

        const saveExecution = (async () => {
            setIsSaving(true);
            try {
                if (modeToSave === 'daily') {
                    if (usingFallbackApi) {
                        const store = loadFallbackStore();
                        const savedNote: DailyNotePayload = {
                            id: `local-daily-${dateToSave}`,
                            date: dateToSave,
                            title: payload.title || null,
                            content: payload.content,
                            mood: payload.mood || null,
                            marketBias: payload.marketBias || null,
                            psychCheck: payload.psychCheck || {},
                            images: payload.images,
                            updatedAt: new Date().toISOString(),
                        };
                        store.dailyNotes[dateToSave] = savedNote;
                        saveFallbackStore(store);
                        setDailyBlocks((prev) =>
                            prev.map((b) =>
                                b.date === dateToSave ? { ...b, note: savedNote } : b
                            )
                        );
                    } else {
                        const res = await saveDailyNoteOfflineAware(
                            dateToSave,
                            {
                                title: payload.title,
                                content: payload.content,
                                mood: payload.mood,
                                marketBias: payload.marketBias,
                                psychCheck: payload.psychCheck,
                                images: payload.images,
                            },
                            selectedAccountId
                        );
                        const updated = res.data;
                        setDailyBlocks((prev) => {
                            const exists = prev.some((b) => b.date === dateToSave);
                            const noteObj: DailyNotePayload = {
                                id: updated.id,
                                date: dateToSave,
                                title: updated.title,
                                content: updated.content,
                                mood: updated.mood,
                                marketBias: updated.marketBias,
                                psychCheck: updated.psychCheck || payload.psychCheck || {},
                                images: Array.isArray(updated.images) ? updated.images : [],
                                updatedAt: updated.updatedAt,
                            };
                            if (!exists) {
                                return [
                                    {
                                        date: dateToSave,
                                        metrics: computeClientDailyMetrics([]),
                                        note: noteObj,
                                        trades: [],
                                    },
                                    ...prev,
                                ].sort((a, b) => b.date.localeCompare(a.date));
                            }
                            return prev.map((b) =>
                                b.date === dateToSave ? { ...b, note: noteObj } : b
                            );
                        });
                    }
                    return;
                }

                if (modeToSave === 'trade' && tradeIdToSave) {
                    if (usingFallbackApi) {
                        const store = loadFallbackStore();
                        store.tradeNotes[tradeIdToSave] = {
                            content: payload.content,
                            screenshots: payload.images,
                            setup: payload.setup || null,
                            rating: payload.rating || 0,
                            mfe: payload.mfe ?? null,
                            mae: payload.mae ?? null,
                        };
                        saveFallbackStore(store);
                    } else {
                        await saveTradeNoteOfflineAware(tradeIdToSave, {
                            content: payload.content,
                            screenshotUrl: cleanJournalImageUrl(payload.images[0]) || null,
                            screenshots: payload.images,
                            setup: payload.setup,
                            rating: payload.rating,
                            psychCheck: payload.tradePsychCheck,
                            mfe: payload.mfe,
                            mae: payload.mae,
                        });
                    }

                    // Atualiza trade e recalcula métricas diárias (MFE/MAE) imediatamente na UI
                    setDailyBlocks((prev) =>
                        prev.map((block) => {
                            if (!block.trades.some((t) => t.id === tradeIdToSave)) {
                                return block;
                            }
                            const nextTrades = block.trades.map((t) =>
                                t.id === tradeIdToSave
                                    ? {
                                          ...t,
                                          mfe: payload.mfe ?? null,
                                          mae: payload.mae ?? null,
                                          setup: payload.setup ?? null,
                                          rating: payload.rating ?? 0,
                                          tradeNote: {
                                              id: t.tradeNote?.id || 'saved',
                                              tradeId: t.id,
                                              content: payload.content,
                                              screenshotUrl:
                                                  cleanJournalImageUrl(payload.images[0]) || null,
                                              screenshots: payload.images,
                                              setup: payload.setup ?? null,
                                              mistakes: t.tradeNote?.mistakes ?? null,
                                              lessons: t.tradeNote?.lessons ?? null,
                                              rating: payload.rating ?? 0,
                                              psychCheck:
                                                  payload.tradePsychCheck ||
                                                  t.tradeNote?.psychCheck ||
                                                  {},
                                              updatedAt: new Date().toISOString(),
                                          },
                                      }
                                    : t
                            );
                            return {
                                ...block,
                                trades: nextTrades,
                                metrics: computeClientDailyMetrics(nextTrades),
                            };
                        })
                    );
                    return;
                }

                if (modeToSave === 'general') {
                    const targetGeneral =
                        generalNotes.find((g) => g.id === generalIdToSave) ||
                        selectedGeneralNote;
                    if (!targetGeneral) {
                        await handleQuickNewNote();
                        return;
                    }
                    if (usingFallbackApi) {
                        const store = loadFallbackStore();
                        store.generalNotes = store.generalNotes.map((g) =>
                            g.id === targetGeneral.id
                                ? {
                                      ...g,
                                      title: payload.title || g.title,
                                      category: payload.category || g.category,
                                      pinned: Boolean(payload.pinned),
                                      content: payload.content,
                                      images: payload.images,
                                      updatedAt: new Date().toISOString(),
                                  }
                                : g
                        );
                        saveFallbackStore(store);
                        setGeneralNotes(store.generalNotes);
                    } else {
                        const res = await updateGeneralNoteOfflineAware(targetGeneral.id, {
                            title: payload.title || targetGeneral.title,
                            category: payload.category || targetGeneral.category,
                            pinned: payload.pinned,
                            content: payload.content,
                            images: payload.images,
                        });
                        const updated: GeneralNoteItem = {
                            ...targetGeneral,
                            ...res.data,
                            id: targetGeneral.id,
                        };
                        setGeneralNotes((prev) =>
                            prev
                                .map((g) => (g.id === updated.id ? updated : g))
                                .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                        );
                    }
                }
            } catch (err) {
                console.error('[Journal] Falha ao salvar dados do diário:', err);
            } finally {
                setIsSaving(false);
            }
        })();

        lastSavePromiseRef.current = saveExecution;
        await saveExecution;
    };

    const handleOpenTradeDetails = useCallback(
        async (tradeId: string) => {
            if (lastSavePromiseRef.current) {
                try {
                    await lastSavePromiseRef.current;
                } catch {
                    // ignore navigation blocking on network failure
                }
            }
            navigate(`/trades/${tradeId}`);
        },
        [navigate]
    );

    const handleDeleteCurrentNote = async () => {
        setIsSaving(true);
        try {
            if (activeTab === 'daily') {
                if (usingFallbackApi) {
                    const store = loadFallbackStore();
                    delete store.dailyNotes[selectedDate];
                    saveFallbackStore(store);
                } else {
                    await deleteDailyNoteOfflineAware(selectedDate, selectedAccountId);
                }
                setDailyBlocks((prev) =>
                    prev.map((b) => (b.date === selectedDate ? { ...b, note: null } : b))
                );
                return;
            }

            if (activeTab === 'trade' && selectedTrade) {
                if (usingFallbackApi) {
                    const store = loadFallbackStore();
                    delete store.tradeNotes[selectedTrade.id];
                    saveFallbackStore(store);
                } else {
                    await deleteTradeNoteOfflineAware(selectedTrade.id);
                }
                setDailyBlocks((prev) =>
                    prev.map((b) => ({
                        ...b,
                        trades: b.trades.map((t) =>
                            t.id === selectedTrade.id ? { ...t, tradeNote: null } : t
                        ),
                    }))
                );
                return;
            }

            if (activeTab === 'general' && selectedGeneralNote) {
                if (usingFallbackApi) {
                    const store = loadFallbackStore();
                    store.generalNotes = store.generalNotes.filter(
                        (g) => g.id !== selectedGeneralNote.id
                    );
                    saveFallbackStore(store);
                    setGeneralNotes(store.generalNotes);
                    setSelectedGeneralId(store.generalNotes[0]?.id || null);
                } else {
                    await deleteGeneralNoteOfflineAware(selectedGeneralNote.id);
                    setGeneralNotes((prev) => {
                        const rest = prev.filter((g) => g.id !== selectedGeneralNote.id);
                        setSelectedGeneralId(rest[0]?.id || null);
                        return rest;
                    });
                }
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleUploadImage = async (file: File): Promise<string> => {
        if (usingFallbackApi) {
            return fileToDataUrl(file);
        }
        try {
            return await uploadJournalImageOfflineAware(file);
        } catch {
            return fileToDataUrl(file);
        }
    };

    const handleSaveTemplate = async (title: string, content: string) => {
        if (usingFallbackApi) {
            const store = loadFallbackStore();
            const created: GeneralNoteItem = {
                id: `local-tpl-${Date.now()}`,
                title,
                category: 'GENERAL',
                content,
                images: [],
                pinned: false,
                isTemplate: true,
                updatedAt: new Date().toISOString(),
            };
            store.templates = [created, ...store.templates];
            saveFallbackStore(store);
            setCustomTemplates(store.templates);
            return;
        }
        const res = await createGeneralNoteOfflineAware({
            title,
            category: 'GENERAL',
            content,
            images: [],
            pinned: false,
            isTemplate: true,
        });
        setCustomTemplates((prev) => [res.data, ...prev]);
    };

    const handleDeleteTemplate = async (templateId: string) => {
        if (usingFallbackApi) {
            const store = loadFallbackStore();
            store.templates = store.templates.filter((t) => t.id !== templateId);
            saveFallbackStore(store);
            setCustomTemplates(store.templates);
            return;
        }
        await deleteGeneralNoteOfflineAware(templateId);
        setCustomTemplates((prev) => prev.filter((t) => t.id !== templateId));
    };

    // Propriedades ativas injetadas no NoteWorkspaceEditor
    const editorConfig = useMemo(() => {
        if (activeTab === 'daily') {
            return {
                activeKey: `daily:${selectedDate}:${activeDailyBlock.note?.id || 'draft'}`,
                initialTitle: activeDailyBlock.note?.title || '',
                initialCategory: 'GENERAL' as GeneralNoteCategory,
                initialPinned: false,
                initialContent: activeDailyBlock.note?.content || '',
                initialMood: activeDailyBlock.note?.mood || null,
                initialMarketBias: activeDailyBlock.note?.marketBias || null,
                initialPsychCheck: activeDailyBlock.note?.psychCheck || {},
                initialImages: activeDailyBlock.note?.images || [],
            };
        }

        if (activeTab === 'trade') {
            const tn = selectedTrade?.tradeNote;
            const shots =
                tn?.screenshots && tn.screenshots.length > 0
                    ? tn.screenshots
                    : tn?.screenshotUrl
                    ? [tn.screenshotUrl]
                    : [];
            return {
                activeKey: `trade:${selectedTrade?.id || 'none'}`,
                initialTitle: selectedTrade ? `#${selectedTrade.ticket}` : '',
                initialCategory: 'GENERAL' as GeneralNoteCategory,
                initialPinned: false,
                initialContent: tn?.content || '',
                initialMood: null,
                initialMarketBias: null,
                initialPsychCheck: {},
                initialImages: shots,
            };
        }

        return {
            activeKey: `general:${selectedGeneralNote?.id || 'empty'}`,
            initialTitle: selectedGeneralNote?.title || (isEn ? 'Trading Plan' : 'Plano Operacional'),
            initialCategory:
                (selectedGeneralNote?.category as GeneralNoteCategory) || 'PLAYBOOK',
            initialPinned: Boolean(selectedGeneralNote?.pinned),
            initialContent: selectedGeneralNote?.content || '',
            initialMood: null,
            initialMarketBias: null,
            initialPsychCheck: {},
            initialImages: selectedGeneralNote?.images || [],
        };
    }, [activeTab, selectedDate, activeDailyBlock, selectedTrade, selectedGeneralNote]);

    const bottomTableDate =
        activeTab === 'trade' && selectedTrade ? selectedTrade.dateKey : selectedDate;
    const bottomTableBlock = useMemo(() => {
        return filteredDailyBlocks.find((b) => b.date === bottomTableDate) || null;
    }, [filteredDailyBlocks, bottomTableDate]);
    const bottomTableTrades = useMemo(() => {
        return bottomTableBlock ? bottomTableBlock.trades : [];
    }, [bottomTableBlock]);

    const handleExportJournalTrades = useCallback(
        (format: DocumentFormat, scope: 'day' | 'all' = 'day') => {
            const blocksToExport =
                scope === 'day' && bottomTableBlock
                    ? [bottomTableBlock]
                    : filteredDailyBlocks;

            const enrichedExportRows: any[] = [];
            for (const block of blocksToExport) {
                const dn = block.note;
                const dailyPlainText = dn ? stripHtmlPreview(dn.content).trim() : '';
                const dailyPsychParts: string[] = [];
                if (dn?.mood) dailyPsychParts.push(`${isEn ? 'Mood' : 'Humor'}: ${dn.mood}`);
                if (dn?.psychCheck?.focus) dailyPsychParts.push(`${isEn ? 'Focus' : 'Foco'}: ${dn.psychCheck.focus}`);
                if (dn?.psychCheck?.stress) dailyPsychParts.push(`${isEn ? 'Stress' : 'Estresse'}: ${dn.psychCheck.stress}`);
                if (dn?.psychCheck?.energy) dailyPsychParts.push(`${isEn ? 'Energy' : 'Energia'}: ${dn.psychCheck.energy}`);
                const dailySentimentStr = dailyPsychParts.join(' | ');

                if (block.trades.length === 0 && dn && (dailyPlainText || dn.marketBias || dailySentimentStr)) {
                    // Caso o dia tenha anotação diária mas nenhuma operação, ainda exporta o registro de diário do dia
                    enrichedExportRows.push({
                        ticket: `${isEn ? 'DAILY' : 'DIARIO'}-${block.date}`,
                        openTime: `${block.date}T00:00:00.000Z`,
                        closeTime: `${block.date}T23:59:59.000Z`,
                        type: dn.marketBias || (isEn ? 'DAILY LOG' : 'DIARIO'),
                        volume: 0,
                        symbol: dn.title || (isEn ? 'DAILY SESSION LOG' : 'DIÁRIO DO DIA'),
                        openPrice: 0,
                        closePrice: 0,
                        sl: 0,
                        tp: 0,
                        commission: 0,
                        swap: 0,
                        profit: 0,
                        netPnl: 0,
                        session: isEn ? 'Daily Log' : 'Diário',
                        accountName: selectedAccount?.name || (isEn ? 'Consolidated' : 'Consolidado'),
                        setup: dn.title || '',
                        marketBias: dn.marketBias || '',
                        mood: dn.mood || '',
                        sentimentSummary: dailySentimentStr || dn.mood || '',
                        rating: 0,
                        mfe: null,
                        mae: null,
                        annotationSource: 'daily',
                        journalNotes: dailyPlainText,
                        screenshots: dn.images || [],
                    });
                    continue;
                }

                for (const tr of block.trades) {
                    const tn = tr.tradeNote;
                    const tradePlainText = tn ? stripHtmlPreview(tn.content).trim() : '';
                    const hasOwnTradeNote = Boolean(
                        tradePlainText || tn?.lessons || tn?.mistakes
                    );

                    const tradePsychParts: string[] = [];
                    if (tn?.psychCheck?.feeling) {
                        tradePsychParts.push(`${isEn ? 'Mindset' : 'Sentimento'}: ${tn.psychCheck.feeling}`);
                    }
                    if (tn?.psychCheck?.followingPlan) {
                        tradePsychParts.push(`${isEn ? 'Plan' : 'Plano'}: ${tn.psychCheck.followingPlan}`);
                    }
                    if (tn?.psychCheck?.entryDriver) {
                        tradePsychParts.push(`${isEn ? 'Trigger' : 'Gatilho'}: ${tn.psychCheck.entryDriver}`);
                    }
                    if (tn?.psychCheck?.riskComfort) {
                        tradePsychParts.push(`${isEn ? 'Risk OK' : 'Risco OK'}: ${tn.psychCheck.riskComfort}`);
                    }
                    const tradeSentimentStr = tradePsychParts.join(' | ');

                    const effectiveNotes = hasOwnTradeNote
                        ? [tradePlainText, tn?.lessons, tn?.mistakes]
                              .filter(Boolean)
                              .join(' — ')
                        : dailyPlainText;
                    const effectiveSentiment =
                        tradeSentimentStr || dailySentimentStr || dn?.mood || '';
                    const effectiveSource = hasOwnTradeNote
                        ? 'trade'
                        : dailyPlainText || dailySentimentStr || dn?.marketBias
                        ? 'daily'
                        : 'none';

                    enrichedExportRows.push({
                        id: tr.id,
                        ticket: tr.ticket,
                        openTime: tr.openTime,
                        closeTime: tr.closeTime,
                        type: tr.side,
                        volume: tr.volume,
                        symbol: tr.symbol,
                        openPrice: tr.openPrice,
                        closePrice: tr.closePrice,
                        sl: 0,
                        tp: 0,
                        commission: -Math.abs(Number(tr.commission) || 0),
                        swap: tr.swap,
                        profit: tr.grossPnl,
                        netPnl: tr.netPnl,
                        session: '',
                        accountName: tr.accountName || selectedAccount?.name || (isEn ? 'Account' : 'Conta'),
                        setup: tr.setup || tn?.setup || dn?.title || '',
                        marketBias: dn?.marketBias || '',
                        mood: tn?.psychCheck?.feeling || dn?.mood || '',
                        sentimentSummary: effectiveSentiment,
                        rating: tr.rating || tn?.rating || 0,
                        mfe: tr.mfe,
                        mae: tr.mae,
                        annotationSource: effectiveSource,
                        journalNotes: effectiveNotes,
                        screenshots:
                            tn?.screenshots && tn.screenshots.length > 0
                                ? tn.screenshots
                                : dn?.images || [],
                    });
                }
            }

            exportTradingDocument(format, {
                accountName: selectedAccount?.name || (isEn ? 'Consolidated (Journal)' : 'Consolidado (Diário)'),
                accountType: selectedAccount?.type || 'TRADING',
                broker: selectedAccount?.broker || 'MetaTrader 5',
                currency: selectedAccount?.currency || 'USD',
                periodLabel:
                    scope === 'day' && bottomTableDate
                        ? `${isEn ? 'Journal' : 'Diário'} ${formatJournalBlockDate(bottomTableDate)}`
                        : (isEn ? 'Full Filtered Journal' : 'Diário Completo Filtrado'),
                trades: enrichedExportRows,
            });
        },
        [bottomTableBlock, bottomTableDate, filteredDailyBlocks, selectedAccount, isEn]
    );

    if (loading) {
        return <JournalSkeleton />;
    }

    return (
        <div className="w-full pb-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* =========================================================
                    COLUNA ESQUERDA: Abas + "+ New Note" + Blocos Cronológicos
                   ========================================================= */}
                <aside className="lg:col-span-4 xl:col-span-3 space-y-3">
                    {/* Abas Daily Notes | Trade Notes | General */}
                    <div className="bg-surface border border-line rounded-xl p-1 grid grid-cols-3 gap-1">
                        {(
                            [
                                { id: 'daily', label: 'Daily Notes' },
                                { id: 'trade', label: 'Trade Notes' },
                                { id: 'general', label: isEn ? 'Playbook & Rules' : 'General' },
                            ] as { id: JournalTab; label: string }[]
                        ).map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer truncate ${
                                        isActive
                                            ? 'bg-surface-2 text-fg border border-line shadow-xs'
                                            : 'text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Barra de Busca + Botão de Ação Rápida (+ New Note) */}
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1 min-w-0">
                            <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={
                                    activeTab === 'daily'
                                        ? (isEn ? 'Search date, symbol or note...' : 'Buscar dia, ativo ou nota...')
                                        : activeTab === 'trade'
                                        ? (isEn ? 'Search ticket, symbol or setup...' : 'Buscar ticket, ativo ou setup...')
                                        : (isEn ? 'Search rule or playbook note...' : 'Buscar regra ou nota...')
                                }
                                className="w-full bg-surface border border-line focus:border-line-strong rounded-xl pl-8 pr-7 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg cursor-pointer"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => void handleQuickNewNote()}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-accent text-accent-on hover:opacity-95 transition-opacity shrink-0 cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            <span>New Note</span>
                        </button>
                    </div>

                    {/* Exportação rápida do Diário completo (espalha notas diárias nos trades sem nota) */}
                    {activeTab !== 'general' && (
                        <div className="bg-surface border border-line rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10px]">
                            <span className="inline-flex items-center gap-1 text-fg-muted font-medium truncate">
                                <Download className="w-3 h-3 text-accent shrink-0" />
                                {isEn ? 'Export Journal:' : 'Exportar Diário:'}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                                {(
                                    [
                                        { fmt: 'csv', label: 'CSV' },
                                        { fmt: 'excel', label: 'Excel' },
                                        { fmt: 'pdf', label: 'PDF' },
                                    ] as { fmt: DocumentFormat; label: string }[]
                                ).map(({ fmt, label }) => (
                                    <button
                                        key={fmt}
                                        type="button"
                                        onClick={() => handleExportJournalTrades(fmt, 'all')}
                                        className="px-1.5 py-0.5 rounded bg-canvas-subtle hover:bg-surface-2 text-fg-muted hover:text-fg border border-line-subtle font-semibold transition-colors cursor-pointer"
                                        title={
                                            isEn
                                                ? `Export the filtered range as ${label}, applying daily session logs to executions without individual notes`
                                                : `Exportar todo o período filtrado em ${label} aplicando notas diárias onde não houver nota de trade`
                                        }
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Seletor rápido de data ao clicar "+ New Note" em Daily Notes */}
                    {activeTab === 'daily' && showNewDatePicker && (
                        <div className="bg-surface border border-line rounded-xl p-2.5 flex items-center gap-2">
                            <CalendarPlus className="w-4 h-4 text-accent shrink-0" />
                            <input
                                type="date"
                                value={newNoteDate}
                                onChange={(e) => setNewNoteDate(e.target.value)}
                                className="flex-1 bg-canvas-subtle border border-line-subtle rounded-lg px-2 py-1 text-xs text-fg focus:outline-none"
                            />
                            <button
                                type="button"
                                onClick={handleConfirmNewDateBlock}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-2 hover:bg-surface-3 text-fg border border-line cursor-pointer"
                            >
                                {isEn ? 'Open' : 'Abrir'}
                            </button>
                        </div>
                    )}

                    {/* Subfiltros compactos para Trade Notes ou General */}
                    {activeTab === 'trade' && (
                        <div className="flex items-center gap-1.5 text-[11px]">
                            <button
                                type="button"
                                onClick={() => setTradeListFilter('all')}
                                className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                                    tradeListFilter === 'all'
                                        ? 'bg-surface-2 text-fg border-line font-medium'
                                        : 'bg-surface text-fg-muted border-line-subtle hover:text-fg'
                                }`}
                            >
                                {isEn ? 'All' : 'Todas'} ({allFilteredTrades.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setTradeListFilter('annotated')}
                                className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                                    tradeListFilter === 'annotated'
                                        ? 'bg-surface-2 text-fg border-line font-medium'
                                        : 'bg-surface text-fg-muted border-line-subtle hover:text-fg'
                                }`}
                            >
                                {isEn ? 'Annotated' : 'Com Anotação'}
                            </button>
                        </div>
                    )}

                    {activeTab === 'general' && (
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            {(
                                [
                                    { id: 'ALL', label: isEn ? 'All' : 'Todas' },
                                    { id: 'PLAYBOOK', label: 'Playbook' },
                                    { id: 'RISK_RULES', label: isEn ? 'Risk' : 'Risco' },
                                    { id: 'PSYCHOLOGY', label: isEn ? 'Psychology' : 'Psicologia' },
                                ] as { id: 'ALL' | GeneralNoteCategory; label: string }[]
                            ).map((cat) => (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => setGeneralCatFilter(cat.id)}
                                    className={`px-2 py-0.5 rounded-lg border transition-colors cursor-pointer ${
                                        generalCatFilter === cat.id
                                            ? 'bg-surface-2 text-fg border-line font-medium'
                                            : 'bg-surface text-fg-muted border-line-subtle hover:text-fg'
                                    }`}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Lista Rolável da Coluna Esquerda */}
                    <div className="space-y-2.5 max-h-[calc(100vh-215px)] overflow-y-auto pr-0.5">
                        {activeTab === 'daily' &&
                            (filteredDailyBlocks.length === 0 ? (
                                <div className="bg-surface border border-line rounded-xl p-6 text-center text-xs text-fg-subtle">
                                    {isEn ? 'No daily session logs match the active filters.' : 'Nenhum bloco diário encontrado para os filtros atuais.'}
                                </div>
                            ) : (
                                filteredDailyBlocks.map((block) => (
                                    <DailyBlockCard
                                        key={block.date}
                                        block={block}
                                        isSelected={selectedDate === block.date}
                                        onSelect={(dateKey) => setSelectedDate(dateKey)}
                                    />
                                ))
                            ))}

                        {activeTab === 'trade' &&
                            (allFilteredTrades.length === 0 ? (
                                <div className="bg-surface border border-line rounded-xl p-6 text-center text-xs text-fg-subtle">
                                    {isEn ? 'No executions found.' : 'Nenhuma operação encontrada.'}
                                </div>
                            ) : (
                                allFilteredTrades.map((tr) => {
                                    const isSelected = selectedTrade?.id === tr.id;
                                    const snippet = stripHtmlPreview(
                                        tr.tradeNote?.content,
                                        65
                                    );
                                    const rawTradeShots =
                                        tr.tradeNote?.screenshots &&
                                        tr.tradeNote.screenshots.length > 0
                                            ? tr.tradeNote.screenshots
                                            : tr.tradeNote?.screenshotUrl
                                            ? [tr.tradeNote.screenshotUrl]
                                            : [];
                                    const parsedTradeShots =
                                        parseJournalImages(rawTradeShots);
                                    const tradeShotsCount =
                                        (parsedTradeShots.before ? 1 : 0) +
                                        (parsedTradeShots.after ? 1 : 0) +
                                        parsedTradeShots.extras.length;
                                    const hasShot = tradeShotsCount > 0;
                                    const tPsychEmojis = TRADE_PSYCH_QUESTIONS.flatMap(
                                        (q) => {
                                            const v = tr.tradeNote?.psychCheck?.[q.key];
                                            if (!v) return [];
                                            const found = q.options.find(
                                                (o) => o.value === v
                                            );
                                            return found ? [found.emoji] : [];
                                        }
                                    );

                                    return (
                                        <button
                                            key={tr.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedTradeId(tr.id);
                                                setSelectedDate(tr.dateKey);
                                            }}
                                            className={`w-full text-left rounded-xl p-3 border transition-all cursor-pointer ${
                                                isSelected
                                                    ? 'bg-surface border-data-1 ring-1 ring-data-1/35'
                                                    : hasShot
                                                    ? 'bg-surface hover:bg-surface-2 border-accent/30 hover:border-accent/55'
                                                    : 'bg-surface hover:bg-surface-2 border-line hover:border-line-strong'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="text-xs font-bold text-fg truncate">
                                                        {tr.symbol}
                                                    </span>
                                                    <span
                                                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                                            tr.side === 'BUY'
                                                                ? 'bg-accent/15 text-accent'
                                                                : 'bg-danger/15 text-danger'
                                                        }`}
                                                    >
                                                        {tr.side}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-fg-subtle">
                                                        #{tr.ticket}
                                                    </span>
                                                </div>

                                                <span
                                                    className={`text-xs font-mono font-semibold tabular-nums ${
                                                        tr.netPnl >= 0
                                                            ? 'text-accent'
                                                            : 'text-danger'
                                                    }`}
                                                >
                                                    {formatSignedCurrency(tr.netPnl)}
                                                </span>
                                            </div>

                                            <div className="mt-1.5 flex items-center justify-between text-[11px] text-fg-subtle">
                                                <span>
                                                    {formatJournalBlockDate(tr.dateKey)}
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    {tPsychEmojis.length > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 text-[11px]">
                                                            {tPsychEmojis.join('')}
                                                        </span>
                                                    )}
                                                    {tr.rating > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 text-warning">
                                                            <Star className="w-3 h-3 fill-warning" />
                                                            {tr.rating}
                                                        </span>
                                                    )}
                                                    {hasShot && (
                                                        <span
                                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent-fg border border-accent/35"
                                                            title={isEn ? `${tradeShotsCount} attached screenshot(s)` : `${tradeShotsCount} imagem(ns) anexada(s)`}
                                                        >
                                                            <ImageIcon className="w-3 h-3" />
                                                            <span>{tradeShotsCount}</span>
                                                        </span>
                                                    )}
                                                    {snippet && (
                                                        <FileText className="w-3 h-3 text-data-1" />
                                                    )}
                                                </div>
                                            </div>

                                            {(tr.mfe !== null || tr.mae !== null) && (
                                                <div className="mt-1.5 flex items-center gap-3 text-[10px] font-mono">
                                                    <span className="text-fg-muted">
                                                        MFE:{' '}
                                                        <strong className="text-accent">
                                                            {tr.mfe !== null
                                                                ? `+$${tr.mfe.toFixed(2)}`
                                                                : '—'}
                                                        </strong>
                                                    </span>
                                                    <span className="text-fg-muted">
                                                        MAE:{' '}
                                                        <strong className="text-danger">
                                                            {tr.mae !== null
                                                                ? `-$${tr.mae.toFixed(2)}`
                                                                : '—'}
                                                        </strong>
                                                    </span>
                                                </div>
                                            )}

                                            {snippet && (
                                                <p className="mt-1.5 text-[11px] text-fg-muted line-clamp-2">
                                                    {snippet}
                                                </p>
                                            )}

                                            {(parsedTradeShots.before ||
                                                parsedTradeShots.after) && (
                                                <div className="mt-2 pt-2 border-t border-line-subtle flex items-center justify-center gap-2">
                                                    {parsedTradeShots.before && (
                                                        <div className="relative flex-1 max-w-[130px] h-16 rounded-md overflow-hidden border border-data-1/40 bg-canvas flex items-center justify-center">
                                                            <img
                                                                src={parsedTradeShots.before}
                                                                alt={isEn ? 'BEFORE' : 'ANTES'}
                                                                className="max-h-full max-w-full object-contain mx-auto"
                                                            />
                                                            <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-canvas/85 text-fg border border-data-1/40">
                                                                {isEn ? 'BEFORE' : 'ANTES'}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {parsedTradeShots.after && (
                                                        <div className="relative flex-1 max-w-[130px] h-16 rounded-md overflow-hidden border border-accent/40 bg-canvas flex items-center justify-center">
                                                            <img
                                                                src={parsedTradeShots.after}
                                                                alt={isEn ? 'AFTER' : 'DEPOIS'}
                                                                className="max-h-full max-w-full object-contain mx-auto"
                                                            />
                                                            <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-canvas/85 text-accent-fg border border-accent/40">
                                                                {isEn ? 'AFTER' : 'DEPOIS'}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })
                            ))}

                        {activeTab === 'general' &&
                            (filteredGeneralNotes.length === 0 ? (
                                <div className="bg-surface border border-line rounded-xl p-6 text-center space-y-2">
                                    <p className="text-xs text-fg-subtle">
                                        {isEn ? 'No playbook rules or general notes created yet.' : 'Nenhuma nota geral ou regra cadastrada ainda.'}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => void handleQuickNewNote()}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 hover:bg-surface-3 text-fg border border-line cursor-pointer"
                                    >
                                        <Plus className="w-3.5 h-3.5 text-accent" />
                                        <span>{isEn ? 'Create First Playbook / Rule' : 'Criar Primeira Regra / Nota'}</span>
                                    </button>
                                </div>
                            ) : (
                                filteredGeneralNotes.map((gn) => {
                                    const isSelected = selectedGeneralNote?.id === gn.id;
                                    const catMeta =
                                        GENERAL_CATEGORY_META[
                                            gn.category as GeneralNoteCategory
                                        ] || GENERAL_CATEGORY_META.GENERAL;
                                    const preview = stripHtmlPreview(gn.content, 75);
                                    const parsedGenImages = parseJournalImages(gn.images);
                                    const genImgCount =
                                        (parsedGenImages.before ? 1 : 0) +
                                        (parsedGenImages.after ? 1 : 0) +
                                        parsedGenImages.extras.length;

                                    return (
                                        <button
                                            key={gn.id}
                                            type="button"
                                            onClick={() => setSelectedGeneralId(gn.id)}
                                            className={`w-full text-left rounded-xl p-3 border transition-all cursor-pointer ${
                                                isSelected
                                                    ? 'bg-surface border-data-1 ring-1 ring-data-1/35'
                                                    : genImgCount > 0
                                                    ? 'bg-surface hover:bg-surface-2 border-accent/30 hover:border-accent/55'
                                                    : 'bg-surface hover:bg-surface-2 border-line hover:border-line-strong'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-semibold text-fg truncate">
                                                    {gn.title}
                                                </span>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {genImgCount > 0 && (
                                                        <span
                                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent-fg border border-accent/35"
                                                            title={isEn ? `${genImgCount} attached image(s)` : `${genImgCount} imagem(ns) anexada(s)`}
                                                        >
                                                            <ImageIcon className="w-3 h-3" />
                                                            <span>{genImgCount}</span>
                                                        </span>
                                                    )}
                                                    {gn.pinned && (
                                                        <Pin className="w-3 h-3 text-accent shrink-0" />
                                                    )}
                                                </div>
                                            </div>

                                            <div className="mt-1.5 flex items-center justify-between gap-2">
                                                <span
                                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${catMeta.badgeClass}`}
                                                >
                                                    {isEn ? catMeta.labelEn : catMeta.label}
                                                </span>
                                                {gn.updatedAt && (
                                                    <span className="text-[10px] text-fg-subtle">
                                                        {formatJournalBlockDate(
                                                            gn.updatedAt.slice(0, 10)
                                                        )}
                                                    </span>
                                                )}
                                            </div>

                                            {preview && (
                                                <p className="mt-1.5 text-[11px] text-fg-muted line-clamp-2">
                                                    {preview}
                                                </p>
                                            )}

                                            {(parsedGenImages.before ||
                                                parsedGenImages.after) && (
                                                <div className="mt-2 pt-2 border-t border-line-subtle flex items-center justify-center gap-2">
                                                    {parsedGenImages.before && (
                                                        <div className="relative flex-1 max-w-[130px] h-16 rounded-md overflow-hidden border border-data-1/40 bg-canvas flex items-center justify-center">
                                                            <img
                                                                src={parsedGenImages.before}
                                                                alt={isEn ? 'BEFORE' : 'ANTES'}
                                                                className="max-h-full max-w-full object-contain mx-auto"
                                                            />
                                                            <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-canvas/85 text-fg border border-data-1/40">
                                                                {isEn ? 'BEFORE' : 'ANTES'}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {parsedGenImages.after && (
                                                        <div className="relative flex-1 max-w-[130px] h-16 rounded-md overflow-hidden border border-accent/40 bg-canvas flex items-center justify-center">
                                                            <img
                                                                src={parsedGenImages.after}
                                                                alt={isEn ? 'AFTER' : 'DEPOIS'}
                                                                className="max-h-full max-w-full object-contain mx-auto"
                                                            />
                                                            <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-canvas/85 text-accent-fg border border-accent/40">
                                                                {isEn ? 'AFTER' : 'DEPOIS'}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })
                            ))}
                    </div>
                </aside>

                {/* =========================================================
                    COLUNA DIREITA: Editor Rico Interativo + Tabela do Dia
                   ========================================================= */}
                <section className="lg:col-span-8 xl:col-span-9 space-y-4 min-w-0">
                    <NoteWorkspaceEditor
                        mode={activeTab}
                        activeKey={editorConfig.activeKey}
                        selectedDate={selectedDate}
                        initialTitle={editorConfig.initialTitle}
                        initialCategory={editorConfig.initialCategory}
                        initialPinned={editorConfig.initialPinned}
                        initialContent={editorConfig.initialContent}
                        initialMood={editorConfig.initialMood}
                        initialMarketBias={editorConfig.initialMarketBias}
                        initialPsychCheck={editorConfig.initialPsychCheck}
                        initialImages={editorConfig.initialImages}
                        selectedTrade={selectedTrade}
                        selectedGeneralNote={selectedGeneralNote}
                        customTemplates={customTemplates}
                        isSaving={isSaving}
                        onSave={handleSaveEditor}
                        onDeleteNote={handleDeleteCurrentNote}
                        onUploadImage={handleUploadImage}
                        onSaveTemplate={handleSaveTemplate}
                        onDeleteTemplate={handleDeleteTemplate}
                        onOpenTradeDetails={(tradeId) => void handleOpenTradeDetails(tradeId)}
                    />

                    <DayTradesTable
                        dateLabel={bottomTableDate}
                        trades={bottomTableTrades}
                        dailyNote={bottomTableBlock?.note || null}
                        selectedTradeId={
                            activeTab === 'trade' ? selectedTrade?.id || null : null
                        }
                        onSelectTradeForNote={(trade) => {
                            setSelectedTradeId(trade.id);
                            setSelectedDate(trade.dateKey);
                            setActiveTab('trade');
                        }}
                        onOpenTradeDetails={(tradeId) => void handleOpenTradeDetails(tradeId)}
                        onExportTrades={handleExportJournalTrades}
                    />
                </section>
            </div>
        </div>
    );
};
