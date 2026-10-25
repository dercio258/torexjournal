from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

class TaskType(str, Enum):
    START_ACCOUNT = "START_ACCOUNT"
    STOP_ACCOUNT = "STOP_ACCOUNT"
    SYNC_ACCOUNT = "SYNC_ACCOUNT"
    FORCE_FULL_SYNC = "FORCE_FULL_SYNC"
    RESTART_TERMINAL = "RESTART_TERMINAL"

class TaskStatus(str, Enum):
    RECEIVED = "RECEIVED"
    IN_PROGRESS = "IN_PROGRESS"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"

class Task(BaseModel):
    id: str
    type: TaskType
    priority: int = 1
    accountId: int
    login: str
    server: str
    credentialToken: Optional[str] = None
    from_date: Optional[datetime] = Field(default=None, alias="from")
    options: Dict[str, Any] = Field(default_factory=dict)

class TaskAck(BaseModel):
    taskId: str
    status: TaskStatus
    message: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)

class CredentialRequest(BaseModel):
    taskId: str
    accountId: int
    credentialToken: str

class CredentialResponse(BaseModel):
    login: str
    server: str
    password: str
    expiresInSeconds: int = 60

class AccountInfo(BaseModel):
    accountId: int
    login: str
    server: str
    currency: str
    balance: float
    equity: float
    margin: float
    freeMargin: float
    marginLevel: Optional[float] = 0.0
    leverage: int
    profit: float = 0.0
    company: Optional[str] = None
    name: Optional[str] = None
    tradeAllowed: bool = True
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

class DealData(BaseModel):
    ticket: int
    orderTicket: Optional[int] = None
    positionId: Optional[int] = None
    symbol: str
    type: str  # DEAL_TYPE_BUY, DEAL_TYPE_SELL, etc.
    entry: str  # DEAL_ENTRY_IN, DEAL_ENTRY_OUT, etc.
    volume: float
    price: float
    profit: float
    commission: float = 0.0
    swap: float = 0.0
    magic: Optional[int] = 0
    comment: Optional[str] = ""
    time: datetime

class OrderData(BaseModel):
    ticket: int
    symbol: str
    type: str
    state: str
    volumeInitial: float
    volumeCurrent: float
    priceOpen: float
    sl: float = 0.0
    tp: float = 0.0
    timeSetup: datetime
    magic: Optional[int] = 0
    comment: Optional[str] = ""

class PositionData(BaseModel):
    ticket: int
    symbol: str
    type: str  # POSITION_TYPE_BUY, POSITION_TYPE_SELL
    volume: float
    priceOpen: float
    priceCurrent: float
    sl: float = 0.0
    tp: float = 0.0
    profit: float
    swap: float = 0.0
    magic: Optional[int] = 0
    comment: Optional[str] = ""
    time: datetime

class SyncTradesPayload(BaseModel):
    accountId: int
    lastDealTicket: int
    trades: List[DealData]

class SyncOrdersPayload(BaseModel):
    accountId: int
    orders: List[OrderData]

class SyncPositionsPayload(BaseModel):
    accountId: int
    positions: List[PositionData]

class WorkerHeartbeat(BaseModel):
    workerId: str
    cpuPercent: float
    memoryPercent: float
    memoryUsedMb: Optional[float] = None
    memoryTotalMb: Optional[float] = None
    memoryAvailableMb: Optional[float] = None
    activeTerminals: int
    monitoredAccounts: List[int]
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class WorkerEvent(BaseModel):
    workerId: str
    accountId: Optional[int] = None
    eventType: str
    severity: str  # INFO, WARNING, ERROR, CRITICAL
    message: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ResourceMetrics(BaseModel):
    cpuPercent: float
    memoryPercent: float
    memoryUsedMb: float
    memoryTotalMb: float
    memoryAvailableMb: float
    processMemoryMb: Optional[float] = None
    processCpuPercent: Optional[float] = None
    isCritical: bool = False
    criticalReasons: List[str] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ResourceExhaustionError(RuntimeError):
    """Exceção levantada quando recursos de CPU ou Memória atingem níveis críticos."""
    def __init__(self, message: str, metrics: Dict[str, Any], operation: str = "", account_id: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.metrics = metrics
        self.operation = operation
        self.account_id = account_id

