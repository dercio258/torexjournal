import type { ReplayOrder } from '../../schemas/backtestContracts';

export interface PreviewEntryDragResult {
    valid: boolean;
    limitEntryPrice?: number;
    orderType?: 'LIMIT' | 'STOP';
    stopLoss?: number;
    takeProfit?: number;
    reason?: string;
}

export interface PreviewSlDragResult {
    valid: boolean;
    slDistancePct?: number;
    stopLoss?: number;
    reason?: string;
}

export interface PreviewTpDragResult {
    valid: boolean;
    rrTarget?: number;
    takeProfit?: number;
    reason?: string;
}

export interface OrderQuickTagPatch {
    rating?: number | null;
    setup?: string;
    journalContent?: string;
    psychCheck?: ReplayOrder['psychCheck'];
}

export function inferPendingOrderTypeFromEntry(
    nextEntryPrice: number,
    referencePrice: number,
    orderSide: 'BUY' | 'SELL'
): 'LIMIT' | 'STOP' {
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
        return 'LIMIT';
    }
    if (orderSide === 'BUY') {
        return nextEntryPrice > referencePrice ? 'STOP' : 'LIMIT';
    }
    return nextEntryPrice < referencePrice ? 'STOP' : 'LIMIT';
}

export function applyPreviewEntryDrag(params: {
    nextEntryPrice: number;
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    orderSide: 'BUY' | 'SELL';
    referencePrice: number;
    slDistancePct: number;
    rrTarget: number;
}): PreviewEntryDragResult {
    const { nextEntryPrice, orderType, orderSide, referencePrice, slDistancePct, rrTarget } = params;
    if (!Number.isFinite(nextEntryPrice) || nextEntryPrice <= 0) {
        return { valid: false, reason: 'Preço de entrada inválido' };
    }
    const safeSlPct = Number.isFinite(slDistancePct) && slDistancePct > 0 ? slDistancePct : 0.35;
    const safeRr = Number.isFinite(rrTarget) && rrTarget > 0 ? rrTarget : 2.0;

    const resolvedOrderType: 'LIMIT' | 'STOP' =
        orderType === 'MARKET'
            ? inferPendingOrderTypeFromEntry(nextEntryPrice, referencePrice, orderSide)
            : inferPendingOrderTypeFromEntry(nextEntryPrice, referencePrice, orderSide);

    const slDistanceAbs = nextEntryPrice * (safeSlPct / 100);
    const tpDistanceAbs = slDistanceAbs * safeRr;
    const stopLoss = orderSide === 'BUY' ? nextEntryPrice - slDistanceAbs : nextEntryPrice + slDistanceAbs;
    const takeProfit = orderSide === 'BUY' ? nextEntryPrice + tpDistanceAbs : nextEntryPrice - tpDistanceAbs;

    if (stopLoss <= 0 || takeProfit <= 0) {
        return { valid: false, reason: 'Stop Loss ou Take Profit resultou em preço não positivo' };
    }

    return {
        valid: true,
        limitEntryPrice: nextEntryPrice,
        orderType: resolvedOrderType,
        stopLoss,
        takeProfit,
    };
}

export function applyPreviewSlDrag(params: {
    nextSlPrice: number;
    entryPrice: number;
    orderSide: 'BUY' | 'SELL';
}): PreviewSlDragResult {
    const { nextSlPrice, entryPrice, orderSide } = params;
    if (!Number.isFinite(nextSlPrice) || nextSlPrice <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
        return { valid: false, reason: 'Preço de Stop Loss inválido' };
    }

    const validSide = orderSide === 'BUY' ? nextSlPrice < entryPrice : nextSlPrice > entryPrice;
    if (!validSide) {
        return {
            valid: false,
            reason:
                orderSide === 'BUY'
                    ? 'Stop Loss de compra deve ficar abaixo do preço de entrada'
                    : 'Stop Loss de venda deve ficar acima do preço de entrada',
        };
    }

    const rawPct = (Math.abs(entryPrice - nextSlPrice) / entryPrice) * 100;
    const clampedPct = Number(Math.max(0.01, Math.min(25, rawPct)).toFixed(4));
    const finalSl =
        orderSide === 'BUY'
            ? entryPrice * (1 - clampedPct / 100)
            : entryPrice * (1 + clampedPct / 100);

    return {
        valid: true,
        slDistancePct: clampedPct,
        stopLoss: finalSl,
    };
}

export function applyPreviewTpDrag(params: {
    nextTpPrice: number;
    entryPrice: number;
    stopLoss: number;
    orderSide: 'BUY' | 'SELL';
}): PreviewTpDragResult {
    const { nextTpPrice, entryPrice, stopLoss, orderSide } = params;
    if (
        !Number.isFinite(nextTpPrice) ||
        nextTpPrice <= 0 ||
        !Number.isFinite(entryPrice) ||
        entryPrice <= 0 ||
        !Number.isFinite(stopLoss) ||
        stopLoss <= 0
    ) {
        return { valid: false, reason: 'Preço de Take Profit inválido' };
    }

    const validSide = orderSide === 'BUY' ? nextTpPrice > entryPrice : nextTpPrice < entryPrice;
    if (!validSide) {
        return {
            valid: false,
            reason:
                orderSide === 'BUY'
                    ? 'Take Profit de compra deve ficar acima do preço de entrada'
                    : 'Take Profit de venda deve ficar abaixo do preço de entrada',
        };
    }

    const slDistanceAbs = Math.abs(entryPrice - stopLoss);
    if (slDistanceAbs <= 0) {
        return { valid: false, reason: 'Distância de Stop Loss zero' };
    }

    const rawRr = Math.abs(nextTpPrice - entryPrice) / slDistanceAbs;
    const clampedRr = Number(Math.max(0.1, Math.min(25, rawRr)).toFixed(2));
    const finalTp =
        orderSide === 'BUY'
            ? entryPrice + slDistanceAbs * clampedRr
            : entryPrice - slDistanceAbs * clampedRr;

    return {
        valid: true,
        rrTarget: clampedRr,
        takeProfit: finalTp,
    };
}

export function applyOrderQuickTagPatch(order: ReplayOrder, patch: OrderQuickTagPatch): ReplayOrder {
    const nextRating =
        patch.rating === null
            ? undefined
            : typeof patch.rating === 'number' && Number.isFinite(patch.rating)
              ? Math.max(1, Math.min(5, Math.round(patch.rating)))
              : order.rating;

    const nextSetup =
        patch.setup !== undefined
            ? patch.setup.trim() || undefined
            : order.setup;

    const nextJournalContent =
        patch.journalContent !== undefined
            ? patch.journalContent
            : order.journalContent;

    const mergedPsych =
        patch.psychCheck !== undefined
            ? {
                  ...(order.psychCheck || {}),
                  ...patch.psychCheck,
              }
            : order.psychCheck;

    const cleanPsych =
        mergedPsych && Object.values(mergedPsych).some((v) => v !== undefined)
            ? mergedPsych
            : undefined;

    return {
        ...order,
        rating: nextRating,
        setup: nextSetup,
        journalContent: nextJournalContent,
        psychCheck: cleanPsych,
    };
}
