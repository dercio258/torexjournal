import time
import threading
from collections import deque
import psutil
from datetime import datetime, timezone
from typing import List, Dict, Tuple, Optional
from loguru import logger
from config.settings import settings
from models.schemas import WorkerHeartbeat, ResourceMetrics, ResourceExhaustionError
from .process_manager import MT5ProcessManager


_CPU_LOCK = threading.Lock()
_CPU_SAMPLES: deque = deque(maxlen=4)
_LAST_CPU_SAMPLE_TS: float = 0.0
_LAST_CPU_RAW: float = 0.0
_CPU_PRIMED: bool = False
_CPU_MIN_SAMPLE_INTERVAL_SEC: float = 2.0


def reset_cpu_sampler_for_tests() -> None:
    """Reseta o amostrador global de CPU suavizado (uso em testes unitários)."""
    global _LAST_CPU_SAMPLE_TS, _LAST_CPU_RAW, _CPU_PRIMED
    with _CPU_LOCK:
        _CPU_SAMPLES.clear()
        _LAST_CPU_SAMPLE_TS = 0.0
        _LAST_CPU_RAW = 0.0
        _CPU_PRIMED = False


def sample_smoothed_cpu_percent(now: Optional[float] = None) -> Tuple[float, float]:
    """
    Amostra CPU do sistema com intervalo mínimo de 2s e média móvel (4 amostras).
    Evita que chamadas próximas de psutil.cpu_percent(interval=None) em módulos distintos
    resetem o contador global e disparem falsos alertas de 95-100% em picos de milissegundos.
    Retorna (cpu_smoothed, cpu_instant).
    """
    global _LAST_CPU_SAMPLE_TS, _LAST_CPU_RAW, _CPU_PRIMED
    cur = time.time() if now is None else float(now)
    with _CPU_LOCK:
        if not _CPU_PRIMED:
            try:
                psutil.cpu_percent(interval=None)
            except Exception:
                pass
            _CPU_PRIMED = True
            _LAST_CPU_SAMPLE_TS = cur
            _LAST_CPU_RAW = 0.0
            return 0.0, 0.0

        if (cur - _LAST_CPU_SAMPLE_TS) >= _CPU_MIN_SAMPLE_INTERVAL_SEC or not _CPU_SAMPLES:
            try:
                raw = round(float(psutil.cpu_percent(interval=None)), 1)
            except Exception:
                raw = _LAST_CPU_RAW
            raw = max(0.0, min(100.0, raw))
            _CPU_SAMPLES.append(raw)
            _LAST_CPU_RAW = raw
            _LAST_CPU_SAMPLE_TS = cur

        smoothed = round(sum(_CPU_SAMPLES) / len(_CPU_SAMPLES), 1) if _CPU_SAMPLES else 0.0
        return smoothed, _LAST_CPU_RAW


class HealthMonitor:
    """Monitor de saúde do sistema, telemetria e integridade dos processos com proteção anti-loop."""

    SUSTAINED_CPU_MIN_STREAK = 3
    SUSTAINED_CPU_MIN_SECONDS = 15.0
    SUSTAINED_MEM_MIN_STREAK = 2
    COOLDOWN_EARLY_RECOVERY_GRACE_SEC = 5.0

    def __init__(self, process_manager: MT5ProcessManager):
        self.process_manager = process_manager
        # Histórico de recuperações por conta: account_id -> list of timestamps
        self.recovery_history: Dict[int, List[float]] = {}
        # Cooldown ativo por conta: account_id -> timestamp de expiração do cooldown
        self.cooldowns: Dict[int, float] = {}
        
        # Anti-Loop global de recursos para sincronização e extração
        self.sync_cooldown_until: float = 0
        self._cooldown_started_at: float = 0.0
        self.consecutive_resource_failures: int = 0
        self.last_logged_resource_error: float = 0
        self.account_resource_failures: Dict[int, List[float]] = {}

        # Histerese contra falsos positivos em picos momentâneos de CPU/RAM (ex.: Defender/Hyper-V/MT5 tick)
        self._high_cpu_streak: int = 0
        self._high_cpu_since: Optional[float] = None
        self._last_cpu_eval_ts: float = 0.0
        self._high_mem_streak: int = 0
        self._last_mem_eval_ts: float = 0.0
        self._last_transient_spike_log: float = 0.0

    def get_resource_metrics(self, now: Optional[float] = None) -> dict:
        """
        Obtém métricas técnicas precisas de consumo de CPU (suavizada) e Memória (MB e %),
        tanto globais do sistema quanto do processo worker atual.
        """
        cur = time.time() if now is None else float(now)
        cpu_usage, cpu_instant = sample_smoothed_cpu_percent(now=cur)
        mem = psutil.virtual_memory()
        
        used_mb = round((mem.total - mem.available) / (1024 * 1024), 1)
        total_mb = round(mem.total / (1024 * 1024), 1)
        available_mb = round(mem.available / (1024 * 1024), 1)
        mem_percent = round(mem.percent, 1)

        # Telemetria do processo atual (Worker Python) e espaço livre em disco
        proc_used_mb = 0.0
        proc_cpu = 0.0
        disk_free_gb = None
        try:
            current_proc = psutil.Process()
            proc_used_mb = round(current_proc.memory_info().rss / (1024 * 1024), 1)
            proc_cpu = round(current_proc.cpu_percent(interval=None), 1)
        except Exception as e:
            logger.debug(f"Não foi possível obter métricas do processo atual: {e}")
        try:
            disk = psutil.disk_usage(settings.instances_dir)
            disk_free_gb = round(disk.free / (1024 * 1024 * 1024), 2)
        except Exception:
            pass

        # Avaliação técnica de limites críticos com histerese anti-falso-positivo (apenas se guarda habilitada)
        critical_reasons = []
        if settings.enable_resource_guard:
            mem_pct_breach = mem_percent >= settings.max_memory_percent
            mem_mb_breach = available_mb < settings.min_available_memory_mb
            mem_severe = mem_percent >= 98.0 or available_mb < (settings.min_available_memory_mb * 0.5)

            if mem_pct_breach or mem_mb_breach:
                if (cur - self._last_mem_eval_ts) >= 1.5 or self._high_mem_streak == 0:
                    self._high_mem_streak += 1
                    self._last_mem_eval_ts = cur
                if mem_severe or self._high_mem_streak >= self.SUSTAINED_MEM_MIN_STREAK:
                    if mem_pct_breach:
                        critical_reasons.append(
                            f"Memória RAM consumida em nível crítico: {mem_percent}% (limite máx: {settings.max_memory_percent}%)"
                        )
                    if mem_mb_breach:
                        critical_reasons.append(
                            f"Memória RAM livre insuficiente: {available_mb} MB (mínimo necessário: {settings.min_available_memory_mb} MB)"
                        )
            else:
                self._high_mem_streak = 0
                self._last_mem_eval_ts = cur

            cpu_sustained_breach = cpu_usage >= settings.max_cpu_percent and cpu_instant >= settings.max_cpu_percent
            if cpu_sustained_breach:
                if self._high_cpu_since is None:
                    self._high_cpu_since = cur
                if (cur - self._last_cpu_eval_ts) >= _CPU_MIN_SAMPLE_INTERVAL_SEC or self._high_cpu_streak == 0:
                    self._high_cpu_streak += 1
                    self._last_cpu_eval_ts = cur
                sustained_sec = cur - self._high_cpu_since
                if (
                    self._high_cpu_streak >= self.SUSTAINED_CPU_MIN_STREAK
                    and sustained_sec >= self.SUSTAINED_CPU_MIN_SECONDS
                ):
                    critical_reasons.append(
                        f"Consumo de CPU em saturação sustentada ({int(sustained_sec)}s): média {cpu_usage}% / atual {cpu_instant}% (limite máx: {settings.max_cpu_percent}%)"
                    )
            else:
                if cpu_instant >= settings.max_cpu_percent and (cur - self._last_transient_spike_log) >= 15.0:
                    self._last_transient_spike_log = cur
                    logger.debug(
                        f"[CPU-SPIKE IGNORADO] Pico momentâneo de CPU ({cpu_instant}% | média móvel: {cpu_usage}%) abaixo do critério sustentado."
                    )
                self._high_cpu_streak = 0
                self._high_cpu_since = None
                self._last_cpu_eval_ts = cur

        is_critical = len(critical_reasons) > 0

        return {
            "cpu_percent": cpu_usage,
            "cpu_instant_percent": cpu_instant,
            "memory_percent": mem_percent,
            "memory_used_mb": used_mb,
            "memory_total_mb": total_mb,
            "memory_available_mb": available_mb,
            "disk_free_gb": disk_free_gb,
            "process_memory_mb": proc_used_mb,
            "process_cpu_percent": proc_cpu,
            "is_critical": is_critical,
            "critical_reasons": critical_reasons,
            "max_memory_percent_limit": settings.max_memory_percent,
            "max_cpu_percent_limit": settings.max_cpu_percent,
            "min_available_mb_limit": settings.min_available_memory_mb,
        }

    def format_technical_error(self, metrics: dict, operation: str = "", account_id: Optional[int] = None) -> str:
        """
        Formata uma mensagem de erro técnica detalhada contendo a memória consumida,
        porcentagem, memória total, CPU e justificativa da interrupção anti-loop.
        """
        acc_str = f" [Conta {account_id}]" if account_id is not None else ""
        reasons_str = "; ".join(metrics.get("critical_reasons", [])) or "Limites de hardware violados"
        
        return (
            f"[RESOURCE_EXHAUSTION_ERROR]{acc_str} Operação '{operation}' bloqueada preventivamente. "
            f"Memória Consumida: {metrics['memory_used_mb']} MB / {metrics['memory_total_mb']} MB ({metrics['memory_percent']}%) | "
            f"RAM Livre: {metrics['memory_available_mb']} MB | CPU do Sistema: {metrics['cpu_percent']}% | "
            f"Worker RSS: {metrics['process_memory_mb']} MB (CPU Processo: {metrics['process_cpu_percent']}%). "
            f"Diagnóstico Técnico: {reasons_str}. "
            f"Mecanismo Anti-Loop ativado para impedir congelamento da VPS e thrashing."
        )

    def check_resource_guard(self, operation: str = "Operação", account_id: Optional[int] = None, now: Optional[float] = None) -> Tuple[bool, Optional[str], dict]:
        """
        Verifica a viabilidade de execução com proteção anti-loop ativa.
        Retorna (is_safe, error_message, metrics).
        Se is_safe == False, retorna error_message técnico e ativa cooldown exponencial.
        """
        cur = time.time() if now is None else float(now)
        metrics = self.get_resource_metrics(now=cur)

        # Se o circuit breaker / resource guard estiver desativado, permite execução irrestrita
        if not settings.enable_resource_guard:
            return True, None, metrics

        # 1. Verifica se já está em período de cooldown anti-loop (com liberação antecipada se recursos já normalizaram)
        if cur < self.sync_cooldown_until:
            recovered_cleanly = (
                not metrics["is_critical"]
                and (cur - self._cooldown_started_at) >= self.COOLDOWN_EARLY_RECOVERY_GRACE_SEC
                and metrics["memory_percent"] < (settings.max_memory_percent - 5.0)
                and metrics["memory_available_mb"] >= (settings.min_available_memory_mb + 40.0)
                and metrics["cpu_percent"] < (settings.max_cpu_percent - 15.0)
            )
            if recovered_cleanly:
                logger.info(
                    f"[RECURSOS NORMALIZADOS] Cooldown encerrado antecipadamente para '{operation}'. "
                    f"Memória Consumida: {metrics['memory_used_mb']} MB ({metrics['memory_percent']}%) | CPU média: {metrics['cpu_percent']}%."
                )
                self.sync_cooldown_until = 0
                self._cooldown_started_at = 0.0
                self.consecutive_resource_failures = 0
                return True, None, metrics

            remaining = int(self.sync_cooldown_until - cur)
            error_msg = (
                f"[ANTI-LOOP EM COOLDOWN] Operação '{operation}' suspensa por mais {remaining}s devido a escassez prévia de recursos. "
                f"Memória Consumida: {metrics['memory_used_mb']} MB / {metrics['memory_total_mb']} MB ({metrics['memory_percent']}%) | CPU: {metrics['cpu_percent']}%."
            )
            # Evita logar a cada milissegundo caso chamado repetidamente
            if cur - self.last_logged_resource_error >= 10:
                self.last_logged_resource_error = cur
                logger.warning(error_msg)
            return False, error_msg, metrics

        # 2. Verifica se os recursos atuais são críticos
        if metrics["is_critical"]:
            self.consecutive_resource_failures += 1
            # Backoff exponencial para quebrar loops contínuos de checagem (30s, 60s, 120s, até máx 300s)
            backoff = min(settings.resource_cooldown_seconds * (2 ** (self.consecutive_resource_failures - 1)), 300)
            self._cooldown_started_at = cur
            self.sync_cooldown_until = cur + backoff

            error_msg = self.format_technical_error(metrics, operation=operation, account_id=account_id)
            self.last_logged_resource_error = cur
            logger.critical(
                f"{error_msg} | Falha consecutiva {self.consecutive_resource_failures}/{settings.max_consecutive_resource_failures}. "
                f"Pausa de resfriamento (cooldown) aplicada: {backoff} segundos."
            )
            return False, error_msg, metrics

        # Recursos normais: reseta contador de falhas consecutivas
        if self.consecutive_resource_failures > 0:
            logger.info(
                f"[RECURSOS NORMALIZADOS] Estabilidade reestabelecida para '{operation}'. "
                f"Memória Consumida: {metrics['memory_used_mb']} MB ({metrics['memory_percent']}%) | CPU: {metrics['cpu_percent']}%."
            )
            self.consecutive_resource_failures = 0

        return True, None, metrics

    def check_account_resource_guard(self, account_id: int, operation: str = "Operação de Conta") -> Tuple[bool, Optional[str], dict]:
        """
        Verificação granular de recursos para uma conta específica com proteção anti-loop.
        """
        # Primeiro checa guarda global de recursos
        is_safe, error_msg, metrics = self.check_resource_guard(operation=operation, account_id=account_id)
        if not is_safe:
            return False, error_msg, metrics

        if not settings.enable_resource_guard:
            return True, None, metrics

        # Checa quarentena específica da conta
        now = time.time()
        cooldown_until = self.cooldowns.get(account_id, 0)
        if now < cooldown_until:
            remaining = int(cooldown_until - now)
            acc_msg = (
                f"[ANTI-LOOP CONTA {account_id}] Conta em quarentena técnica ({remaining}s restantes). "
                f"Extração ignorada para evitar loops contínuos de falhas. "
                f"Memória: {metrics['memory_used_mb']} MB ({metrics['memory_percent']}%) | CPU: {metrics['cpu_percent']}%."
            )
            return False, acc_msg, metrics

        return True, None, metrics

    def record_account_resource_failure(self, account_id: int, reason: str, metrics: Optional[dict] = None):
        """Registra falha de extração ou de recursos de uma conta e aciona quarentena se houver repetição."""
        if not settings.enable_resource_guard:
            return
        now = time.time()
        history = self.account_resource_failures.setdefault(account_id, [])
        history = [t for t in history if now - t < 300]
        history.append(now)
        self.account_resource_failures[account_id] = history

        m = metrics or self.get_resource_metrics()
        logger.warning(
            f"[FALHA DE EXTRAÇÃO CONTA {account_id}] Tentativa {len(history)}/3 falhou: {reason}. "
            f"Memória Consumida: {m['memory_used_mb']} MB ({m['memory_percent']}%) | CPU: {m['cpu_percent']}%."
        )

        if len(history) >= 3:
            # Quarentena de 5 minutos (300 segundos) para quebrar o loop infinito de extração
            self.cooldowns[account_id] = now + 300
            logger.critical(
                f"[ANTI-LOOP ATIVADO] Conta {account_id} atingiu 3 falhas de extração consecutivas! "
                f"Conta suspensa por 300 segundos. Memória atual: {m['memory_used_mb']} MB / {m['memory_total_mb']} MB ({m['memory_percent']}%)."
            )

    def collect_telemetry(self, monitored_accounts: List[int]) -> WorkerHeartbeat:
        """Coleta telemetria completa com memória em MB e porcentagem"""
        metrics = self.get_resource_metrics()

        active_terminals_count = sum(
            1 for acc_id in monitored_accounts if self.process_manager.is_running(acc_id)
        )

        return WorkerHeartbeat(
            workerId=settings.worker_id,
            cpuPercent=metrics["cpu_percent"],
            memoryPercent=metrics["memory_percent"],
            memoryUsedMb=metrics["memory_used_mb"],
            memoryTotalMb=metrics["memory_total_mb"],
            memoryAvailableMb=metrics["memory_available_mb"],
            diskFreeGb=metrics.get("disk_free_gb"),
            activeTerminals=active_terminals_count,
            monitoredAccounts=monitored_accounts,
            timestamp=datetime.now(timezone.utc),
        )

    def check_and_recover_dead_terminals(self, monitored_accounts: List[int]) -> List[int]:
        """Identifica instâncias inativas aplicando Circuit Breaker e Anti-Loop"""
        metrics = self.get_resource_metrics()
        now = time.time()

        # 1. CIRCUIT BREAKER DE RECURSOS: Não reinicia terminais se a VPS estiver sem RAM ou CPU (apenas se ativado)
        if settings.enable_resource_guard and metrics["is_critical"]:
            logger.error(
                f"[CIRCUIT BREAKER] Recursos da VPS no limite crítico! "
                f"Memória consumida: {metrics['memory_used_mb']} MB / {metrics['memory_total_mb']} MB ({metrics['memory_percent']}%) | "
                f"RAM Livre: {metrics['memory_available_mb']} MB | CPU: {metrics['cpu_percent']}%. "
                f"Auto-recovery suspenso temporariamente para evitar travamento da VPS."
            )
            return []

        dead_accounts = []
        for acc_id in monitored_accounts:
            # 2. ANTI-LOOP COOLDOWN: Checa se a conta está em quarentena por falhas repetidas
            cooldown_until = self.cooldowns.get(acc_id, 0)
            if now < cooldown_until:
                remaining_sec = int(cooldown_until - now)
                logger.debug(f"[Anti-Loop] Conta {acc_id} em cooldown de recuperação ({remaining_sec}s restantes).")
                continue

            if not self.process_manager.is_running(acc_id):
                # Registra tentativa e checa limite de 3 falhas nos últimos 300 segundos
                history = self.recovery_history.setdefault(acc_id, [])
                history = [t for t in history if now - t < 300]
                history.append(now)
                self.recovery_history[acc_id] = history

                if settings.enable_resource_guard and len(history) >= 3:
                    # Ativa cooldown de 5 minutos (300 segundos) para quebrar o loop infinito
                    self.cooldowns[acc_id] = now + 300
                    logger.critical(
                        f"[ANTI-LOOP ATIVADO] Conta {acc_id} falhou 3 vezes consecutivas em 5 minutos! "
                        f"Terminal suspenso por 300s. Memória atual: {metrics['memory_used_mb']} MB / {metrics['memory_total_mb']} MB ({metrics['memory_percent']}%)."
                    )
                    continue

                logger.warning(
                    f"Watchdog detectou terminal inativo para conta {acc_id} "
                    f"(Tentativa {len(history)}/3). Memória: {metrics['memory_percent']}%, CPU: {metrics['cpu_percent']}%"
                )
                dead_accounts.append(acc_id)

        return dead_accounts
