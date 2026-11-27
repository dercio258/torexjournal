import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeftRight,
    Bold,
    BookmarkPlus,
    Calendar,
    Check,
    ChevronLeft,
    ChevronRight,
    Columns2,
    Crosshair,
    ExternalLink,
    FileText,
    Image as ImageIcon,
    ImagePlus,
    Italic,
    List,
    ListOrdered,
    Loader2,
    MoreVertical,
    Pin,
    Plus,
    Redo2,
    RefreshCw,
    Save,
    Star,
    Strikethrough,
    Trash2,
    Undo2,
    X,
    ZoomIn,
} from 'lucide-react';
import {
    DAILY_PSYCH_DIMENSIONS,
    DailyPsychCheck,
    DEFAULT_NOTE_TEMPLATES,
    formatJournalFullDate,
    formatSignedCurrency,
    GENERAL_CATEGORY_META,
    GeneralNoteCategory,
    GeneralNoteItem,
    getPsychToneClass,
    JournalImageSlots,
    JournalTab,
    JournalTradeRow,
    NoteTemplateItem,
    parseJournalImages,
    serializeJournalImages,
    TRADE_PSYCH_QUESTIONS,
    TradePsychCheck,
} from './types';
import { useLocale } from '../../context/LocaleContext';
import { sanitizeRichHtml } from '../../utils/sanitizeHtml';

type UploadTargetMode =
    | { kind: 'pair' }
    | { kind: 'before' }
    | { kind: 'after' }
    | { kind: 'extra' }
    | { kind: 'replace-extra'; index: number }
    | { kind: 'editor-paste-drop' };

interface LightboxState {
    mode: 'single' | 'compare';
    url: string;
    label: string;
}

export interface EditorSavePayload {
    targetMode?: JournalTab;
    targetDate?: string;
    targetTradeId?: string | null;
    targetGeneralId?: string | null;
    title?: string | null;
    category?: GeneralNoteCategory | string;
    pinned?: boolean;
    content: string;
    mood?: string | null;
    marketBias?: string | null;
    psychCheck?: DailyPsychCheck;
    tradePsychCheck?: TradePsychCheck;
    images: string[];
    setup?: string | null;
    rating?: number;
    mfe?: number | null;
    mae?: number | null;
}

interface NoteWorkspaceEditorProps {
    mode: JournalTab;
    activeKey: string;
    selectedDate: string;
    initialTitle?: string | null;
    initialCategory?: GeneralNoteCategory | string;
    initialPinned?: boolean;
    initialContent: string;
    initialMood?: string | null;
    initialMarketBias?: string | null;
    initialPsychCheck?: DailyPsychCheck;
    initialImages: string[];
    selectedTrade?: JournalTradeRow | null;
    selectedGeneralNote?: GeneralNoteItem | null;
    customTemplates: GeneralNoteItem[];
    isSaving: boolean;
    onSave: (payload: EditorSavePayload) => Promise<void>;
    onDeleteNote: () => Promise<void>;
    onUploadImage: (file: File) => Promise<string>;
    onSaveTemplate: (title: string, content: string) => Promise<void>;
    onDeleteTemplate: (templateId: string) => Promise<void>;
    onOpenTradeDetails?: (tradeId: string) => void;
    customContextTitle?: string;
    customContextBadge?: string;
    openTradeActionLabel?: string;
}

const BIAS_OPTIONS = ['Bullish', 'Bearish', 'Neutro'];

function findFirstUnansweredDaily(pc?: DailyPsychCheck | null): number | null {
    const safe = pc || {};
    const idx = DAILY_PSYCH_DIMENSIONS.findIndex((dim) => !safe[dim.key]);
    return idx >= 0 ? idx : null;
}

function findFirstUnansweredTrade(pc?: TradePsychCheck | null): number | null {
    const safe = pc || {};
    const idx = TRADE_PSYCH_QUESTIONS.findIndex((q) => !safe[q.key]);
    return idx >= 0 ? idx : null;
}

export const NoteWorkspaceEditor: React.FC<NoteWorkspaceEditorProps> = ({
    mode,
    activeKey,
    selectedDate,
    initialTitle,
    initialCategory = 'GENERAL',
    initialPinned = false,
    initialContent,
    initialMood,
    initialMarketBias,
    initialPsychCheck,
    initialImages,
    selectedTrade,
    selectedGeneralNote,
    customTemplates,
    isSaving,
    onSave,
    onDeleteNote,
    onUploadImage,
    onSaveTemplate,
    onDeleteTemplate,
    onOpenTradeDetails,
    customContextTitle,
    customContextBadge,
    openTradeActionLabel,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const resolvedOpenTradeLabel = openTradeActionLabel || (isEn ? 'Details' : 'Detalhes');
    const editorRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const singleFileInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<UploadTargetMode>({ kind: 'pair' });
    const loadedKeyRef = useRef<string>('');
    const autoSaveTimerRef = useRef<number | null>(null);
    const pendingDirtyPayloadRef = useRef<EditorSavePayload | null>(null);
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const menuRef = useRef<HTMLDivElement>(null);
    const templateMenuRef = useRef<HTMLDivElement>(null);

    const [title, setTitle] = useState<string>(initialTitle || '');
    const [category, setCategory] = useState<GeneralNoteCategory>(
        (initialCategory as GeneralNoteCategory) || 'GENERAL'
    );
    const [pinned, setPinned] = useState<boolean>(Boolean(initialPinned));
    const [mood, setMood] = useState<string | null>(initialMood || null);
    const [marketBias, setMarketBias] = useState<string | null>(initialMarketBias || null);
    const [psychCheck, setPsychCheck] = useState<DailyPsychCheck>(
        initialPsychCheck || {}
    );
    const [dailyStepIdx, setDailyStepIdx] = useState<number | null>(() =>
        findFirstUnansweredDaily(initialPsychCheck)
    );
    const [images, setImages] = useState<string[]>(initialImages || []);

    // Trade-specific metadata
    const [setup, setSetup] = useState<string>(selectedTrade?.setup || '');
    const [rating, setRating] = useState<number>(selectedTrade?.rating || 0);
    const [tradePsychCheck, setTradePsychCheck] = useState<TradePsychCheck>(
        selectedTrade?.tradeNote?.psychCheck || {}
    );
    const [tradeStepIdx, setTradeStepIdx] = useState<number | null>(() =>
        findFirstUnansweredTrade(selectedTrade?.tradeNote?.psychCheck)
    );
    const [mfeInput, setMfeInput] = useState<string>(
        selectedTrade?.mfe !== null && selectedTrade?.mfe !== undefined
            ? String(selectedTrade.mfe)
            : ''
    );
    const [maeInput, setMaeInput] = useState<string>(
        selectedTrade?.mae !== null && selectedTrade?.mae !== undefined
            ? String(selectedTrade.mae)
            : ''
    );

    const [isEmpty, setIsEmpty] = useState<boolean>(!initialContent?.trim());
    const [isDirty, setIsDirty] = useState<boolean>(false);
    const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);
    const [isDragOver, setIsDragOver] = useState<boolean>(false);
    const [showMoreMenu, setShowMoreMenu] = useState<boolean>(false);
    const [showTemplateMenu, setShowTemplateMenu] = useState<boolean>(false);
    const [showNewTemplateBar, setShowNewTemplateBar] = useState<boolean>(false);
    const [newTemplateName, setNewTemplateName] = useState<string>('');
    const [savingTemplate, setSavingTemplate] = useState<boolean>(false);
    const [lightbox, setLightbox] = useState<LightboxState | null>(null);
    const [imageNotice, setImageNotice] = useState<string | null>(null);
    const [showExtrasPanel, setShowExtrasPanel] = useState<boolean>(false);

    const imageSlots: JournalImageSlots = useMemo(
        () => parseJournalImages(images),
        [images]
    );
    const hasAnyAttachedImage = Boolean(
        imageSlots.before || imageSlots.after || imageSlots.extras.length > 0
    );
    const primaryAttachedCount =
        (imageSlots.before ? 1 : 0) + (imageSlots.after ? 1 : 0);

    // Sync state ONLY when activeKey changes so typing never resets the cursor
    useEffect(() => {
        if (loadedKeyRef.current === activeKey) return;

        // Flush any pending unsaved changes from the previous note/trade before switching
        if (autoSaveTimerRef.current) {
            window.clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        if (pendingDirtyPayloadRef.current) {
            const toFlush = pendingDirtyPayloadRef.current;
            pendingDirtyPayloadRef.current = null;
            void onSaveRef.current(toFlush);
        }

        loadedKeyRef.current = activeKey;

        setTitle(initialTitle || '');
        setCategory((initialCategory as GeneralNoteCategory) || 'GENERAL');
        setPinned(Boolean(initialPinned));
        setMood(initialMood || null);
        setMarketBias(initialMarketBias || null);
        setPsychCheck(initialPsychCheck || {});
        setDailyStepIdx(findFirstUnansweredDaily(initialPsychCheck));
        setImages(initialImages || []);
        const parsedInit = parseJournalImages(initialImages || []);
        setShowExtrasPanel(parsedInit.extras.length > 0);
        setImageNotice(null);
        setLightbox(null);
        setSetup(selectedTrade?.setup || '');
        setRating(selectedTrade?.rating || 0);
        setTradePsychCheck(selectedTrade?.tradeNote?.psychCheck || {});
        setTradeStepIdx(findFirstUnansweredTrade(selectedTrade?.tradeNote?.psychCheck));
        setMfeInput(
            selectedTrade?.mfe !== null && selectedTrade?.mfe !== undefined
                ? String(selectedTrade.mfe)
                : ''
        );
        setMaeInput(
            selectedTrade?.mae !== null && selectedTrade?.mae !== undefined
                ? String(selectedTrade.mae)
                : ''
        );

        if (editorRef.current) {
            editorRef.current.innerHTML = sanitizeRichHtml(initialContent || '');
        }
        const stripped = (initialContent || '').replace(/<[^>]+>/g, '').trim();
        setIsEmpty(!stripped);
        setIsDirty(false);
        setShowMoreMenu(false);
        setShowTemplateMenu(false);
        setShowNewTemplateBar(false);
    }, [
        activeKey,
        initialTitle,
        initialCategory,
        initialPinned,
        initialContent,
        initialMood,
        initialMarketBias,
        initialPsychCheck,
        initialImages,
        selectedTrade,
    ]);

    // Close popovers on outside click
    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMoreMenu(false);
            }
            if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
                setShowTemplateMenu(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const buildPayload = (
        overrideImages?: string[],
        partial?: Partial<EditorSavePayload>
    ): EditorSavePayload => {
        const html = sanitizeRichHtml(editorRef.current?.innerHTML || '');
        const parsedMfe =
            mfeInput.trim() === '' ? null : Number(mfeInput.replace(',', '.'));
        const parsedMae =
            maeInput.trim() === '' ? null : Number(maeInput.replace(',', '.'));

        return {
            targetMode: mode,
            targetDate: selectedDate,
            targetTradeId: selectedTrade?.id || null,
            targetGeneralId: selectedGeneralNote?.id || null,
            title: title.trim() || null,
            category,
            pinned,
            content: html,
            mood: psychCheck.moodState ?? mood,
            marketBias,
            psychCheck,
            tradePsychCheck,
            images: overrideImages !== undefined ? overrideImages : images,
            setup: setup.trim() || null,
            rating,
            mfe: parsedMfe !== null && Number.isFinite(parsedMfe) ? Math.abs(parsedMfe) : null,
            mae: parsedMae !== null && Number.isFinite(parsedMae) ? Math.abs(parsedMae) : null,
            ...partial,
        };
    };

    const triggerSave = async (
        overrideImages?: string[],
        partial?: Partial<EditorSavePayload>
    ) => {
        if (autoSaveTimerRef.current) {
            window.clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        const payload = buildPayload(overrideImages, partial);
        pendingDirtyPayloadRef.current = null;
        await onSave(payload);
        setIsDirty(false);
    };

    const scheduleAutoSave = (
        overrideImages?: string[],
        partial?: Partial<EditorSavePayload>
    ) => {
        setIsDirty(true);
        const snapshot = buildPayload(overrideImages, partial);
        pendingDirtyPayloadRef.current = snapshot;
        if (autoSaveTimerRef.current) {
            window.clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = window.setTimeout(() => {
            pendingDirtyPayloadRef.current = null;
            void onSaveRef.current(snapshot).then(() => setIsDirty(false));
        }, 900);
    };

    useEffect(() => {
        return () => {
            if (autoSaveTimerRef.current) {
                window.clearTimeout(autoSaveTimerRef.current);
                autoSaveTimerRef.current = null;
            }
            if (pendingDirtyPayloadRef.current) {
                const toFlush = pendingDirtyPayloadRef.current;
                pendingDirtyPayloadRef.current = null;
                void onSaveRef.current(toFlush);
            }
        };
    }, []);

    const syncEditorEmptyFlag = () => {
        const raw = editorRef.current?.innerText || '';
        setIsEmpty(!raw.trim());
    };

    const execFormat = (command: string, value?: string) => {
        editorRef.current?.focus();
        document.execCommand(command, false, value);
        syncEditorEmptyFlag();
        scheduleAutoSave();
    };

    const toggleHeading = () => {
        editorRef.current?.focus();
        const currentBlock = document.queryCommandValue('formatBlock');
        if (String(currentBlock).toLowerCase().includes('h2')) {
            document.execCommand('formatBlock', false, 'p');
        } else {
            document.execCommand('formatBlock', false, 'h2');
        }
        syncEditorEmptyFlag();
        scheduleAutoSave();
    };

    const applyTemplate = (tpl: NoteTemplateItem) => {
        if (!editorRef.current) return;
        const tplBody = sanitizeRichHtml(isEn ? tpl.contentEn || tpl.content : tpl.content);
        const current = sanitizeRichHtml(editorRef.current.innerHTML.trim());
        editorRef.current.innerHTML = current
            ? `${current}<hr/>${tplBody}`
            : tplBody;
        syncEditorEmptyFlag();
        setShowTemplateMenu(false);
        scheduleAutoSave();
    };

    const commitImageSlots = async (nextSlots: JournalImageSlots) => {
        const serialized = serializeJournalImages(nextSlots);
        setImages(serialized);
        if (nextSlots.extras.length > 0) {
            setShowExtrasPanel(true);
        }
        await triggerSave(serialized);
    };

    const openImagePicker = (target: UploadTargetMode) => {
        if (isTradeDisabled || isUploadingImage) return;
        uploadTargetRef.current = target;
        if (
            target.kind === 'before' ||
            target.kind === 'after' ||
            target.kind === 'replace-extra'
        ) {
            singleFileInputRef.current?.click();
        } else {
            fileInputRef.current?.click();
        }
    };

    const handleFilesUpload = async (
        fileList: FileList | File[],
        targetOverride?: UploadTargetMode
    ) => {
        const rawFiles = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
        if (rawFiles.length === 0) return;

        const target = targetOverride || uploadTargetRef.current;
        const currentSlots = parseJournalImages(images);
        setImageNotice(null);

        // Regra do editor ANTES/DEPOIS: na importação principal do par, apenas até 2 imagens são importadas
        let filesToUpload = rawFiles;
        let truncatedPairNotice: string | null = null;

        if (
            target.kind === 'before' ||
            target.kind === 'after' ||
            target.kind === 'replace-extra'
        ) {
            filesToUpload = rawFiles.slice(0, 1);
        } else if (target.kind === 'pair') {
            if (rawFiles.length > 2) {
                filesToUpload = rawFiles.slice(0, 2);
                truncatedPairNotice = isEn
                    ? 'Only 2 images are imported into BEFORE / AFTER. Use "+ Extra Image" for additional screenshots.'
                    : 'Apenas 2 imagens são importadas em ANTES / DEPOIS. Use "+ Imagem Extra" para anexos adicionais.';
            }
        } else if (target.kind === 'editor-paste-drop') {
            const openPrimarySlots =
                (currentSlots.before ? 0 : 1) + (currentSlots.after ? 0 : 1);
            if (openPrimarySlots > 0 && rawFiles.length > openPrimarySlots) {
                // Preenche apenas os slots ANTES/DEPOIS no editor; se já estiverem completos, permite extras
                filesToUpload = rawFiles.slice(0, Math.max(2, openPrimarySlots));
                if (rawFiles.length > 2) {
                    truncatedPairNotice = isEn
                        ? 'Only 2 images were imported into BEFORE / AFTER. Use "+ Extra Image" to attach more.'
                        : 'Apenas 2 imagens foram importadas em ANTES / DEPOIS. Use "+ Imagem Extra" para anexar mais.';
                }
            }
        }

        setIsUploadingImage(true);
        try {
            const uploadedUrls: string[] = [];
            for (const file of filesToUpload) {
                const url = await onUploadImage(file);
                if (url) uploadedUrls.push(url);
            }
            if (uploadedUrls.length === 0) return;

            const nextSlots: JournalImageSlots = {
                before: currentSlots.before,
                after: currentSlots.after,
                extras: [...currentSlots.extras],
            };

            if (target.kind === 'before') {
                nextSlots.before = uploadedUrls[0];
            } else if (target.kind === 'after') {
                nextSlots.after = uploadedUrls[0];
            } else if (target.kind === 'replace-extra') {
                nextSlots.extras[target.index] = uploadedUrls[0];
            } else if (target.kind === 'extra') {
                nextSlots.extras = [...nextSlots.extras, ...uploadedUrls].slice(0, 18);
                setShowExtrasPanel(true);
            } else if (target.kind === 'pair') {
                if (uploadedUrls.length >= 2) {
                    nextSlots.before = uploadedUrls[0];
                    nextSlots.after = uploadedUrls[1];
                } else if (!nextSlots.before) {
                    nextSlots.before = uploadedUrls[0];
                } else if (!nextSlots.after) {
                    nextSlots.after = uploadedUrls[0];
                } else {
                    nextSlots.after = uploadedUrls[0];
                }
            } else {
                // editor-paste-drop: prioriza ANTES -> DEPOIS; se ambos preenchidos, permite Extras
                for (const u of uploadedUrls) {
                    if (!nextSlots.before) {
                        nextSlots.before = u;
                    } else if (!nextSlots.after) {
                        nextSlots.after = u;
                    } else if (nextSlots.extras.length < 18) {
                        nextSlots.extras.push(u);
                        setShowExtrasPanel(true);
                        truncatedPairNotice = isEn
                            ? 'BEFORE and AFTER slots are already filled — new image added under Extras.'
                            : 'ANTES e DEPOIS já preenchidos — nova imagem adicionada em Extras.';
                    }
                }
            }

            if (truncatedPairNotice) {
                setImageNotice(truncatedPairNotice);
            }

            await commitImageSlots(nextSlots);
        } finally {
            setIsUploadingImage(false);
        }
    };

    const handleSwapBeforeAfter = async () => {
        const currentSlots = parseJournalImages(images);
        if (!currentSlots.before && !currentSlots.after) return;
        await commitImageSlots({
            before: currentSlots.after,
            after: currentSlots.before,
            extras: currentSlots.extras,
        });
    };

    const handleRemoveSlot = async (slot: 'before' | 'after' | { extraIdx: number }) => {
        const currentSlots = parseJournalImages(images);
        if (slot === 'before') {
            await commitImageSlots({ ...currentSlots, before: null });
            return;
        }
        if (slot === 'after') {
            await commitImageSlots({ ...currentSlots, after: null });
            return;
        }
        const nextExtras = currentSlots.extras.filter((_, i) => i !== slot.extraIdx);
        await commitImageSlots({ ...currentSlots, extras: nextExtras });
    };

    const handlePromoteExtra = async (extraIdx: number, dest: 'before' | 'after') => {
        const currentSlots = parseJournalImages(images);
        const chosen = currentSlots.extras[extraIdx];
        if (!chosen) return;

        const nextExtras = [...currentSlots.extras];
        const displaced = dest === 'before' ? currentSlots.before : currentSlots.after;
        if (displaced) {
            nextExtras[extraIdx] = displaced;
        } else {
            nextExtras.splice(extraIdx, 1);
        }

        await commitImageSlots({
            before: dest === 'before' ? chosen : currentSlots.before,
            after: dest === 'after' ? chosen : currentSlots.after,
            extras: nextExtras,
        });
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        if (pastedFiles.length > 0) {
            e.preventDefault();
            void handleFilesUpload(pastedFiles, { kind: 'editor-paste-drop' });
            return;
        }
        const pastedHtml = e.clipboardData?.getData('text/html');
        if (pastedHtml) {
            e.preventDefault();
            document.execCommand('insertHTML', false, sanitizeRichHtml(pastedHtml));
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void triggerSave();
        }
    };

    const handleClearContent = async () => {
        if (editorRef.current) {
            editorRef.current.innerHTML = '';
        }
        setIsEmpty(true);
        setShowMoreMenu(false);
        await triggerSave();
    };

    const handleConfirmSaveTemplate = async () => {
        const rawHtml = editorRef.current?.innerHTML?.trim() || '';
        const html = sanitizeRichHtml(rawHtml).trim();
        if (!html || !newTemplateName.trim()) return;
        setSavingTemplate(true);
        try {
            await onSaveTemplate(newTemplateName.trim(), html);
            setNewTemplateName('');
            setShowNewTemplateBar(false);
        } finally {
            setSavingTemplate(false);
        }
    };

    const allTemplates: NoteTemplateItem[] = [
        ...customTemplates.map((ct) => ({
            id: ct.id,
            title: ct.title,
            content: ct.content,
            isBuiltIn: false,
        })),
        ...DEFAULT_NOTE_TEMPLATES,
    ];

    const isTradeDisabled = mode === 'trade' && !selectedTrade;

    return (
        <div
            onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer?.files?.length) {
                    void handleFilesUpload(e.dataTransfer.files, {
                        kind: 'editor-paste-drop',
                    });
                }
            }}
            className={`min-w-0 bg-surface border rounded-xl p-4 transition-colors ${
                isDragOver ? 'border-accent ring-1 ring-accent/30' : 'border-line'
            }`}
        >
            {/* Header do Editor */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line-subtle">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {mode === 'daily' && (
                        <>
                            {customContextTitle ? (
                                <FileText className="w-4 h-4 text-accent shrink-0" />
                            ) : (
                                <Calendar className="w-4 h-4 text-fg-muted shrink-0" />
                            )}
                            {customContextBadge && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0">
                                    {customContextBadge}
                                </span>
                            )}
                            <h2 className="text-base font-semibold text-fg tracking-tight truncate">
                                {customContextTitle || formatJournalFullDate(selectedDate)}
                            </h2>
                        </>
                    )}

                    {mode === 'trade' && (
                        <>
                            <Crosshair className="w-4 h-4 text-data-1 shrink-0" />
                            {selectedTrade ? (
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    <span className="text-sm font-semibold text-fg font-mono">
                                        #{selectedTrade.ticket}
                                    </span>
                                    <span className="text-sm font-bold text-fg">
                                        {selectedTrade.symbol}
                                    </span>
                                    <span
                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                            selectedTrade.side === 'BUY'
                                                ? 'bg-accent/15 text-accent'
                                                : 'bg-danger/15 text-danger'
                                        }`}
                                    >
                                        {selectedTrade.side}
                                    </span>
                                    <span
                                        className={`text-xs font-mono font-semibold tabular-nums ${
                                            selectedTrade.netPnl >= 0
                                                ? 'text-accent'
                                                : 'text-danger'
                                        }`}
                                    >
                                        {formatSignedCurrency(selectedTrade.netPnl)}
                                    </span>
                                    {onOpenTradeDetails && (
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (isDirty || pendingDirtyPayloadRef.current) {
                                                    await triggerSave();
                                                }
                                                onOpenTradeDetails(selectedTrade.id);
                                            }}
                                            className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg px-1.5 py-0.5 rounded bg-canvas-subtle border border-line-subtle transition-colors cursor-pointer"
                                            title={isEn ? 'Open execution detail' : 'Abrir contexto da operação'}
                                        >
                                            <span>{resolvedOpenTradeLabel}</span>
                                            <ExternalLink className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <span className="text-sm font-medium text-fg-muted">
                                    {isEn ? 'Select an execution to log technical review notes' : 'Selecione uma operação para registrar anotações técnicas'}
                                </span>
                            )}
                        </>
                    )}

                    {mode === 'general' && (
                        <>
                            <FileText className="w-4 h-4 text-accent shrink-0" />
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => {
                                    const nextTitle = e.target.value;
                                    setTitle(nextTitle);
                                    scheduleAutoSave(undefined, {
                                        title: nextTitle.trim() || null,
                                    });
                                }}
                                placeholder={isEn ? 'Note title or playbook rule...' : 'Título da nota ou regra do plano...'}
                                className="flex-1 min-w-[180px] bg-transparent text-base font-semibold text-fg placeholder:text-fg-subtle focus:outline-none"
                            />
                            <select
                                value={category}
                                onChange={(e) => {
                                    const nextCat = e.target.value as GeneralNoteCategory;
                                    setCategory(nextCat);
                                    setIsDirty(true);
                                    void onSave({
                                        ...buildPayload(),
                                        category: nextCat,
                                    });
                                }}
                                className="bg-canvas-subtle border border-line-subtle rounded-lg px-2 py-1 text-xs font-medium text-fg focus:outline-none focus:border-line-strong"
                            >
                                {(
                                    Object.keys(GENERAL_CATEGORY_META) as GeneralNoteCategory[]
                                ).map((cat) => (
                                    <option key={cat} value={cat}>
                                        {isEn ? GENERAL_CATEGORY_META[cat].labelEn : GENERAL_CATEGORY_META[cat].label}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => {
                                    const nextPin = !pinned;
                                    setPinned(nextPin);
                                    void onSave({
                                        ...buildPayload(),
                                        pinned: nextPin,
                                    });
                                }}
                                className={`p-1.5 rounded-lg border transition-colors ${
                                    pinned
                                        ? 'bg-accent/15 text-accent border-accent/30'
                                        : 'bg-canvas-subtle text-fg-subtle hover:text-fg border-line-subtle'
                                }`}
                                title={pinned ? (isEn ? 'Unpin note' : 'Desafixar nota') : (isEn ? 'Pin note to top' : 'Fixar nota no topo')}
                            >
                                <Pin className="w-3.5 h-3.5" />
                            </button>
                        </>
                    )}
                </div>

                {/* Status de Salvamento + Menu ⋮ */}
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-fg-subtle flex items-center gap-1">
                        {isSaving ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin text-accent" />
                                <span>{isEn ? 'Saving...' : 'Salvando...'}</span>
                            </>
                        ) : isDirty ? (
                            <span className="text-warning">{isEn ? 'Unsaved changes' : 'Alterações pendentes'}</span>
                        ) : (
                            <>
                                <Check className="w-3 h-3 text-accent" />
                                <span>{isEn ? 'Saved' : 'Salvo'}</span>
                            </>
                        )}
                    </span>

                    <button
                        type="button"
                        disabled={isSaving || isTradeDisabled}
                        onClick={() => void triggerSave()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-canvas-subtle hover:bg-surface-2 text-fg border border-line transition-colors disabled:opacity-40 cursor-pointer"
                    >
                        <Save className="w-3.5 h-3.5 text-accent" />
                        <span>{isEn ? 'Save' : 'Salvar'}</span>
                    </button>

                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            onClick={() => setShowMoreMenu((prev) => !prev)}
                            className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                            title={isEn ? 'Note actions' : 'Opções da nota'}
                        >
                            <MoreVertical className="w-4 h-4" />
                        </button>

                        {showMoreMenu && (
                            <div className="absolute right-0 mt-1.5 w-48 bg-surface-2 border border-line rounded-xl shadow-lg py-1 z-30">
                                <button
                                    type="button"
                                    onClick={() => void handleClearContent()}
                                    className="w-full px-3 py-2 text-left text-xs text-fg-muted hover:text-fg hover:bg-surface-3 flex items-center gap-2"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    <span>{isEn ? 'Clear note body' : 'Limpar texto da nota'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowMoreMenu(false);
                                        void onDeleteNote();
                                    }}
                                    className="w-full px-3 py-2 text-left text-xs text-danger hover:bg-danger/10 flex items-center gap-2"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>{isEn ? 'Delete entry' : 'Excluir registro'}</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Faixa Contextual Compacta: Questões Sequenciais com Salto Automático (Daily) ou Check-in de Execução (Trade) */}
            {mode === 'daily' && (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-line-subtle text-[11px]">
                    <div className="flex flex-wrap items-center gap-1">
                        {dailyStepIdx !== null ? (
                            (() => {
                                const activeDim = DAILY_PSYCH_DIMENSIONS[dailyStepIdx];
                                const currentVal = psychCheck[activeDim.key] || null;
                                const answeredCount = DAILY_PSYCH_DIMENSIONS.filter((d) =>
                                    Boolean(psychCheck[d.key])
                                ).length;

                                return (
                                    <>
                                        <div className="inline-flex items-center gap-0.5 text-fg-subtle mr-0.5">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setDailyStepIdx(
                                                        (dailyStepIdx -
                                                            1 +
                                                            DAILY_PSYCH_DIMENSIONS.length) %
                                                            DAILY_PSYCH_DIMENSIONS.length
                                                    )
                                                }
                                                title={isEn ? 'Previous question' : 'Questão anterior'}
                                                className="p-0.5 rounded hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
                                            >
                                                <ChevronLeft className="w-3 h-3" />
                                            </button>
                                            <span className="font-mono text-[10px] tabular-nums">
                                                {dailyStepIdx + 1}/{DAILY_PSYCH_DIMENSIONS.length}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setDailyStepIdx(
                                                        (dailyStepIdx + 1) %
                                                            DAILY_PSYCH_DIMENSIONS.length
                                                    )
                                                }
                                                title={isEn ? 'Next question' : 'Próxima questão'}
                                                className="p-0.5 rounded hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
                                            >
                                                <ChevronRight className="w-3 h-3" />
                                            </button>
                                        </div>

                                        <span className="font-semibold uppercase tracking-wide text-fg-muted mr-1">
                                            {isEn ? activeDim.fullLabelEn || activeDim.fullLabel : activeDim.fullLabel}:
                                        </span>

                                        {activeDim.options.map((opt) => {
                                            const isSelected = currentVal === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => {
                                                        const nextVal = isSelected
                                                            ? null
                                                            : opt.value;
                                                        const nextPsych: DailyPsychCheck = {
                                                            ...psychCheck,
                                                            [activeDim.key]: nextVal,
                                                        };
                                                        const nextMood =
                                                            activeDim.key === 'moodState'
                                                                ? nextVal
                                                                : psychCheck.moodState ?? mood;
                                                        setPsychCheck(nextPsych);
                                                        setMood(nextMood);
                                                        void onSave({
                                                            ...buildPayload(),
                                                            mood: nextMood,
                                                            psychCheck: nextPsych,
                                                        });

                                                        if (!isSelected) {
                                                            let nextIdx: number | null = null;
                                                            for (
                                                                let offset = 1;
                                                                offset <=
                                                                DAILY_PSYCH_DIMENSIONS.length;
                                                                offset++
                                                            ) {
                                                                const candidate =
                                                                    (dailyStepIdx + offset) %
                                                                    DAILY_PSYCH_DIMENSIONS.length;
                                                                const candidateKey =
                                                                    DAILY_PSYCH_DIMENSIONS[
                                                                        candidate
                                                                    ].key;
                                                                if (!nextPsych[candidateKey]) {
                                                                    nextIdx = candidate;
                                                                    break;
                                                                }
                                                            }
                                                            setDailyStepIdx(nextIdx);
                                                        }
                                                    }}
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                                                        isSelected
                                                            ? getPsychToneClass(opt.tone)
                                                            : 'bg-canvas-subtle text-fg-muted hover:text-fg border-line-subtle'
                                                    }`}
                                                >
                                                    <span>{opt.emoji}</span>
                                                    <span>{isEn ? opt.labelEn || opt.value : opt.value}</span>
                                                </button>
                                            );
                                        })}

                                        {answeredCount > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setDailyStepIdx(null)}
                                                title={isEn ? 'View check-in summary' : 'Ver resumo das respostas'}
                                                className="ml-0.5 p-1 rounded text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                                            >
                                                <Check className="w-3 h-3" />
                                            </button>
                                        )}
                                    </>
                                );
                            })()
                        ) : (
                            DAILY_PSYCH_DIMENSIONS.map((dim, idx) => {
                                const currentVal = psychCheck[dim.key] || null;
                                const selectedOpt = dim.options.find(
                                    (o) => o.value === currentVal
                                );
                                const dimFull = isEn ? dim.fullLabelEn || dim.fullLabel : dim.fullLabel;
                                const dimShort = isEn ? dim.shortLabelEn || dim.shortLabel : dim.shortLabel;
                                const optText = selectedOpt ? (isEn ? selectedOpt.labelEn || selectedOpt.value : selectedOpt.value) : null;
                                return (
                                    <button
                                        key={dim.key}
                                        type="button"
                                        onClick={() => setDailyStepIdx(idx)}
                                        title={
                                            selectedOpt
                                                ? (isEn ? `${dimFull}: ${optText} (click to edit)` : `${dimFull}: ${optText} (clique para alterar)`)
                                                : (isEn ? `${dimFull} (click to log)` : `${dimFull} (clique para responder)`)
                                        }
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                                            selectedOpt
                                                ? getPsychToneClass(selectedOpt.tone)
                                                : 'bg-canvas-subtle text-fg-muted hover:text-fg border-line-subtle'
                                        }`}
                                    >
                                        <span>
                                            {selectedOpt
                                                ? selectedOpt.emoji
                                                : dim.defaultEmoji}
                                        </span>
                                        <span>
                                            {optText || dimShort}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <span className="text-fg-subtle mr-1">{isEn ? 'Macro Bias:' : 'Viés Macro:'}</span>
                        {BIAS_OPTIONS.map((b) => {
                            const active = marketBias === b;
                            const activeStyle =
                                b === 'Bullish'
                                    ? 'bg-accent/15 text-accent border-accent/35'
                                    : b === 'Bearish'
                                    ? 'bg-danger/15 text-danger border-danger/35'
                                    : 'bg-surface-2 text-fg border-line-strong';
                            return (
                                <button
                                    key={b}
                                    type="button"
                                    onClick={() => {
                                        const nextBias = active ? null : b;
                                        setMarketBias(nextBias);
                                        void onSave({
                                            ...buildPayload(),
                                            marketBias: nextBias,
                                        });
                                    }}
                                    className={`px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                                        active
                                            ? `${activeStyle} font-medium`
                                            : 'bg-canvas-subtle text-fg-muted hover:text-fg border-line-subtle'
                                    }`}
                                >
                                    {isEn && b === 'Neutro' ? 'Neutral' : b}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {mode === 'trade' && selectedTrade && (
                <div className="divide-y divide-line-subtle border-b border-line-subtle">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2.5 text-xs">
                        <label className="flex items-center justify-between gap-2 bg-canvas-subtle border border-line-subtle rounded-lg px-2.5 py-1.5">
                            <span className="text-[11px] text-fg-muted font-medium">
                                MFE ($)
                            </span>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={mfeInput}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setMfeInput(val);
                                    const parsed =
                                        val.trim() === ''
                                            ? null
                                            : Number(val.replace(',', '.'));
                                    scheduleAutoSave(undefined, {
                                        mfe:
                                            parsed !== null && Number.isFinite(parsed)
                                                ? Math.abs(parsed)
                                                : null,
                                    });
                                }}
                                placeholder="0.00"
                                className="w-20 bg-transparent text-right font-mono text-accent placeholder:text-fg-subtle focus:outline-none"
                            />
                        </label>

                        <label className="flex items-center justify-between gap-2 bg-canvas-subtle border border-line-subtle rounded-lg px-2.5 py-1.5">
                            <span className="text-[11px] text-fg-muted font-medium">
                                MAE ($)
                            </span>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={maeInput}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setMaeInput(val);
                                    const parsed =
                                        val.trim() === ''
                                            ? null
                                            : Number(val.replace(',', '.'));
                                    scheduleAutoSave(undefined, {
                                        mae:
                                            parsed !== null && Number.isFinite(parsed)
                                                ? Math.abs(parsed)
                                                : null,
                                    });
                                }}
                                placeholder="0.00"
                                className="w-20 bg-transparent text-right font-mono text-danger placeholder:text-fg-subtle focus:outline-none"
                            />
                        </label>

                        <label className="flex items-center justify-between gap-2 bg-canvas-subtle border border-line-subtle rounded-lg px-2.5 py-1.5">
                            <span className="text-[11px] text-fg-muted font-medium">
                                Setup
                            </span>
                            <input
                                type="text"
                                value={setup}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setSetup(val);
                                    scheduleAutoSave(undefined, {
                                        setup: val.trim() || null,
                                    });
                                }}
                                placeholder={isEn ? 'e.g. BOS + FVG' : 'Ex: BOS + FVG'}
                                className="w-28 bg-transparent text-right text-fg placeholder:text-fg-subtle focus:outline-none"
                            />
                        </label>

                        <div className="flex items-center justify-between gap-1 bg-canvas-subtle border border-line-subtle rounded-lg px-2.5 py-1.5">
                            <span className="text-[11px] text-fg-muted font-medium">
                                {isEn ? 'Execution' : 'Execução'}
                            </span>
                            <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <button
                                        key={star}
                                        type="button"
                                        onClick={() => {
                                            const nextRating =
                                                rating === star ? 0 : star;
                                            setRating(nextRating);
                                            void onSave({
                                                ...buildPayload(),
                                                rating: nextRating,
                                            });
                                        }}
                                        className="p-0.5 cursor-pointer"
                                    >
                                        <Star
                                            className={`w-3.5 h-3.5 ${
                                                star <= rating
                                                    ? 'fill-warning text-warning'
                                                    : 'text-fg-subtle'
                                            }`}
                                        />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 4 Questões Sequenciais com Salto Automático na Trade Note */}
                    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-1">
                            {tradeStepIdx !== null ? (
                                (() => {
                                    const activeQ = TRADE_PSYCH_QUESTIONS[tradeStepIdx];
                                    const selectedVal = tradePsychCheck[activeQ.key] || null;
                                    const answeredCount = TRADE_PSYCH_QUESTIONS.filter((q) =>
                                        Boolean(tradePsychCheck[q.key])
                                    ).length;
                                    const rawQuestion = isEn ? activeQ.fullQuestionEn || activeQ.fullQuestion : activeQ.fullQuestion;
                                    const cleanQuestion = rawQuestion.replace(
                                        /^\d+\.\s*/,
                                        ''
                                    );

                                    return (
                                        <>
                                            <div className="inline-flex items-center gap-0.5 text-fg-subtle mr-0.5">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setTradeStepIdx(
                                                            (tradeStepIdx -
                                                                1 +
                                                                TRADE_PSYCH_QUESTIONS.length) %
                                                                TRADE_PSYCH_QUESTIONS.length
                                                        )
                                                    }
                                                    title={isEn ? 'Previous question' : 'Questão anterior'}
                                                    className="p-0.5 rounded hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
                                                >
                                                    <ChevronLeft className="w-3 h-3" />
                                                </button>
                                                <span className="font-mono text-[10px] tabular-nums">
                                                    {tradeStepIdx + 1}/
                                                    {TRADE_PSYCH_QUESTIONS.length}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setTradeStepIdx(
                                                            (tradeStepIdx + 1) %
                                                                TRADE_PSYCH_QUESTIONS.length
                                                        )
                                                    }
                                                    title={isEn ? 'Next question' : 'Próxima questão'}
                                                    className="p-0.5 rounded hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
                                                >
                                                    <ChevronRight className="w-3 h-3" />
                                                </button>
                                            </div>

                                            <span className="font-semibold uppercase tracking-wide text-fg-muted mr-1">
                                                {cleanQuestion}
                                            </span>

                                            {activeQ.options.map((opt) => {
                                                const active = selectedVal === opt.value;
                                                return (
                                                    <button
                                                        key={opt.value}
                                                        type="button"
                                                        onClick={() => {
                                                            const nextVal = active
                                                                ? null
                                                                : opt.value;
                                                            const nextTradePsych: TradePsychCheck =
                                                                {
                                                                    ...tradePsychCheck,
                                                                    [activeQ.key]: nextVal,
                                                                };
                                                            setTradePsychCheck(
                                                                nextTradePsych
                                                            );
                                                            void onSave({
                                                                ...buildPayload(),
                                                                tradePsychCheck:
                                                                    nextTradePsych,
                                                            });

                                                            if (!active) {
                                                                let nextIdx: number | null =
                                                                    null;
                                                                for (
                                                                    let offset = 1;
                                                                    offset <=
                                                                    TRADE_PSYCH_QUESTIONS.length;
                                                                    offset++
                                                                ) {
                                                                    const candidate =
                                                                        (tradeStepIdx +
                                                                            offset) %
                                                                        TRADE_PSYCH_QUESTIONS.length;
                                                                    const candidateKey =
                                                                        TRADE_PSYCH_QUESTIONS[
                                                                            candidate
                                                                        ].key;
                                                                    if (
                                                                        !nextTradePsych[
                                                                            candidateKey
                                                                        ]
                                                                    ) {
                                                                        nextIdx = candidate;
                                                                        break;
                                                                    }
                                                                }
                                                                setTradeStepIdx(nextIdx);
                                                            }
                                                        }}
                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                                                            active
                                                                ? getPsychToneClass(opt.tone)
                                                                : 'bg-canvas-subtle text-fg-muted hover:text-fg border-line-subtle'
                                                        }`}
                                                    >
                                                        <span>{opt.emoji}</span>
                                                        <span>{isEn ? opt.labelEn || opt.value : opt.value}</span>
                                                    </button>
                                                );
                                            })}

                                            {answeredCount > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setTradeStepIdx(null)}
                                                    title={isEn ? 'View check-in summary' : 'Ver resumo das respostas'}
                                                    className="ml-0.5 p-1 rounded text-fg-subtle hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                                                >
                                                    <Check className="w-3 h-3" />
                                                </button>
                                            )}
                                        </>
                                    );
                                })()
                            ) : (
                                TRADE_PSYCH_QUESTIONS.map((q, idx) => {
                                    const selectedVal = tradePsychCheck[q.key] || null;
                                    const selectedOpt = q.options.find(
                                        (o) => o.value === selectedVal
                                    );
                                    const fullQ = isEn ? q.fullQuestionEn || q.fullQuestion : q.fullQuestion;
                                    const shortQ = isEn ? q.shortQuestionEn || q.shortQuestion : q.shortQuestion;
                                    const optText = selectedOpt ? (isEn ? selectedOpt.labelEn || selectedOpt.value : selectedOpt.value) : null;
                                    return (
                                        <button
                                            key={q.key}
                                            type="button"
                                            onClick={() => setTradeStepIdx(idx)}
                                            title={
                                                selectedOpt
                                                    ? (isEn ? `${fullQ} — ${optText} (click to edit)` : `${fullQ} — ${optText} (clique para alterar)`)
                                                    : (isEn ? `${fullQ} (click to log)` : `${fullQ} (clique para responder)`)
                                            }
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                                                selectedOpt
                                                    ? getPsychToneClass(selectedOpt.tone)
                                                    : 'bg-canvas-subtle text-fg-muted hover:text-fg border-line-subtle'
                                            }`}
                                        >
                                            <span>
                                                {selectedOpt ? selectedOpt.emoji : '•'}
                                            </span>
                                            <span>
                                                {shortQ}{' '}
                                                {optText || '—'}
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Barra de Formatação Rica */}
            <div className="mt-3 bg-canvas-subtle border border-line-subtle rounded-lg px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={toggleHeading}
                        className="px-2 py-1 rounded text-xs font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Heading / Subheading (H2)' : 'Título / Subtítulo (H2)'}
                    >
                        Aa
                    </button>
                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={() => execFormat('bold')}
                        className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Bold (Ctrl+B)' : 'Negrito (Ctrl+B)'}
                    >
                        <Bold className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={() => execFormat('italic')}
                        className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Italic (Ctrl+I)' : 'Itálico (Ctrl+I)'}
                    >
                        <Italic className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={() => execFormat('strikeThrough')}
                        className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Strikethrough' : 'Tachado'}
                    >
                        <Strikethrough className="w-3.5 h-3.5" />
                    </button>

                    <span className="h-4 w-px bg-line mx-1" />

                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={() => execFormat('insertUnorderedList')}
                        className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Bulleted List' : 'Lista com marcadores'}
                    >
                        <List className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={() => execFormat('insertOrderedList')}
                        className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Numbered List' : 'Lista numerada'}
                    >
                        <ListOrdered className="w-3.5 h-3.5" />
                    </button>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={() => execFormat('undo')}
                        className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Undo' : 'Desfazer'}
                    >
                        <Undo2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        disabled={isTradeDisabled}
                        onClick={() => execFormat('redo')}
                        className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        title={isEn ? 'Redo' : 'Refazer'}
                    >
                        <Redo2 className="w-3.5 h-3.5" />
                    </button>

                    <span className="h-4 w-px bg-line mx-1" />

                    <div className="relative" ref={templateMenuRef}>
                        <button
                            type="button"
                            disabled={isTradeDisabled}
                            onClick={() => setShowTemplateMenu((prev) => !prev)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-fg hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
                        >
                            <span>Add Template</span>
                            <Plus className="w-3.5 h-3.5" />
                        </button>

                        {showTemplateMenu && (
                            <div className="absolute right-0 mt-1.5 w-64 bg-surface-2 border border-line rounded-xl shadow-lg py-1.5 z-30">
                                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Available Templates' : 'Modelos Disponíveis'}
                                </div>
                                <div className="max-h-60 overflow-y-auto divide-y divide-line-subtle">
                                    {allTemplates.map((tpl) => (
                                        <div
                                            key={tpl.id}
                                            className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-surface-3 transition-colors"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => applyTemplate(tpl)}
                                                className="flex-1 text-left text-xs text-fg truncate cursor-pointer"
                                            >
                                                {isEn ? tpl.titleEn || tpl.title : tpl.title}
                                            </button>
                                            {!tpl.isBuiltIn && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void onDeleteTemplate(tpl.id);
                                                    }}
                                                    className="p-1 text-fg-subtle hover:text-danger rounded"
                                                    title={isEn ? 'Delete saved template' : 'Remover modelo salvo'}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Área Editável */}
            <div className="relative mt-3">
                {isEmpty && !isTradeDisabled && (
                    <div className="pointer-events-none absolute top-3 left-3 text-sm text-fg-subtle select-none">
                        {isEn ? 'Type your notes here... (Ctrl+V to paste BEFORE / AFTER)' : 'Type your notes here... (Ctrl+V para colar ANTES / DEPOIS)'}
                    </div>
                )}

                <div
                    ref={editorRef}
                    contentEditable={!isTradeDisabled}
                    suppressContentEditableWarning
                    onInput={() => {
                        syncEditorEmptyFlag();
                        scheduleAutoSave();
                    }}
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    className={`min-h-[210px] max-h-[380px] overflow-y-auto break-words rounded-lg px-3 py-2.5 text-sm text-fg leading-relaxed focus:outline-none [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-fg [&_h2]:mt-3 [&_h2]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_hr]:border-line-subtle [&_hr]:my-3 [&_img]:mx-auto [&_img]:block [&_img]:max-w-full [&_img]:max-h-[420px] [&_img]:object-contain [&_img]:rounded-xl [&_img]:border [&_img]:border-accent/35 [&_img]:my-3 [&_img]:shadow-lg ${
                        isTradeDisabled ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                />
            </div>

            {/* Inputs ocultos de upload (único para ANTES/DEPOIS individual e múltiplo para Par/Extras) */}
            <input
                ref={singleFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                    if (e.target.files?.length) {
                        void handleFilesUpload(e.target.files);
                        e.target.value = '';
                    }
                }}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                    if (e.target.files?.length) {
                        void handleFilesUpload(e.target.files);
                        e.target.value = '';
                    }
                }}
            />

            {/* =================================================================
                VITRINE CENTRALIZADA & DESTACADA DE IMAGENS ANEXADAS (ANTES / DEPOIS + EXTRAS)
               ================================================================= */}
            <div className="mt-4 pt-4 border-t border-line-subtle flex flex-col items-center">
                {imageNotice && (
                    <div className="w-full max-w-4xl mb-3 px-3 py-2 rounded-xl bg-accent/10 border border-accent/30 text-xs text-fg flex items-center justify-between gap-2">
                        <span>{imageNotice}</span>
                        <button
                            type="button"
                            onClick={() => setImageNotice(null)}
                            className="text-fg-muted hover:text-fg p-0.5 cursor-pointer"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {hasAnyAttachedImage ? (
                    <div className="w-full max-w-5xl mx-auto rounded-2xl border border-accent/40 bg-surface-2/85 ring-1 ring-accent/15 shadow-panel p-4 sm:p-5 space-y-4">
                        {/* Cabeçalho destacado e centralizado/equilibrado */}
                        <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-line-subtle">
                            <div className="flex flex-wrap items-center gap-2 mx-auto sm:mx-0">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-accent/15 text-accent-fg border border-accent/35">
                                    <ImageIcon className="w-3.5 h-3.5" />
                                    <span>{isEn ? 'Attached Charts' : 'Imagens Anexadas'}</span>
                                </span>
                                <span className="text-xs font-semibold text-fg">
                                    {isEn ? 'BEFORE / AFTER' : 'ANTES / DEPOIS'} ({primaryAttachedCount}/2)
                                </span>
                                {imageSlots.extras.length > 0 && (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-3 text-fg-muted border border-line-strong">
                                        +{imageSlots.extras.length} extra
                                        {imageSlots.extras.length > 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center justify-center gap-1.5 mx-auto sm:mx-0">
                                {imageSlots.before && imageSlots.after && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setLightbox({
                                                mode: 'compare',
                                                url: imageSlots.before || '',
                                                label: isEn ? 'BEFORE vs AFTER Comparison' : 'Comparação ANTES vs DEPOIS',
                                            })
                                        }
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-accent/15 hover:bg-accent/25 text-accent-fg border border-accent/35 transition-colors cursor-pointer"
                                        title={isEn ? 'Compare BEFORE and AFTER side by side' : 'Comparar ANTES e DEPOIS lado a lado em tela cheia'}
                                    >
                                        <Columns2 className="w-3.5 h-3.5" />
                                        <span>{isEn ? 'Compare Side by Side' : 'Comparar Lado a Lado'}</span>
                                    </button>
                                )}

                                {(imageSlots.before || imageSlots.after) && (
                                    <button
                                        type="button"
                                        disabled={isTradeDisabled || isUploadingImage}
                                        onClick={() => void handleSwapBeforeAfter()}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-canvas-subtle hover:bg-surface-3 text-fg-muted hover:text-fg border border-line transition-colors disabled:opacity-40 cursor-pointer"
                                        title={isEn ? 'Swap BEFORE and AFTER slots' : 'Inverter posições de ANTES e DEPOIS'}
                                    >
                                        <ArrowLeftRight className="w-3.5 h-3.5" />
                                        <span>{isEn ? 'Swap' : 'Inverter'}</span>
                                    </button>
                                )}

                                <button
                                    type="button"
                                    disabled={isTradeDisabled || isUploadingImage}
                                    onClick={() => openImagePicker({ kind: 'extra' })}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface-3 hover:bg-canvas-subtle text-fg border border-line-strong transition-colors disabled:opacity-40 cursor-pointer"
                                    title={isEn ? 'Attach supplementary chart image' : 'Anexar imagem extra complementar'}
                                >
                                    <Plus className="w-3.5 h-3.5 text-accent" />
                                    <span>{isEn ? 'Extra Chart' : 'Imagem Extra'}</span>
                                </button>
                            </div>
                        </div>

                        {/* Par Principal no Editor: Apenas 2 Slots Centralizados (ANTES | DEPOIS) com Preview Ampliado */}
                        <div className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch justify-items-center">
                            {/* SLOT 1: ANTES */}
                            <div
                                className={`w-full rounded-xl overflow-hidden border-2 transition-all flex flex-col ${
                                    imageSlots.before
                                        ? 'border-data-1/50 bg-canvas ring-1 ring-data-1/20 shadow-lg'
                                        : 'border-dashed border-line-strong bg-canvas-subtle/65 hover:border-data-1/50'
                                }`}
                            >
                                <div className="px-3 py-2 bg-surface/90 border-b border-line-subtle flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-data-1/20 text-fg border border-data-1/45">
                                            {isEn ? '1 · BEFORE' : '1 · ANTES'}
                                        </span>
                                        <span className="text-[11px] text-fg-muted font-medium">
                                            {isEn ? 'Setup / Entry' : 'Setup / Entrada'}
                                        </span>
                                    </div>

                                    {imageSlots.before && (
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setLightbox({
                                                        mode: 'single',
                                                        url: imageSlots.before!,
                                                        label: isEn ? 'BEFORE · Setup / Entry' : 'ANTES · Setup / Entrada',
                                                    })
                                                }
                                                className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-fg border border-line cursor-pointer"
                                                title={isEn ? 'Expand BEFORE chart' : 'Ampliar ANTES'}
                                            >
                                                <ZoomIn className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isTradeDisabled || isUploadingImage}
                                                onClick={() => openImagePicker({ kind: 'before' })}
                                                className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg border border-line cursor-pointer"
                                                title={isEn ? 'Replace BEFORE chart' : 'Substituir imagem ANTES'}
                                            >
                                                <RefreshCw className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isTradeDisabled}
                                                onClick={() => void handleRemoveSlot('before')}
                                                className="p-1.5 rounded-lg bg-surface-2 hover:bg-danger/15 text-danger border border-line hover:border-danger/40 cursor-pointer"
                                                title={isEn ? 'Remove BEFORE chart' : 'Remover imagem ANTES'}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {imageSlots.before ? (
                                    <div
                                        onClick={() =>
                                            setLightbox({
                                                mode: 'single',
                                                url: imageSlots.before!,
                                                label: isEn ? 'BEFORE · Setup / Entry' : 'ANTES · Setup / Entrada',
                                            })
                                        }
                                        className="group relative h-64 sm:h-72 xl:h-80 w-full flex items-center justify-center bg-canvas p-2.5 cursor-zoom-in"
                                    >
                                        <img
                                            src={imageSlots.before}
                                            alt={isEn ? 'BEFORE chart' : 'Gráfico ANTES'}
                                            className="max-h-full max-w-full w-auto h-auto object-contain mx-auto rounded-lg transition-transform duration-200 group-hover:scale-[1.015]"
                                        />
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={isTradeDisabled || isUploadingImage}
                                        onClick={() => openImagePicker({ kind: 'before' })}
                                        className="h-64 sm:h-72 xl:h-80 w-full flex flex-col items-center justify-center gap-2 p-4 text-center text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-40"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-data-1/15 border border-data-1/35 flex items-center justify-center text-fg">
                                            <ImagePlus className="w-4 h-4" />
                                        </div>
                                        <span className="text-xs font-semibold text-fg">
                                            {isEn ? 'Upload BEFORE Chart' : 'Importar imagem ANTES'}
                                        </span>
                                        <span className="text-[11px] text-fg-subtle max-w-[210px]">
                                            {isEn ? 'Click to attach pre-entry structure or setup trigger chart' : 'Clique para anexar o gráfico pré-operação ou gatilho de entrada'}
                                        </span>
                                    </button>
                                )}
                            </div>

                            {/* SLOT 2: DEPOIS */}
                            <div
                                className={`w-full rounded-xl overflow-hidden border-2 transition-all flex flex-col ${
                                    imageSlots.after
                                        ? 'border-accent/50 bg-canvas ring-1 ring-accent/20 shadow-lg'
                                        : 'border-dashed border-line-strong bg-canvas-subtle/65 hover:border-accent/50'
                                }`}
                            >
                                <div className="px-3 py-2 bg-surface/90 border-b border-line-subtle flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent-fg border border-accent/45">
                                            {isEn ? '2 · AFTER' : '2 · DEPOIS'}
                                        </span>
                                        <span className="text-[11px] text-fg-muted font-medium">
                                            {isEn ? 'Exit / Outcome' : 'Saída / Resultado'}
                                        </span>
                                    </div>

                                    {imageSlots.after && (
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setLightbox({
                                                        mode: 'single',
                                                        url: imageSlots.after!,
                                                        label: isEn ? 'AFTER · Exit / Outcome' : 'DEPOIS · Saída / Resultado',
                                                    })
                                                }
                                                className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-fg border border-line cursor-pointer"
                                                title={isEn ? 'Expand AFTER chart' : 'Ampliar DEPOIS'}
                                            >
                                                <ZoomIn className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isTradeDisabled || isUploadingImage}
                                                onClick={() => openImagePicker({ kind: 'after' })}
                                                className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg border border-line cursor-pointer"
                                                title={isEn ? 'Replace AFTER chart' : 'Substituir imagem DEPOIS'}
                                            >
                                                <RefreshCw className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isTradeDisabled}
                                                onClick={() => void handleRemoveSlot('after')}
                                                className="p-1.5 rounded-lg bg-surface-2 hover:bg-danger/15 text-danger border border-line hover:border-danger/40 cursor-pointer"
                                                title={isEn ? 'Remove AFTER chart' : 'Remover imagem DEPOIS'}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {imageSlots.after ? (
                                    <div
                                        onClick={() =>
                                            setLightbox({
                                                mode: 'single',
                                                url: imageSlots.after!,
                                                label: isEn ? 'AFTER · Exit / Outcome' : 'DEPOIS · Saída / Resultado',
                                            })
                                        }
                                        className="group relative h-64 sm:h-72 xl:h-80 w-full flex items-center justify-center bg-canvas p-2.5 cursor-zoom-in"
                                    >
                                        <img
                                            src={imageSlots.after}
                                            alt={isEn ? 'AFTER chart' : 'Gráfico DEPOIS'}
                                            className="max-h-full max-w-full w-auto h-auto object-contain mx-auto rounded-lg transition-transform duration-200 group-hover:scale-[1.015]"
                                        />
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={isTradeDisabled || isUploadingImage}
                                        onClick={() => openImagePicker({ kind: 'after' })}
                                        className="h-64 sm:h-72 xl:h-80 w-full flex flex-col items-center justify-center gap-2 p-4 text-center text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-40"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-accent/15 border border-accent/35 flex items-center justify-center text-accent-fg">
                                            <ImagePlus className="w-4 h-4" />
                                        </div>
                                        <span className="text-xs font-semibold text-fg">
                                            {isEn ? 'Upload AFTER Chart' : 'Importar imagem DEPOIS'}
                                        </span>
                                        <span className="text-[11px] text-fg-subtle max-w-[210px]">
                                            {isEn ? 'Click to attach trade outcome and post-exit follow-through' : 'Clique para anexar o desfecho e gestão pós-execução'}
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Seção Opcional de Imagens Extras (Centralizada) */}
                        {(imageSlots.extras.length > 0 || showExtrasPanel) && (
                            <div className="w-full max-w-4xl mx-auto pt-3.5 border-t border-line-subtle space-y-3">
                                <div className="flex flex-wrap items-center justify-center sm:justify-between gap-2">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                                        {isEn ? `Additional Supporting Charts (${imageSlots.extras.length})` : `Imagens Extras Complementares (${imageSlots.extras.length})`}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={isTradeDisabled || isUploadingImage}
                                        onClick={() => openImagePicker({ kind: 'extra' })}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-canvas-subtle hover:bg-surface-3 text-fg border border-line transition-colors cursor-pointer"
                                    >
                                        <ImagePlus className="w-3.5 h-3.5 text-accent" />
                                        <span>{isEn ? 'Add Extra' : 'Adicionar Extra'}</span>
                                    </button>
                                </div>

                                <div className="flex flex-wrap items-stretch justify-center gap-4">
                                    {imageSlots.extras.map((extraUrl, idx) => (
                                        <div
                                            key={`${extraUrl}-${idx}`}
                                            className="w-full sm:w-[300px] md:w-[320px] rounded-xl overflow-hidden border border-line-strong bg-canvas shadow-md flex flex-col"
                                        >
                                            <div className="px-2.5 py-1.5 bg-surface/90 border-b border-line-subtle flex items-center justify-between gap-1.5">
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-surface-3 text-fg-muted border border-line">
                                                    EXTRA #{idx + 1}
                                                </span>

                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void handlePromoteExtra(idx, 'before')
                                                        }
                                                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-2 hover:bg-data-1/20 text-fg-muted hover:text-fg border border-line cursor-pointer"
                                                        title={isEn ? 'Set as BEFORE' : 'Definir como ANTES'}
                                                    >
                                                        {isEn ? '→ BEFORE' : '→ ANTES'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void handlePromoteExtra(idx, 'after')
                                                        }
                                                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-2 hover:bg-accent/20 text-fg-muted hover:text-accent-fg border border-line cursor-pointer"
                                                        title={isEn ? 'Set as AFTER' : 'Definir como DEPOIS'}
                                                    >
                                                        {isEn ? '→ AFTER' : '→ DEPOIS'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setLightbox({
                                                                mode: 'single',
                                                                url: extraUrl,
                                                                label: `EXTRA #${idx + 1}`,
                                                            })
                                                        }
                                                        className="p-1 rounded bg-surface-2 hover:bg-surface-3 text-fg border border-line cursor-pointer"
                                                        title={isEn ? 'Expand extra chart' : 'Ampliar imagem extra'}
                                                    >
                                                        <ZoomIn className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void handleRemoveSlot({ extraIdx: idx })
                                                        }
                                                        className="p-1 rounded bg-surface-2 hover:bg-danger/15 text-danger border border-line cursor-pointer"
                                                        title={isEn ? 'Remove extra chart' : 'Remover imagem extra'}
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div
                                                onClick={() =>
                                                    setLightbox({
                                                        mode: 'single',
                                                        url: extraUrl,
                                                        label: `EXTRA #${idx + 1}`,
                                                    })
                                                }
                                                className="group h-48 sm:h-52 w-full flex items-center justify-center bg-canvas p-2 cursor-zoom-in"
                                            >
                                                <img
                                                    src={extraUrl}
                                                    alt={`Extra ${idx + 1}`}
                                                    className="max-h-full max-w-full w-auto h-auto object-contain mx-auto rounded-lg transition-transform duration-200 group-hover:scale-[1.015]"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {isUploadingImage && (
                            <div className="flex items-center justify-center gap-2 text-xs text-accent-fg pt-1">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>{isEn ? 'Processing and attaching chart...' : 'Processando e anexando imagem...'}</span>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Estado Vazio Centralizado nos Editores: Importação ANTES / DEPOIS (2 imagens) + opção Extra */
                    <div className="w-full max-w-3xl mx-auto rounded-2xl border border-dashed border-line-strong bg-canvas-subtle/50 p-4 space-y-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent/10 text-accent-fg border border-accent/25">
                                <ImageIcon className="w-3 h-3" />
                                <span>{isEn ? 'Chart Evidence · BEFORE & AFTER' : 'Evidências Visuais · ANTES & DEPOIS'}</span>
                            </span>
                            <p className="text-xs text-fg-muted">
                                {isEn ? (
                                    <>Upload the <strong className="text-fg">2 core charts (BEFORE and AFTER)</strong> or attach supplementary screenshots.</>
                                ) : (
                                    <>Importe as <strong className="text-fg">2 imagens principais (ANTES e DEPOIS)</strong> no editor ou anexe imagens extras de apoio.</>
                                )}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
                            <button
                                type="button"
                                disabled={isUploadingImage || isTradeDisabled}
                                onClick={() => openImagePicker({ kind: 'before' })}
                                className="py-3.5 px-4 rounded-xl border border-dashed border-data-1/40 hover:border-data-1 bg-surface/70 hover:bg-surface-2 transition-all flex flex-col items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                            >
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-data-1/15 text-fg border border-data-1/35">
                                    {isEn ? '1 · BEFORE' : '1 · ANTES'}
                                </span>
                                <span className="text-xs font-semibold text-fg flex items-center gap-1.5">
                                    <ImagePlus className="w-3.5 h-3.5 text-data-1" />
                                    <span>{isEn ? 'Upload BEFORE' : 'Importar ANTES'}</span>
                                </span>
                                <span className="text-[11px] text-fg-subtle">
                                    {isEn ? 'Pre-Trade Context / Setup Trigger' : 'Contexto / Gatilho de Entrada'}
                                </span>
                            </button>

                            <button
                                type="button"
                                disabled={isUploadingImage || isTradeDisabled}
                                onClick={() => openImagePicker({ kind: 'after' })}
                                className="py-3.5 px-4 rounded-xl border border-dashed border-accent/40 hover:border-accent bg-surface/70 hover:bg-surface-2 transition-all flex flex-col items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                            >
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-accent/15 text-accent-fg border border-accent/35">
                                    {isEn ? '2 · AFTER' : '2 · DEPOIS'}
                                </span>
                                <span className="text-xs font-semibold text-fg flex items-center gap-1.5">
                                    <ImagePlus className="w-3.5 h-3.5 text-accent" />
                                    <span>{isEn ? 'Upload AFTER' : 'Importar DEPOIS'}</span>
                                </span>
                                <span className="text-[11px] text-fg-subtle">
                                    {isEn ? 'Execution / Trade Exit Outcome' : 'Execução / Saída da Operação'}
                                </span>
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                            <button
                                type="button"
                                disabled={isUploadingImage || isTradeDisabled}
                                onClick={() => openImagePicker({ kind: 'pair' })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 hover:bg-surface-3 text-fg border border-line-strong transition-colors disabled:opacity-40 cursor-pointer"
                            >
                                {isUploadingImage ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                                        <span>{isEn ? 'Uploading...' : 'Enviando...'}</span>
                                    </>
                                ) : (
                                    <>
                                        <Columns2 className="w-3.5 h-3.5 text-accent" />
                                        <span>{isEn ? 'Select BEFORE & AFTER (2 charts)' : 'Selecionar ANTES & DEPOIS (2 imagens)'}</span>
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                disabled={isUploadingImage || isTradeDisabled}
                                onClick={() => openImagePicker({ kind: 'extra' })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent hover:border-line transition-colors disabled:opacity-40 cursor-pointer"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                <span>{isEn ? 'Allow Extra' : 'Permitir Extra'}</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Rodapé do Editor: Save as New Template */}
            <div className="mt-3 pt-3 border-t border-line-subtle flex items-center justify-center sm:justify-start">
                {!showNewTemplateBar ? (
                    <button
                        type="button"
                        disabled={isEmpty || isTradeDisabled}
                        onClick={() => setShowNewTemplateBar(true)}
                        className="inline-flex items-center gap-2 text-xs font-medium text-fg-muted hover:text-fg transition-colors disabled:opacity-40 cursor-pointer"
                    >
                        <BookmarkPlus className="w-4 h-4" />
                        <span>Save as New Template</span>
                    </button>
                ) : (
                    <div className="w-full flex flex-wrap items-center gap-2 bg-canvas-subtle border border-line-subtle rounded-lg p-2">
                        <input
                            type="text"
                            value={newTemplateName}
                            onChange={(e) => setNewTemplateName(e.target.value)}
                            placeholder={isEn ? 'New template name (e.g. London SMC Checklist)...' : 'Nome do novo modelo (ex: Checklist SMC Londres)...'}
                            className="flex-1 min-w-[200px] bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none px-1.5"
                        />
                        <button
                            type="button"
                            disabled={savingTemplate || !newTemplateName.trim()}
                            onClick={() => void handleConfirmSaveTemplate()}
                            className="px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-accent-on disabled:opacity-40 cursor-pointer"
                        >
                            {savingTemplate ? (isEn ? 'Saving...' : 'Salvando...') : (isEn ? 'Confirm' : 'Confirmar')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setShowNewTemplateBar(false);
                                setNewTemplateName('');
                            }}
                            className="px-2 py-1 rounded-md text-xs text-fg-muted hover:text-fg cursor-pointer"
                        >
                            {isEn ? 'Cancel' : 'Cancelar'}
                        </button>
                    </div>
                )}
            </div>

            {/* Lightbox Ampliado & Comparador ANTES vs DEPOIS */}
            {lightbox && (
                <div
                    className="fixed inset-0 z-50 bg-canvas/90 backdrop-blur-md flex items-center justify-center p-4"
                    onClick={() => setLightbox(null)}
                >
                    <div
                        className="relative w-full max-w-6xl max-h-[92vh] bg-surface border border-line-strong rounded-2xl overflow-hidden shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 bg-surface-2 border-b border-line flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-accent/15 text-accent-fg border border-accent/35">
                                    {lightbox.mode === 'compare'
                                        ? (isEn ? 'BEFORE vs AFTER Comparison' : 'Comparação ANTES vs DEPOIS')
                                        : lightbox.label}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                {imageSlots.before && imageSlots.after && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setLightbox((prev) =>
                                                prev?.mode === 'compare'
                                                    ? {
                                                          mode: 'single',
                                                          url: imageSlots.before!,
                                                          label: isEn ? 'BEFORE · Setup / Entry' : 'ANTES · Setup / Entrada',
                                                      }
                                                    : {
                                                          mode: 'compare',
                                                          url: imageSlots.before!,
                                                          label: isEn ? 'BEFORE vs AFTER Comparison' : 'Comparação ANTES vs DEPOIS',
                                                      }
                                            )
                                        }
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-canvas-subtle hover:bg-surface-3 text-fg border border-line cursor-pointer"
                                    >
                                        <Columns2 className="w-3.5 h-3.5 text-accent" />
                                        <span>
                                            {lightbox.mode === 'compare'
                                                ? (isEn ? 'Single View' : 'Visão Individual')
                                                : (isEn ? 'Compare Side by Side' : 'Comparar Lado a Lado')}
                                        </span>
                                    </button>
                                )}

                                <button
                                    type="button"
                                    onClick={() => setLightbox(null)}
                                    className="p-1.5 rounded-lg bg-surface-3 text-fg border border-line hover:border-line-strong cursor-pointer"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {lightbox.mode === 'compare' && imageSlots.before && imageSlots.after ? (
                            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto max-h-[84vh] bg-canvas">
                                <div className="rounded-xl border border-data-1/45 bg-surface/40 p-2.5 flex flex-col items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-data-1/20 text-fg border border-data-1/40">
                                        {isEn ? '1 · BEFORE' : '1 · ANTES'}
                                    </span>
                                    <img
                                        src={imageSlots.before}
                                        alt={isEn ? 'BEFORE expanded' : 'ANTES ampliado'}
                                        className="max-h-[72vh] w-auto max-w-full object-contain mx-auto rounded-lg"
                                    />
                                </div>
                                <div className="rounded-xl border border-accent/45 bg-surface/40 p-2.5 flex flex-col items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-accent/20 text-accent-fg border border-accent/40">
                                        {isEn ? '2 · AFTER' : '2 · DEPOIS'}
                                    </span>
                                    <img
                                        src={imageSlots.after}
                                        alt={isEn ? 'AFTER expanded' : 'DEPOIS ampliado'}
                                        className="max-h-[72vh] w-auto max-w-full object-contain mx-auto rounded-lg"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 flex items-center justify-center bg-canvas overflow-auto max-h-[84vh]">
                                <img
                                    src={lightbox.url}
                                    alt={lightbox.label}
                                    className="max-h-[78vh] max-w-full w-auto object-contain mx-auto rounded-lg"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
