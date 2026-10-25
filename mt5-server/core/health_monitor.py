import time
import psutil
from datetime import datetime
from typing import List, Dict, Tuple, Optional
from loguru import logger
from config.settings import settings
from models.schemas import WorkerHeartbeat, ResourceMetrics, ResourceExhaustionError
from .process_manager import MT5ProcessManager

class HealthMonitor:
    """Monitor de saúde do sistema, telemetria e integridade dos processos com proteção anti-loop."""

    def __init__(self, process_manager: MT5ProcessManager):
        self.process_manager = process_manager
        # Histórico de recuperações por conta: account_id -> list of timestamps
        self.recovery_history: Dict[int, List[float]] = {}
        # Cooldown ativo por conta: account_id -> timestamp de expiração do cooldown
        self.cooldowns: Dict[int, float] = {}
        
        # Anti-Loop global de recursos para sincronização e extração
        self.sync_cooldown_until: float = 0
        self.consecutive_resource_failures: int = 0
        self.last_logged_resource_error: float = 0
        self.account_resource_failures: Dict[int, List[float]] = {}

    def get_resource_metrics(self) -> dict:
        """
        Obtém métricas técnicas precisas de consumo de CPU e Memória (MB e %),
        tanto globais do sistema quanto do processo worker atual.
        """
        cpu_usage = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        
        used_mb = round((mem.total - mem.available) / (1024 * 1024), 1)
        total_mb = round(mem.total / (1024 * 1024), 1)
        available_mb = round(mem.available / (1024 * 1024), 1)
        mem_percent = round(mem.percent, 1)

        # Telemetria do processo atual (Worker Python)
        proc_used_mb = 0.0
        proc_cpu = 0.0
        try:
            current_proc = psutil.Process()
            proc_used_mb = round(current_proc.memory_info().rss / (1024 * 1024), 1)
            proc_cpu = round(current_proc.cpu_percent(interval=None), 1)
        except Exception as e:
            logger.debug(f"Não foi possível obter métricas do processo atual: {e}")

        # Avaliação técnica de limites críticos
        critical_reasons = []
        if mem_percent >= settings.max_memory_percent:
            critical_reasons.append(
                f"Memória RAM consumida em nível crítico: {mem_percent}% (limite máx: {settings.max_memory_percent}%)"
            )
        if available_mb < settings.min_available_memory_mb:
            critical_reasons.append(
                f"Memória RAM livre insuficiente: {available_mb} MB (mínimo necessário: {settings.min_available_memory_mb} MB)"
            )
        if cpu_usage >= settings.max_cpu_percent:
            critical_reasons.append(
                f"Consumo de CPU em saturação: {cpu_usage}% (limite máx: {settings.max_cpu_percent}%)"
            )

        is_critical = len(critical_reasons) > 0

        return {
            "cpu_percent": cpu_usage,
            "memory_percent": mem_percent,
            "memory_used_mb": used_mb,
            "memory_total_mb": total_mb,
            "memory_available_mb": available_mb,
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

    def check_resource_guard(self, operation: str = "Operação", account_id: Optional[int] = None) -> Tuple[bool, Optional[str], dict]:
        """
        Verifica a viabilidade de execução com proteção anti-loop ativa.
        Retorna (is_safe, error_message, metrics).
        Se is_safe == False, retorna error_message técnico e ativa cooldown exponencial.
        """
        now = time.time()
        metrics = self.get_resource_metrics()

        # 1. Verifica se já está em período de cooldown anti-loop
        if now < self.sync_cooldown_until:
            remaining = int(self.sync_cooldown_until - now)
            error_msg = (
                f"[ANTI-LOOP EM COOLDOWN] Operação '{operation}' suspensa por mais {remaining}s devido a escassez prévia de recursos. "
                f"Memória Consumida: {metrics['memory_used_mb']} MB / {metrics['memory_total_mb']} MB ({metrics['memory_percent']}%) | CPU: {metrics['cpu_percent']}%."
            )
            # Evita logar a cada milissegundo caso chamado repetidamente
            if now - self.last_logged_resource_error >= 10:
                self.last_logged_resource_error = now
                logger.warning(error_msg)
            return False, error_msg, metrics

        # 2. Verifica se os recursos atuais são críticos
        if metrics["is_critical"]:
            self.consecutive_resource_failures += 1
            # Backoff exponencial para quebrar loops contínuos de checagem (30s, 60s, 120s, até máx 300s)
            backoff = min(settings.resource_cooldown_seconds * (2 ** (self.consecutive_resource_failures - 1)), 300)
            self.sync_cooldown_until = now + backoff

            error_msg = self.format_technical_error(metrics, operation=operation, account_id=account_id)
            self.last_logged_resource_error = now
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
            activeTerminals=active_terminals_count,
            monitoredAccounts=monitored_accounts,
            timestamp=datetime.utcnow(),
        )

    def check_and_recover_dead_terminals(self, monitored_accounts: List[int]) -> List[int]:
        """Identifica instâncias inativas aplicando Circuit Breaker e Anti-Loop"""
        metrics = self.get_resource_metrics()
        now = time.time()

        # 1. CIRCUIT BREAKER DE RECURSOS: Não reinicia terminais se a VPS estiver sem RAM ou CPU
        if metrics["is_critical"]:
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

                if len(history) >= 3:
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
