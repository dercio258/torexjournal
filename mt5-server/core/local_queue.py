import sqlite3
import json
import time
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import List, Dict, Any, Tuple, Iterator
from loguru import logger
from config.settings import settings


class LocalQueue:
    """Buffer local persistente em SQLite com controle de tentativas, backoff exponencial e Dead-Letter Queue (DLQ)."""

    def __init__(self):
        self._lock = threading.RLock()
        data_dir = Path(settings.data_dir).resolve()
        data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = str(data_dir / "offline_buffer.db")
        self._init_db()

    @contextmanager
    def _get_connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self):
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS offline_buffer (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        endpoint TEXT NOT NULL,
                        payload TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        attempts INTEGER DEFAULT 0,
                        status TEXT DEFAULT 'PENDING',
                        last_error TEXT DEFAULT NULL,
                        next_retry_at REAL DEFAULT 0
                    )
                """)
                # Migração automática caso a tabela antiga já exista sem as novas colunas
                cursor.execute("PRAGMA table_info(offline_buffer)")
                existing_cols = {row[1] for row in cursor.fetchall()}
                if "status" not in existing_cols:
                    cursor.execute("ALTER TABLE offline_buffer ADD COLUMN status TEXT DEFAULT 'PENDING'")
                if "last_error" not in existing_cols:
                    cursor.execute("ALTER TABLE offline_buffer ADD COLUMN last_error TEXT DEFAULT NULL")
                if "next_retry_at" not in existing_cols:
                    cursor.execute("ALTER TABLE offline_buffer ADD COLUMN next_retry_at REAL DEFAULT 0")
                # Limpa itens órfãos acumulados da conta demo padrão 10013466931
                cursor.execute(
                    "DELETE FROM offline_buffer WHERE status = 'PENDING' AND payload LIKE '%10013466931%'"
                )
                conn.commit()

    def purge_account_items(self, account_id: Any):
        """Remove imediatamente todos os itens pendentes de uma conta inexistente no backend."""
        acc_str = str(account_id).strip()
        if not acc_str:
            return
        with self._lock:
            try:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "DELETE FROM offline_buffer WHERE (status IS NULL OR status = 'PENDING') AND payload LIKE ?",
                        (f"%{acc_str}%",)
                    )
                    deleted = cursor.rowcount
                    conn.commit()
                    if deleted and deleted > 0:
                        logger.info(f"Removidos {deleted} itens pendentes do buffer offline para a conta {acc_str}.")
            except Exception as e:
                logger.error(f"Erro ao limpar itens da conta {acc_str} no buffer offline: {e}")

    def enqueue(self, endpoint: str, payload: Dict[str, Any]):
        """Adiciona um payload não entregue à fila de buffer offline."""
        with self._lock:
            try:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        INSERT INTO offline_buffer (endpoint, payload, attempts, status, next_retry_at)
                        VALUES (?, ?, 0, 'PENDING', 0)
                        """,
                        (endpoint, json.dumps(payload))
                    )
                    conn.commit()
                logger.info(f"Payload enfileirado no buffer offline: {endpoint}")
            except Exception as e:
                logger.error(f"Erro ao salvar no buffer offline: {e}")

    def peek_batch(self, limit: int = 50) -> List[Tuple[int, str, Dict[str, Any]]]:
        """Obtém um lote de mensagens PENDING prontas para reenvio."""
        now = time.time()
        with self._lock:
            try:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        SELECT id, endpoint, payload
                        FROM offline_buffer
                        WHERE (status IS NULL OR status = 'PENDING')
                          AND (next_retry_at IS NULL OR next_retry_at <= ?)
                        ORDER BY id ASC
                        LIMIT ?
                        """,
                        (now, limit)
                    )
                    rows = cursor.fetchall()
                    result = []
                    for row_id, endpoint, payload_str in rows:
                        try:
                            result.append((row_id, endpoint, json.loads(payload_str)))
                        except Exception as parse_err:
                            logger.error(f"Payload corrompido no buffer offline (ID {row_id}): {parse_err}")
                            self.mark_failed(row_id, f"JSON inválido: {parse_err}", permanent=True)
                    return result
            except Exception as e:
                logger.error(f"Erro ao ler buffer offline: {e}")
                return []

    def remove(self, item_id: int):
        """Remove item processado com sucesso do buffer."""
        with self._lock:
            try:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM offline_buffer WHERE id = ?", (item_id,))
                    conn.commit()
            except Exception as e:
                logger.error(f"Erro ao remover item {item_id} do buffer: {e}")

    def mark_failed(self, item_id: int, error_message: str = "", permanent: bool = False, max_attempts: int = 10):
        """
        Incrementa o contador de tentativas com backoff exponencial.
        Se atingir max_attempts ou for falha permanente (ex: 400 / Account not found), move para DEAD_LETTER.
        """
        with self._lock:
            try:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT attempts FROM offline_buffer WHERE id = ?", (item_id,))
                    row = cursor.fetchone()
                    if not row:
                        return
                    attempts = int(row[0] or 0) + 1
                    if permanent or attempts >= max_attempts:
                        cursor.execute(
                            """
                            UPDATE offline_buffer
                            SET attempts = ?, status = 'DEAD_LETTER', last_error = ?
                            WHERE id = ?
                            """,
                            (attempts, error_message[:500], item_id)
                        )
                        logger.warning(
                            f"Item {item_id} movido para DEAD_LETTER após {attempts} tentativa(s). Motivo: {error_message}"
                        )
                    else:
                        backoff = min(15 * (2 ** (attempts - 1)), 600)
                        next_retry = time.time() + backoff
                        cursor.execute(
                            """
                            UPDATE offline_buffer
                            SET attempts = ?, last_error = ?, next_retry_at = ?
                            WHERE id = ?
                            """,
                            (attempts, error_message[:500], next_retry, item_id)
                        )
                    conn.commit()
            except Exception as e:
                logger.error(f"Erro ao atualizar falha do item {item_id} no buffer offline: {e}")


