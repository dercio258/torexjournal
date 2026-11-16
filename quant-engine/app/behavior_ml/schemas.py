from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator


BEHAVIOR_CLASSES: tuple[str, ...] = (
    "revenge_trading",
    "overtrading_fomo",
    "tilt_risk_escalation",
    "overconfidence_euphoria",
    "strategy_session_drift",
    "prop_guardrail_breach_risk",
)

BEHAVIOR_CLASS_LABELS: dict[str, dict[str, str]] = {
    "revenge_trading": {
        "pt": "Revenge Trading",
        "en": "Revenge Trading",
    },
    "overtrading_fomo": {
        "pt": "Overtrading / FOMO",
        "en": "Overtrading / FOMO",
    },
    "tilt_risk_escalation": {
        "pt": "Escalada de Risco / Tilt",
        "en": "Tilt / Risk Escalation",
    },
    "overconfidence_euphoria": {
        "pt": "Excesso de Confiança / Euforia",
        "en": "Overconfidence / Euphoria",
    },
    "strategy_session_drift": {
        "pt": "Fuga de Estratégia / Sessão",
        "en": "Strategy / Session Drift",
    },
    "prop_guardrail_breach_risk": {
        "pt": "Risco de Violação Prop Firm",
        "en": "Prop Guardrail Breach Risk",
    },
}


class AccountContextInput(BaseModel):
    model_config = ConfigDict(extra="allow")

    accountId: Optional[str] = None
    accountType: str = "live"
    currency: str = "USD"
    initialBalance: float = 0.0
    balance: float = 0.0
    leverage: int = 1
    dailyLossLimit: Optional[float] = None
    maxDrawdown: Optional[float] = None
    profitTarget: Optional[float] = None


class ImportedTradeRecord(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str = Field(min_length=1)
    ticket: Optional[str] = None
    symbol: str = "UNKNOWN"
    type: str = "BUY"
    volume: float = 0.0
    openPrice: float = 0.0
    closePrice: float = 0.0
    sl: Optional[float] = None
    tp: Optional[float] = None
    profit: float = 0.0
    commission: float = 0.0
    swap: float = 0.0
    netPnl: Optional[float] = None
    mfe: Optional[float] = None
    mae: Optional[float] = None
    openTime: Union[str, int, float]
    closeTime: Optional[Union[str, int, float]] = None
    magic: int = 0
    comment: Optional[str] = None
    session: Optional[str] = None
    setup: Optional[str] = None
    mood: Optional[str] = None
    rating: Optional[float] = None
    tags: Optional[list[str]] = None
    followingPlan: Optional[str] = None
    entryDriver: Optional[str] = None
    riskComfort: Optional[str] = None
    mistakes: Optional[str] = None
    feedbackVerdict: Optional[Literal["CONFIRM", "FALSE_POSITIVE"]] = None
    feedbackFlags: Optional[list[str]] = None

    @field_validator("volume", "openPrice", "closePrice", "profit", "commission", "swap", mode="before")
    @classmethod
    def _coerce_float(cls, v: Any) -> float:
        if v is None or v == "":
            return 0.0
        try:
            num = float(v)
            return num if num == num else 0.0
        except (TypeError, ValueError):
            return 0.0

    @field_validator("magic", mode="before")
    @classmethod
    def _coerce_magic(cls, v: Any) -> int:
        if v is None or v == "":
            return 0
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


class JournalContextItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    date: str
    sleepQuality: Optional[float] = None
    energy: Optional[float] = None
    focus: Optional[float] = None
    moodScore: Optional[float] = None
    stress: Optional[float] = None
    strategyUsed: Optional[str] = None
    emotionalState: Optional[str] = None
    rulesBroken: Optional[str] = None


class AnalyzeImportedTradesRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    accountContext: AccountContextInput = Field(default_factory=AccountContextInput)
    historicalTrades: list[ImportedTradeRecord] = Field(default_factory=list)
    newTrades: list[ImportedTradeRecord] = Field(default_factory=list)
    journalContext: list[JournalContextItem] = Field(default_factory=list)
    locale: Literal["pt", "en"] = "pt"


class BatchBehaviorSummary(BaseModel):
    totalEvaluated: int
    flaggedTradesCount: int
    behaviorHealthScore: float
    maxAnomalyScore: float
    dominantPattern: Optional[str] = None
    sessionDriftCount: int = 0
    strategyDriftCount: int = 0
    manualEaOverrideCount: int = 0
    traderProfile: str = "DISCIPLINED_EXECUTOR"
    ensembleMode: Literal["HYBRID_PYTORCH_LIGHTGBM", "PYTORCH_ONLY"] = "PYTORCH_ONLY"
    driftDetected: bool = False
    maxFeaturePsi: float = 0.0
    driftedFeatures: list[str] = Field(default_factory=list)


class TradeBehaviorPrediction(BaseModel):
    tradeId: str
    ticket: Optional[str] = None
    anomalyScore: float
    riskLevel: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    probabilities: dict[str, float]
    activeFlags: list[str]
    effectiveSession: str
    effectiveStrategy: str
    executionMode: str
    reasons: list[str]


class RecommendedAlertItem(BaseModel):
    patternCode: str
    alertType: Literal["PSYCHOLOGY", "RISK", "DISCIPLINE", "COACHING"]
    severity: Literal["INFO", "WARNING", "CRITICAL"]
    title: str
    description: str
    tradeId: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnalyzeImportedTradesResponse(BaseModel):
    modelVersion: str
    modelStatus: Literal["TRAINED_PYTORCH", "BOOTSTRAP_PYTORCH"]
    batchSummary: BatchBehaviorSummary
    tradePredictions: list[TradeBehaviorPrediction]
    recommendedAlerts: list[RecommendedAlertItem]


class BehaviorModelStatusResponse(BaseModel):
    status: str
    modelVersion: str
    modelStatus: Literal["TRAINED_PYTORCH", "BOOTSTRAP_PYTORCH"]
    checkpointExists: bool
    checkpointPath: str
    datasetExists: bool
    ensembleExists: bool = False
    ensembleBackend: str = "pytorch_only"
    coupledLibraries: list[str] = Field(default_factory=list)
    behaviorClasses: list[str]
    continuousFeatureCount: int
    categoricalVocabSizes: dict[str, int]
    trainingMetrics: Optional[dict[str, Any]] = None


class BehaviorAnalyticsResponse(BaseModel):
    status: str
    datasetExists: bool
    totalRows: int = 0
    realDbRows: int = 0
    syntheticRows: int = 0
    bySession: list[dict[str, Any]] = Field(default_factory=list)
    byExecutionMode: list[dict[str, Any]] = Field(default_factory=list)
    byStrategyTop: list[dict[str, Any]] = Field(default_factory=list)
    modelComparison: Optional[dict[str, Any]] = None
