from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrderSide(StrEnum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"


class OrderStatus(StrEnum):
    PENDING = "PENDING"
    OPEN = "OPEN"
    WIN = "WIN"
    LOSS = "LOSS"
    CANCELLED = "CANCELLED"
    CLOSED = "CLOSED"


class ExitReason(StrEnum):
    TP = "TP"
    SL = "SL"
    MANUAL = "MANUAL"


class OrderPsychCheck(BaseModel):
    model_config = ConfigDict(extra="allow")

    feeling: Optional[str] = Field(default=None, max_length=240)
    followingPlan: Optional[str] = Field(default=None, max_length=240)
    entryDriver: Optional[str] = Field(default=None, max_length=240)
    riskComfort: Optional[str] = Field(default=None, max_length=240)


class ReplayOrderModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str = Field(min_length=1)
    symbol: str = Field(min_length=1)
    side: OrderSide
    orderType: OrderType = OrderType.MARKET
    entryPrice: float = Field(ge=0)
    stopLoss: float = Field(default=0.0, ge=0)
    initialStopLoss: Optional[float] = Field(default=None, ge=0)
    takeProfit: float = Field(default=0.0, ge=0)
    lots: float = Field(default=0.01, gt=0)
    riskAmount: float = Field(default=0.0, ge=0)
    rrRatio: float = Field(default=1.0, ge=0)
    spread: Optional[float] = Field(default=0.0, ge=0)
    commission: Optional[float] = Field(default=0.0, ge=0)
    parentOrderId: Optional[str] = Field(default=None, max_length=96)
    isPartialClose: Optional[bool] = None
    status: OrderStatus = OrderStatus.CLOSED
    exitPrice: Optional[float] = None
    exitReason: Optional[ExitReason] = None
    pnl: float = 0.0
    rMultiple: Optional[float] = None
    mfe: Optional[float] = 0.0
    mae: Optional[float] = 0.0
    openedAt: float
    filledAt: Optional[float] = None
    closedAt: Optional[float] = None
    cancelledAt: Optional[float] = None
    manualCloseAt: Optional[float] = None
    manualClosePrice: Optional[float] = None
    slModifiedAt: Optional[float] = None
    isImportedTrade: Optional[bool] = None
    historicalExitPrice: Optional[float] = None
    historicalClosedAt: Optional[float] = None
    historicalPnl: Optional[float] = None
    historicalExitReason: Optional[ExitReason] = None
    journalContent: Optional[str] = None
    journalImages: Optional[list[str]] = None
    setup: Optional[str] = None
    rating: Optional[float] = Field(default=None, ge=0, le=5)
    psychCheck: Optional[OrderPsychCheck] = None

    @field_validator("mfe", "mae", mode="before")
    @classmethod
    def coerce_non_negative_excursion(cls, v: Any) -> float:
        if v is None:
            return 0.0
        try:
            num = float(v)
            if not (num == num):
                return 0.0
            return abs(num)
        except (TypeError, ValueError):
            return 0.0

    @field_validator("psychCheck", mode="before")
    @classmethod
    def coerce_psych_check(cls, v: Any) -> Optional[dict[str, Any]]:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            return {"feeling": v.strip()[:240]}
        if isinstance(v, dict):
            return v
        return None


class CandleBar(BaseModel):
    timestamp: int = Field(gt=0)
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(default=0.0, ge=0)


class OrderIntentInput(BaseModel):
    symbol: str = Field(default="XAUUSD", min_length=1)
    side: OrderSide
    orderType: OrderType = OrderType.MARKET
    bid: float = Field(gt=0)
    requestedPrice: Optional[float] = Field(default=None, gt=0)
    balance: float = Field(gt=0)
    riskPercent: float = Field(ge=0.05, le=50.0)
    slDistancePct: float = Field(ge=0.01, le=25.0)
    rrTarget: float = Field(ge=0.1, le=50.0)
    spread: float = Field(default=0.0, ge=0.0)
    commission: float = Field(default=0.0, ge=0.0)
    decimals: int = Field(default=2, ge=0, le=8)


class InstrumentContractSpec(BaseModel):
    assetClass: Literal["FOREX", "METAL", "INDEX", "CRYPTO", "STOCK"]
    contractSize: float
    unitLabel: str
    pipSize: float


class MarketExecutionPreview(BaseModel):
    valid: bool
    validationError: Optional[str] = None
    executionHint: Optional[str] = None
    immediateFillExpected: bool
    bid: float
    ask: float
    spreadPrice: float
    entryPrice: float
    stopLoss: float
    takeProfit: float
    slDistancePrice: float
    tpDistancePrice: float
    pipsAtRisk: float
    lots: float
    unitLabel: str
    riskAmount: float
    grossRewardAtTp: float
    netRewardAtTp: float
    netLossAtSl: float
    effectiveRr: float


class ReplayStatsModel(BaseModel):
    trades: int
    wins: int
    losses: int
    winRate: float
    grossProfit: float
    grossLoss: float
    profitFactor: Optional[float] = None
    netProfit: float
    expectancy: float
    avgR: float
    maxDrawdown: float
    maxDrawdownPct: float
    realizedBalance: float


class QuantAnalyticsReport(BaseModel):
    closedTrades: int
    winRatePct: float
    payoffRatio: float
    profitFactor: float
    expectancyUsd: float
    expectancyR: float
    sharpeRatio: float
    sortinoRatio: float
    calmarRatio: float
    sqn: float
    sqnLabel: str
    kellyFullPct: float
    kellyHalfPct: float
    riskOfRuinPct: float
    zScoreStreaks: float
    maxConsecutiveWins: int
    maxConsecutiveLosses: int
    consistencyScore: float
    maxDrawdownUsd: float
    maxDrawdownPct: float
    valueAtRisk95Pct: float
    equityCurve: list[float]
    smartRecommendation: str


class ReconcileSessionRequest(BaseModel):
    orders: list[dict[str, Any]] = Field(default_factory=list)
    initialBalance: float = Field(default=100000.0, gt=0)
    bars: Optional[list[CandleBar]] = None
    symbol: Optional[str] = None
    uptoTs: Optional[int] = None
    rewind: bool = False
    locale: str = "pt"


class ReconcileSessionResponse(BaseModel):
    orders: list[dict[str, Any]]
    stats: ReplayStatsModel
    quantMetrics: QuantAnalyticsReport
    precisionMode: str = "DECIMAL_FIXED_2"


class WhatIfTradeInput(BaseModel):
    id: Optional[str] = None
    ticket: Optional[str | int] = None
    symbol: str = "XAUUSD"
    type: Optional[str] = "BUY"
    profit: float = 0.0
    commission: Optional[float] = 0.0
    swap: Optional[float] = 0.0
    netPnl: Optional[float] = None
    closeTime: Optional[str] = None
    session: Optional[str] = None


class WhatIfRequest(BaseModel):
    trades: list[WhatIfTradeInput] = Field(default_factory=list)
    initialBalance: float = Field(default=10000.0, gt=0)
    riskPerTrade: float = Field(default=1.0, gt=0, le=50.0)
    rrTarget: float = Field(default=2.0, gt=0, le=50.0)
    excludeAsian: bool = False
    excludeFridays: bool = False
    accountName: str = "Conta"
    accountCurrency: str = "USD"
    locale: str = "pt"


class MonteCarloRequest(BaseModel):
    capital: float = Field(default=10000.0, gt=0)
    riskPct: float = Field(default=1.0, gt=0, le=50.0)
    rr: float = Field(default=2.0, gt=0, le=50.0)
    winRatePct: float = Field(default=45.0, ge=0.0, le=100.0)
    trades: int = Field(default=100, ge=1, le=5000)
    sizing: Literal["fixed", "compound"] = "fixed"
    ruinPct: float = Field(default=20.0, ge=1.0, le=100.0)
    runs: int = Field(default=2000, ge=100, le=10000)
    seed: int = 42
    spreadSlippageR: float = Field(default=0.0, ge=0.0, le=0.5)
    commissionPerTrade: float = Field(default=0.0, ge=0.0)


DataModeOption = Literal["SYNTHETIC", "REAL", "AUTO"]
SessionFilterOption = Literal["ALL", "LONDON_NY", "LONDON_ONLY", "NY_ONLY", "NO_ASIA"]
StrategyFamily = Literal["EMA_CROSS_RSI", "SMC_DONCHIAN_ATR", "BOLLINGER_MEAN_REV"]


class MarketDataSyncRequest(BaseModel):
    symbol: str = Field(default="XAUUSD", min_length=1)
    timeframe: str = Field(default="15m", min_length=1)
    barsCount: int = Field(default=3000, ge=100, le=25000)
    sourcePreference: Literal["AUTO", "BINANCE", "YAHOO", "MT5_TV"] = "AUTO"
    candles: Optional[list[CandleBar]] = None
    forceRefresh: bool = False


class ParquetDatasetEntry(BaseModel):
    symbol: str
    timeframe: str
    source: str
    isRealMarket: bool
    barsCount: int
    fromTimestamp: int
    toTimestamp: int
    fileSizeBytes: int
    updatedAtIso: str
    filePath: str


class MarketDataCatalogResponse(BaseModel):
    datasets: list[ParquetDatasetEntry]
    totalDatasets: int
    realDatasetsCount: int
    totalBars: int


class MarketDataSyncResponse(BaseModel):
    status: str = "ok"
    symbol: str
    timeframe: str
    source: str
    isRealMarket: bool
    barsCount: int
    fromTimestamp: int
    toTimestamp: int
    filePath: str
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    message: str


class RealisticVerificationSummary(BaseModel):
    engine: str = "Realistic Bar-by-Bar Event Simulator"
    totalTrades: int
    winRatePct: float
    profitFactor: float
    totalReturnPct: float
    maxDrawdownPct: float
    sharpe: float
    netPnlUsd: float
    totalSpreadCostUsd: float
    totalSlippageCostUsd: float
    totalCommissionCostUsd: float
    totalFrictionUsd: float
    signalsGenerated: int
    signalsFilteredBySession: int
    avgMfeR: float
    avgMaeR: float
    expectancyR: float
    verdict: str


class RealisticSimRequest(BaseModel):
    symbol: str = Field(default="XAUUSD", min_length=1)
    timeframe: str = Field(default="15m", min_length=1)
    barsCount: int = Field(default=3000, ge=300, le=25000)
    strategyFamily: StrategyFamily = "SMC_DONCHIAN_ATR"
    fastPeriod: int = Field(default=14, ge=3, le=100)
    slowPeriod: int = Field(default=55, ge=10, le=250)
    rrTarget: float = Field(default=2.2, ge=0.5, le=10.0)
    slAtrMult: float = Field(default=1.5, ge=0.4, le=8.0)
    rsiThreshold: float = Field(default=52.0, ge=25.0, le=80.0)
    initialCapital: float = Field(default=100000.0, gt=0)
    riskPct: float = Field(default=1.0, ge=0.1, le=10.0)
    spreadPct: float = Field(default=0.00015, ge=0.0, le=0.02)
    commissionPct: float = Field(default=0.00007, ge=0.0, le=0.01)
    slippageBps: float = Field(default=1.5, ge=0.0, le=50.0)
    sessionFilter: SessionFilterOption = "ALL"
    avoidFridayLate: bool = False
    dataMode: DataModeOption = "AUTO"
    locale: str = "pt"


class RealisticSimResponse(BaseModel):
    summary: RealisticVerificationSummary
    dataSourceUsed: str
    isRealMarketData: bool
    sessionFilter: SessionFilterOption
    equityCurve: list[dict[str, Any]]
    orders: list[dict[str, Any]]
    tearsheet: dict[str, Any]


class TearSheetRequest(BaseModel):
    orders: list[dict[str, Any]] = Field(default_factory=list)
    initialBalance: float = Field(default=100000.0, gt=0)
    symbol: str = Field(default="XAUUSD")
    locale: str = "pt"


class VectorSweepRequest(BaseModel):
    symbol: str = Field(default="XAUUSD", min_length=1)
    timeframe: str = Field(default="15m", min_length=1)
    barsCount: int = Field(default=5000, ge=300, le=25000)
    strategyFamily: StrategyFamily = "SMC_DONCHIAN_ATR"
    fastValues: list[int] = Field(default_factory=lambda: [8, 12, 16, 20, 26, 34])
    slowValues: list[int] = Field(default_factory=lambda: [30, 42, 55, 70, 90, 120])
    rrValues: list[float] = Field(default_factory=lambda: [1.5, 2.0, 2.5, 3.0, 3.5])
    slAtrValues: list[float] = Field(default_factory=lambda: [1.0, 1.5, 2.0, 2.5])
    rsiThreshold: float = Field(default=52.0, ge=25.0, le=80.0)
    initialCapital: float = Field(default=100000.0, gt=0)
    riskPct: float = Field(default=1.0, ge=0.1, le=10.0)
    spreadPct: float = Field(default=0.00015, ge=0.0, le=0.02)
    commissionPct: float = Field(default=0.00007, ge=0.0, le=0.01)
    slippageBps: float = Field(default=1.0, ge=0.0, le=50.0)
    sessionFilter: SessionFilterOption = "ALL"
    avoidFridayLate: bool = False
    dataMode: DataModeOption = "AUTO"
    topK: int = Field(default=12, ge=3, le=50)
    locale: str = "pt"


class VectorSweepConfigRow(BaseModel):
    rank: int
    fastPeriod: int
    slowPeriod: int
    slAtrMult: float
    rrTarget: float
    totalTrades: int
    winRatePct: float
    profitFactor: float
    sharpeRatio: float
    sortinoRatio: float
    totalReturnPct: float
    netProfitUsd: float
    maxDrawdownPct: float
    score: float


class HeatmapCell(BaseModel):
    xLabel: str
    yLabel: str
    xVal: float
    yVal: float
    sharpeRatio: float
    totalReturnPct: float
    winRatePct: float
    trades: int


class VectorSweepResponse(BaseModel):
    engine: str = "Polars + VectorBT + NumPy"
    symbol: str
    timeframe: str
    strategyFamily: StrategyFamily
    barsProcessed: int
    totalCombinations: int
    elapsedMs: float
    combinationsPerSec: float
    topConfigs: list[VectorSweepConfigRow]
    heatmapCells: list[HeatmapCell]
    summaryText: str
    dataSourceUsed: str = "synthetic-parquet"
    isRealMarketData: bool = False
    sessionFilter: SessionFilterOption = "ALL"
    signalsFilteredBySession: int = 0


class OptunaOptimizeRequest(BaseModel):
    symbol: str = Field(default="XAUUSD", min_length=1)
    timeframe: str = Field(default="15m", min_length=1)
    barsCount: int = Field(default=6000, ge=400, le=25000)
    strategyFamily: StrategyFamily = "SMC_DONCHIAN_ATR"
    nTrials: int = Field(default=40, ge=8, le=150)
    trainRatio: float = Field(default=0.70, ge=0.5, le=0.85)
    initialCapital: float = Field(default=100000.0, gt=0)
    riskPct: float = Field(default=1.0, ge=0.1, le=10.0)
    spreadPct: float = Field(default=0.00015, ge=0.0, le=0.02)
    commissionPct: float = Field(default=0.00007, ge=0.0, le=0.01)
    slippageBps: float = Field(default=1.5, ge=0.0, le=50.0)
    sessionFilter: SessionFilterOption = "ALL"
    avoidFridayLate: bool = False
    dataMode: DataModeOption = "AUTO"
    verifyRealistic: bool = True
    seed: int = 42
    objectiveMetric: Literal["sharpe", "calmar", "profit_factor", "composite"] = "composite"
    locale: str = "pt"


class WalkForwardSplitMetrics(BaseModel):
    totalTrades: int
    winRatePct: float
    profitFactor: float
    sharpeRatio: float
    sortinoRatio: float
    calmarRatio: float
    totalReturnPct: float
    netProfitUsd: float
    maxDrawdownPct: float


class OptunaTrialSummary(BaseModel):
    trialNumber: int
    score: float
    fastPeriod: int
    slowPeriod: int
    slAtrMult: float
    rrTarget: float
    riskPct: float
    trades: int
    sharpeRatio: float
    totalReturnPct: float
    maxDrawdownPct: float


class OptunaOptimizeResponse(BaseModel):
    engine: str = "Optuna TPE + Polars + VectorBT"
    symbol: str
    timeframe: str
    strategyFamily: StrategyFamily
    objectiveMetric: str
    barsProcessed: int
    trainBars: int
    testBars: int
    nTrialsCompleted: int
    elapsedMs: float
    bestScore: float
    bestParams: dict[str, Any]
    inSampleMetrics: WalkForwardSplitMetrics
    outOfSampleMetrics: WalkForwardSplitMetrics
    robustnessVerdict: str
    robustnessTone: Literal["accent", "warn", "danger"]
    paramImportances: dict[str, float]
    topTrials: list[OptunaTrialSummary]
    equityCurve: list[dict[str, Any]]
    dataSourceUsed: str = "synthetic-parquet"
    isRealMarketData: bool = False
    sessionFilter: SessionFilterOption = "ALL"
    realisticVerification: Optional[RealisticVerificationSummary] = None
    realisticTearsheet: Optional[dict[str, Any]] = None
    realisticOrdersCount: int = 0
