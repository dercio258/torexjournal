import time
import datetime
import threading
from pathlib import Path
import psutil
from typing import List, Optional, Dict, Any
from loguru import logger

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    logger.warning("Biblioteca MetaTrader5 oficial não encontrada no ambiente Python. Modo de desenvolvimento ativo.")

from models.schemas import (
    AccountInfo,
    PositionData,
    OrderData,
    DealData,
    SyncTradesPayload,
    SyncPositionsPayload,
    SyncOrdersPayload,
    ResourceExhaustionError,
)

DEAL_ENTRY_MAP = {
    0: "DEAL_ENTRY_IN",
    1: "DEAL_ENTRY_OUT",
    2: "DEAL_ENTRY_INOUT",
    3: "DEAL_ENTRY_OUT_BY",
}

DEAL_TYPE_MAP = {
    0: "DEAL_TYPE_BUY",
    1: "DEAL_TYPE_SELL",
    2: "DEAL_TYPE_BALANCE",
    3: "DEAL_TYPE_CREDIT",
    4: "DEAL_TYPE_CHARGE",
    5: "DEAL_TYPE_CORRECTION",
    6: "DEAL_TYPE_BONUS",
    7: "DEAL_TYPE_COMMISSION",
    8: "DEAL_TYPE_COMMISSION_DAILY",
    9: "DEAL_TYPE_COMMISSION_MONTHLY",
    10: "DEAL_TYPE_COMMISSION_AGENT_DAILY",
    11: "DEAL_TYPE_COMMISSION_AGENT_MONTHLY",
    12: "DEAL_TYPE_INTEREST",
    13: "DEAL_TYPE_BUY_CANCELED",
    14: "DEAL_TYPE_SELL_CANCELED",
}


class SyncEngine:
    """Motor de extração incremental de dados financeiros e operacionais do MetaTrader 5 com IPC Lock exclusivo."""

    def __init__(self):
        self._ipc_lock = threading.RLock()
        self.connected_account: Optional[int] = None
        self.active_terminal_path: Optional[str] = None
        self.last_connect_error: Optional[str] = None
        self.last_error_code: Optional[int] = None

    @staticmethod
    def _mask_password_diagnostic(password: Optional[str]) -> str:
        """Retorna resumo seguro da senha para diagnóstico nos logs (tamanho + primeiros/últimos caracteres)."""
        pwd = str(password or "").strip()
        if not pwd:
            return "VAZIA/AUSENTE (tentando cofre interno do MT5)"
        length = len(pwd)
        if length <= 4:
            masked = pwd[0] + ("*" * (length - 1))
        else:
            masked = f"{pwd[:2]}{'*' * (length - 4)}{pwd[-2:]}"
        return f"DEFINIDA [tam={length}, preview='{masked}']"

    @staticmethod
    def inspect_mt5_ui_state(close_modals: bool = False) -> Dict[str, Any]:
        """
        Inspeciona em tempo real as janelas visíveis do processo terminal64.exe no Windows:
        - Captura o título da janela principal do MT5 (mostra qual conta e servidor estão ativos na GUI).
        - Captura qualquer modal/popup aberto (classe Win32 '#32770'), seu título e os textos/campos internos.
        - Se close_modals=True, fecha os modais bloqueantes automaticamente após registrar no log.
        """
        state: Dict[str, Any] = {
            "pids": [],
            "main_windows": [],
            "modals": [],
        }
        try:
            import sys
            if sys.platform != "win32":
                return state
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            WM_CLOSE = 0x0010

            mt5_pids = set()
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    name = (proc.info.get('name') or '').lower()
                    if 'terminal64' in name:
                        mt5_pids.add(proc.info['pid'])
                except Exception:
                    pass

            state["pids"] = sorted(list(mt5_pids))
            if not mt5_pids:
                return state

            WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

            def _get_child_texts(parent_hwnd) -> List[str]:
                texts: List[str] = []

                def enum_child_cb(child_hwnd, _lparam):
                    try:
                        c_class = ctypes.create_unicode_buffer(64)
                        user32.GetClassNameW(child_hwnd, c_class, 64)
                        c_text = ctypes.create_unicode_buffer(512)
                        user32.GetWindowTextW(child_hwnd, c_text, 512)
                        val = (c_text.value or "").strip()
                        if val and len(val) < 200:
                            texts.append(f"{c_class.value}:'{val}'")
                    except Exception:
                        pass
                    return True

                try:
                    user32.EnumChildWindows(parent_hwnd, WNDENUMPROC(enum_child_cb), 0)
                except Exception:
                    pass
                return texts[:10]

            def enum_windows_callback(hwnd, lparam):
                try:
                    if not user32.IsWindowVisible(hwnd):
                        return True
                    pid = wintypes.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    if pid.value not in mt5_pids:
                        return True

                    class_buf = ctypes.create_unicode_buffer(64)
                    user32.GetClassNameW(hwnd, class_buf, 64)
                    title_buf = ctypes.create_unicode_buffer(256)
                    user32.GetWindowTextW(hwnd, title_buf, 256)
                    win_class = class_buf.value or ""
                    win_title = (title_buf.value or "").strip()

                    # '#32770' é a classe padrão de Dialog/Popup modal do Windows usada pelo MT5 para prompts
                    if win_class == "#32770":
                        child_items = _get_child_texts(hwnd)
                        modal_info = {
                            "pid": pid.value,
                            "title": win_title or "(Sem Título)",
                            "controls": child_items,
                        }
                        state["modals"].append(modal_info)
                        if close_modals:
                            controls_str = ", ".join(child_items) if child_items else "sem textos filhos"
                            logger.warning(
                                f"[MODAL MT5 DETECTADO E FECHADO] PID={pid.value} | "
                                f"Título='{win_title}' | Conteúdo=[{controls_str}]"
                            )
                            user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
                    elif win_title and ("metatrader" in win_title.lower() or "metaquotes" in win_title.lower() or "-" in win_title):
                        state["main_windows"].append({
                            "pid": pid.value,
                            "class": win_class,
                            "title": win_title,
                        })
                except Exception:
                    pass
                return True

            user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        except Exception as e:
            logger.debug(f"Inspeção Win32 de janelas MT5 ignorada: {e}")
        return state

    @staticmethod
    def _dismiss_mt5_dialogs():
        """
        Detecta, registra detalhes no log e fecha automaticamente janelas modais/popups padrão do MT5 no Windows
        (ex: wizard 'Abrir Conta Demo', prompt de login manual ou avisos bloqueantes - classe Win32 '#32770').
        """
        SyncEngine.inspect_mt5_ui_state(close_modals=True)

    @staticmethod
    def _clean_pending_liveupdate():
        """
        Remove executáveis pendentes na pasta 'liveupdate' do MetaQuotes em AppData.
        Quando o MT5 baixa um update em background, ao iniciar ele tenta rodar liveupdate\\terminal64.exe,
        o que abre um prompt UAC do Windows e congela o Pipe Server IPC (-10003) por 60 segundos.
        """
        try:
            import os
            import shutil
            appdata = os.environ.get("APPDATA")
            if not appdata:
                return
            terminals_root = Path(appdata) / "MetaQuotes" / "Terminal"
            if not terminals_root.exists():
                return
            for liveupdate_dir in terminals_root.glob("*/liveupdate"):
                if liveupdate_dir.is_dir():
                    logger.info(f"Removendo pasta de LiveUpdate pendente que bloqueia o IPC: {liveupdate_dir}")
                    shutil.rmtree(liveupdate_dir, ignore_errors=True)
            # Também verifica em Common/liveupdate
            common_lu = terminals_root / "Common" / "liveupdate"
            if common_lu.is_dir():
                shutil.rmtree(common_lu, ignore_errors=True)
        except Exception as e:
            logger.debug(f"Limpeza preventiva de liveupdate ignorada: {e}")

    @staticmethod
    def _kill_duplicate_or_instance_terminals(keep_path: Optional[str] = None):
        """
        No MT5 Build 6296+, o servidor MCP/IPC faz bind fixo em 127.0.0.1:22346.
        Se houver mais de um terminal64.exe aberto (ex: instances/acc_*), ocorre erro 10048 (bind error on 127.0.0.1:22346)
        e esgota os 2 GB de RAM da VPS. Este método encerra imediatamente qualquer instância secundária em instances/acc_*.
        """
        import os
        norm_keep = os.path.normcase(os.path.abspath(keep_path)) if keep_path else None
        running_procs = []
        for proc in psutil.process_iter(['pid', 'name', 'exe']):
            try:
                name = (proc.info.get('name') or '').lower()
                if 'terminal64' not in name:
                    continue
                exe_path = proc.info.get('exe') or ''
                norm_exe = os.path.normcase(os.path.abspath(exe_path)) if exe_path else ''
                if 'instances' in norm_exe or (norm_keep and norm_exe and norm_exe != norm_keep):
                    logger.warning(
                        f"Encerrando instância secundária terminal64.exe (PID: {proc.info['pid']}, Path: {exe_path}) "
                        f"para liberar a porta IPC 127.0.0.1:22346 e memória RAM..."
                    )
                    proc.kill()
                else:
                    running_procs.append(proc)
            except Exception:
                pass

        if len(running_procs) > 1:
            for extra_proc in running_procs[1:]:
                try:
                    logger.warning(f"Encerrando processo terminal64.exe duplicado (PID: {extra_proc.pid}) para liberar porta 22346...")
                    extra_proc.kill()
                except Exception:
                    pass

    @staticmethod
    def _kill_stuck_terminals(target_path: Optional[str] = None):
        """Encerra processos terminal64.exe presos que possam estar bloqueando a porta IPC 127.0.0.1:22346."""
        for proc in psutil.process_iter(['pid', 'name', 'exe']):
            try:
                name = proc.info.get('name') or ''
                if 'terminal64' in name.lower():
                    logger.warning(f"Encerrando processo terminal64 (PID: {proc.info['pid']}) para liberar porta 127.0.0.1:22346...")
                    proc.kill()
            except Exception:
                pass

    def _wait_for_broker_sync(self, expected_login: int, timeout_sec: float = 12.0) -> bool:
        """
        Aguarda até que o terminal MT5 finalize o handshake de rede com a corretora (terminal_info.connected)
        e carregue os dados reais da conta (evita ler Saldo $0.00 e Ping 10000.0ms logo após abrir o terminal).
        """
        if not MT5_AVAILABLE:
            return True
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            self._dismiss_mt5_dialogs()
            info = mt5.account_info()
            term = mt5.terminal_info()
            if info is not None and (not expected_login or int(info.login) == int(expected_login)):
                is_conn = term is None or bool(getattr(term, "connected", False))
                ping_raw = int(getattr(term, "ping_last", 0) or 0) if term is not None else 0
                bal = float(getattr(info, "balance", 0.0) or 0.0)
                holder = (getattr(info, "name", "") or "").strip()
                # Ping 10000000 (10000.0ms) com saldo 0.0 significa que o handshake TCP ainda não concluiu
                handshake_ready = is_conn and (bal > 0 or bool(holder) or (0 < ping_raw < 9999000))
                if handshake_ready:
                    return True
            time.sleep(0.5)
        info = mt5.account_info()
        return info is not None and (not expected_login or int(info.login) == int(expected_login))

    @staticmethod
    def _normalize_broker_server(server: str) -> str:
        """Corrige erros comuns de digitação de servidores de corretoras (ex: Deric-demo -> Deriv-Demo, goatfunded-server2 -> GoatFunded-Server2)."""
        s = (server or "").strip()
        lower = s.lower()
        typo_map = {
            "deric-demo": "Deriv-Demo",
            "deriv-demo": "Deriv-Demo",
            "deric-server": "Deriv-Server",
            "deriv-server": "Deriv-Server",
            "deric-server-02": "Deriv-Server-02",
            "deriv-server-02": "Deriv-Server-02",
            "deriv-server-03": "Deriv-Server-03",
            "goatfunded-server": "GoatFunded-Server",
            "goatfunded-server2": "GoatFunded-Server2",
            "goatfunded-server 2": "GoatFunded-Server2",
            "goatfunded-server-2": "GoatFunded-Server2",
            "goatfunded-server3": "GoatFunded-Server3",
            "goatfunded-demo": "GoatFunded-Demo",
            "goatfundedtrader-server": "GoatFundedTrader-Server",
            "goatfundedtrader-server2": "GoatFundedTrader-Server2",
            "ftmo-demo": "FTMO-Demo",
            "ftmo-demo2": "FTMO-Demo2",
            "ftmo-server": "FTMO-Server",
            "ftmo-server2": "FTMO-Server2",
            "ftmo-server3": "FTMO-Server3",
            "ftmo-server4": "FTMO-Server4",
            "fundednext-trial": "FundedNext-Trial",
            "fundednext-server": "FundedNext-Server",
            "fundingpips-demo": "FundingPips-Demo",
            "fundingpips-server": "FundingPips-Server",
            "fundingpips-server2": "FundingPips-Server2",
            "fundingpips-server3": "FundingPips-Server3",
            "fivepercentonline-real": "FivePercentOnline-Real",
            "fivepercentonline-demo": "FivePercentOnline-Demo",
            "alphacapitalgroup-server": "AlphaCapitalGroup-Server",
            "alphacapitalgroup-server2": "AlphaCapitalGroup-Server2",
            "alphacapitalgroup-demo": "AlphaCapitalGroup-Demo",
            "maven-server": "Maven-Server",
            "maven-server2": "Maven-Server2",
            "maven-demo": "Maven-Demo",
            "e8markets-server": "E8Markets-Server",
            "e8markets-demo": "E8Markets-Demo",
            "blueguardian-server": "BlueGuardian-Server",
            "blueguardian-server2": "BlueGuardian-Server2",
            "blueguardian-demo": "BlueGuardian-Demo",
            "fxify-server": "FXIFY-Server",
            "fxify-demo": "FXIFY-Demo",
        }
        return typo_map.get(lower, s)

    @staticmethod
    def _is_account_authenticated(info: Any, expected_login: int, expected_server: Optional[str] = None) -> bool:
        """
        Verifica se o terminal MT5 já está posicionado na conta esperada.
        Nota: Contas demo/reais podem legitimamente ter saldo $0.00 e name='' (como 202658742 @ Deriv-Demo).
        """
        if info is None or str(getattr(info, "login", "")) != str(expected_login):
            return False
        if expected_server:
            current_srv = str(getattr(info, "server", "") or "").strip().lower()
            target_srv = expected_server.strip().lower()
            if current_srv and target_srv and current_srv != target_srv:
                return False
        return True

    def _run_with_dialog_watchdog(self, fn, initial_delay: float = 2.5):
        """
        Executa uma chamada IPC bloqueante (mt5.initialize / mt5.login) monitorando e fechando
        em background qualquer popup modal Win32 ('#32770', ex: 'Login') que trave a thread UI do MT5.
        """
        stop_evt = threading.Event()

        def _watchdog():
            if stop_evt.wait(initial_delay):
                return
            while not stop_evt.wait(1.0):
                try:
                    self._dismiss_mt5_dialogs()
                except Exception:
                    pass

        t = threading.Thread(target=_watchdog, daemon=True)
        t.start()
        try:
            return fn()
        finally:
            stop_evt.set()

    def ensure_connected(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        path: Optional[str] = None,
        progress_callback: Optional[Any] = None,
    ) -> bool:
        """Garante que a sessão IPC com o terminal MT5 está ativa e na conta correta antes da sincronização."""
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                self.connected_account = account_id
                return True

            from config.settings import settings
            self._kill_duplicate_or_instance_terminals(keep_path=settings.mt5_default_path or path)
            self._dismiss_mt5_dialogs()
            login_clean = int(str(login).strip()) if str(login).strip().isdigit() else 0
            server_clean = self._normalize_broker_server(server)

            try:
                info = mt5.account_info()
                if self._is_account_authenticated(info, login_clean, server_clean):
                    self.connected_account = account_id
                    return True
            except Exception:
                pass

            return self.connect_account(
                account_id,
                login,
                server,
                password,
                path,
                progress_callback=progress_callback,
            )

    def connect_account(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        path: Optional[str] = None,
        progress_callback: Optional[Any] = None,
    ) -> bool:
        """Conecta ao terminal MT5 isolado da conta reutilizando a instância ativa sem derrubar outras contas."""
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                logger.warning(f"[Mock] Conectando mock MT5 para conta {account_id}")
                self.connected_account = account_id
                return True

            import os
            login_clean = int(str(login).strip()) if str(login).strip().isdigit() else 0
            server_clean = self._normalize_broker_server(server)
            if server and server_clean != server.strip():
                logger.info(f"Servidor da corretora normalizado automaticamente: '{server}' -> '{server_clean}'")
            pass_clean = str(password).strip() if password else ""
            from config.settings import settings
            term_path = settings.mt5_default_path or path

            # Se o executável estiver em C:\Program Files, portable=True exige UAC para gravar na pasta.
            use_portable = "program files" not in (term_path or "").lower()

            # Encerra qualquer instância secundária (instances/acc_*) que cause conflito na porta 127.0.0.1:22346 (erro 10048)
            self._kill_duplicate_or_instance_terminals(keep_path=term_path)
            # Remove qualquer atualização automática pendente que trave o Pipe Server (-10003) e fecha popups
            self._clean_pending_liveupdate()
            self._dismiss_mt5_dialogs()

            # Passo 1: Verifica se o IPC já está ativo no terminal principal ou anexa a ele (SEM chamar mt5.shutdown()!)
            init_ok = False
            try:
                term_info = mt5.terminal_info()
                if term_info is not None and isinstance(getattr(term_info, "name", None), str):
                    init_ok = True
                else:
                    if progress_callback:
                        progress_callback(f"Conectando ao canal IPC do terminal MT5 para conta {login_clean}...")
                    init_ok = self._run_with_dialog_watchdog(lambda: mt5.initialize(timeout=15000))
                    if not init_ok and term_path:
                        init_ok = self._run_with_dialog_watchdog(
                            lambda: mt5.initialize(path=term_path, portable=use_portable, timeout=25000)
                        )
            except Exception as e:
                logger.debug(f"Terminal ativo não respondeu na tentativa rápida: {e}")

            # Passo 2: Se o terminal principal não responder, reinicia o processo terminal64.exe
            if not init_ok:
                logger.info(f"Nenhum terminal ativo respondeu. Inicializando MT5 via: {term_path}")
                if progress_callback:
                    progress_callback(f"Inicializando processo MetaTrader 5 na VPS para {login_clean}@{server_clean}...")
                self._kill_stuck_terminals()
                self._clean_pending_liveupdate()
                time.sleep(2.0)
                try:
                    init_ok = self._run_with_dialog_watchdog(
                        lambda: mt5.initialize(path=term_path, portable=use_portable, timeout=60000),
                        initial_delay=4.0,
                    )
                except Exception as e:
                    logger.error(f"Erro ao inicializar terminal MT5 via path: {e}")

            self._dismiss_mt5_dialogs()

            if not init_ok:
                err = mt5.last_error()
                self.last_connect_error = f"Não foi possível inicializar o processo MT5 na VPS: {err}"
                logger.error(self.last_connect_error)
                return False

            self.active_terminal_path = term_path

            # Passo 3: Verifica se já está na conta correta (evita chamar mt5.login desnecessariamente!)
            self.last_error_code = None
            if login_clean:
                ui_before = self.inspect_mt5_ui_state(close_modals=True)
                info = mt5.account_info()
                term_now = mt5.terminal_info()
                curr_login = getattr(info, "login", None) if info else None
                curr_srv = getattr(info, "server", None) if info else None
                curr_name = (getattr(info, "name", "") or "").strip() if info else ""
                curr_bal = float(getattr(info, "balance", 0.0) or 0.0) if info else 0.0
                curr_conn = getattr(term_now, "connected", False) if term_now else False
                main_titles = [w["title"] for w in ui_before.get("main_windows", [])]
                modal_titles = [f"{m['title']} ({', '.join(m['controls'])})" for m in ui_before.get("modals", [])]

                if self._is_account_authenticated(info, login_clean, server_clean):
                    if not (curr_name or curr_bal > 0):
                        # Aguarda até 6s caso o MT5 tenha acabado de abrir na conta padrão e ainda esteja sincronizando
                        self._wait_for_broker_sync(login_clean, timeout_sec=6.0)
                        info = mt5.account_info()
                        curr_name = (getattr(info, "name", "") or "").strip() if info else ""
                        curr_bal = float(getattr(info, "balance", 0.0) or 0.0) if info else 0.0

                    if curr_name or curr_bal > 0:
                        logger.success(
                            f"Sessão MT5 já autenticada na conta {login_clean}: {curr_name or 'Ativa'} "
                            f"({getattr(info, 'server', server_clean)} | Saldo: ${curr_bal:.2f})!"
                        )
                        self.connected_account = account_id
                        self.last_connect_error = None
                        return True
                    else:
                        logger.warning(
                            f"Conta {login_clean} está selecionada no MT5 (ícone amarelo sem nome / saldo 0.0). "
                            f"Tentando autenticar com o servidor {server_clean}..."
                        )

                if server_clean:
                    pwd_diag = self._mask_password_diagnostic(pass_clean)
                    logger.info(
                        f"[DIAGNÓSTICO DE LOGIN MT5] "
                        f"Alvo: login={login_clean} @ servidor='{server_clean}' | Senha={pwd_diag} | "
                        f"Estado Atual no MT5: login_atual={curr_login} @ '{curr_srv}' (nome='{curr_name}', saldo=${curr_bal:.2f}, conectado={curr_conn}) | "
                        f"Janela MT5={main_titles or ['(oculta/background)']} | Modais={modal_titles or ['nenhum']}"
                    )

                    max_attempts = 2
                    for attempt in range(1, max_attempts + 1):
                        self._dismiss_mt5_dialogs()
                        info = mt5.account_info()
                        if self._is_account_authenticated(info, login_clean, server_clean):
                            if (getattr(info, "name", "") or "").strip() or float(getattr(info, "balance", 0.0) or 0.0) > 0:
                                logger.success(f"Conta {login_clean} ({server_clean}) ativa e autenticada no MT5!")
                                break

                        msg_step = (
                            f"Tentativa {attempt}/{max_attempts}: Autenticando conta {login_clean} "
                            f"no servidor {server_clean} (Senha: {pwd_diag})..."
                        )
                        logger.info(msg_step)
                        if progress_callback:
                            progress_callback(f"Tentativa {attempt}/{max_attempts}: Autenticando conta {login_clean} no servidor {server_clean}...")

                        if pass_clean:
                            login_ok = self._run_with_dialog_watchdog(
                                lambda: mt5.login(
                                    login=login_clean,
                                    password=pass_clean,
                                    server=server_clean,
                                    timeout=20000,
                                ),
                                initial_delay=3.0,
                            )
                        else:
                            login_ok = self._run_with_dialog_watchdog(
                                lambda: mt5.login(
                                    login=login_clean,
                                    server=server_clean,
                                    timeout=20000,
                                ),
                                initial_delay=3.0,
                            )

                        if login_ok:
                            logger.success(f"Login efetuado com sucesso na conta {login_clean} ({server_clean})!")
                            break

                        err = mt5.last_error()
                        err_code = err[0] if isinstance(err, (tuple, list)) and len(err) > 0 else None
                        self.last_error_code = err_code
                        ui_after_err = self.inspect_mt5_ui_state(close_modals=True)
                        after_titles = [w["title"] for w in ui_after_err.get("main_windows", [])]
                        after_modals = [f"{m['title']} ({', '.join(m['controls'])})" for m in ui_after_err.get("modals", [])]

                        logger.warning(
                            f"Tentativa {attempt}/{max_attempts} de login para {login_clean}@{server_clean} retornou {err}. "
                            f"Janela MT5={after_titles or ['(background)']} | Modais={after_modals or ['nenhum']}"
                        )

                        # Se o erro for -6 (Terminal: Authorization failed), o canal IPC está saudável!
                        # Antes de abortar, se enviamos pass_clean e falhou, tentamos um fallback sem senha
                        # para aproveitar o 'Save password' (Quick Login) nativo do MT5 caso o usuário tenha salvo no terminal.
                        if err_code == -6:
                            if pass_clean:
                                logger.info(
                                    f"Tentando fallback via 'Save Password' (Quick Login interno do MT5) "
                                    f"para {login_clean}@{server_clean}..."
                                )
                                quick_ok = self._run_with_dialog_watchdog(
                                    lambda: mt5.login(
                                        login=login_clean,
                                        server=server_clean,
                                        timeout=15000,
                                    ),
                                    initial_delay=2.5,
                                )
                                if quick_ok:
                                    logger.success(
                                        f"Login efetuado via Quick Login ('Save password' do MT5) "
                                        f"na conta {login_clean} ({server_clean})!"
                                    )
                                    break

                            self.last_connect_error = (
                                f"Falha de autorização (-6) no MT5 para a conta {login_clean} no servidor '{server_clean}' "
                                f"(Senha enviada: {pwd_diag}). Verifique se o número da conta e a senha pertencem a '{server_clean}' "
                                f"e se o servidor '{server_clean}' já foi buscado em 'File -> Open an Account' no MT5 da VPS."
                            )
                            logger.error(self.last_connect_error)
                            return False

                        time.sleep(2.0)
                        self._dismiss_mt5_dialogs()

                        # IMPORTANTE: Não chama mt5.shutdown() aqui para não derrubar o pipe IPC (-10004)!
                        info_after = mt5.account_info()
                        if info_after is None:
                            mt5.initialize(timeout=10000)
                            info_after = mt5.account_info()

                        if self._is_account_authenticated(info_after, login_clean, server_clean):
                            holder_after = (getattr(info_after, "name", "") or "").strip()
                            bal_after = float(getattr(info_after, "balance", 0.0) or 0.0)
                            if holder_after or bal_after > 0:
                                logger.success(
                                    f"Conta {login_clean}: {holder_after} ({server_clean}) confirmada ativa no MT5!"
                                )
                                break
                            elif attempt == max_attempts:
                                self._wait_for_broker_sync(login_clean, timeout_sec=5.0)
                                info_after = mt5.account_info()
                                holder_after = (getattr(info_after, "name", "") or "").strip() if info_after else ""
                                bal_after = float(getattr(info_after, "balance", 0.0) or 0.0) if info_after else 0.0
                                if holder_after or bal_after > 0:
                                    logger.success(
                                        f"Conta {login_clean}: {holder_after} ({server_clean}) sincronizada após espera!"
                                    )
                                    break
                                self.last_connect_error = (
                                    f"Conta {login_clean} posicionada em '{server_clean}', porém sem autenticação/resposta da corretora "
                                    f"(ícone amarelo sem titular no MT5 e saldo $0.00). Verifique se o número da conta e a senha pertencem a '{server_clean}' "
                                    f"e se o servidor '{server_clean}' está cadastrado em 'File -> Open an Account' no MT5 da VPS."
                                )
                                logger.error(self.last_connect_error)
                                return False
                    else:
                        final_info = mt5.account_info()
                        holder_final = (getattr(final_info, "name", "") or "").strip() if final_info else ""
                        bal_final = float(getattr(final_info, "balance", 0.0) or 0.0) if final_info else 0.0
                        if not self._is_account_authenticated(final_info, login_clean, server_clean) or not (holder_final or bal_final > 0):
                            err = mt5.last_error()
                            self.last_connect_error = (
                                f"Falha ao autenticar conta {login_clean} em '{server_clean}': {err}. "
                                f"Verifique o número da conta, a senha e o servidor."
                            )
                            logger.error(self.last_connect_error)
                            return False

                self._wait_for_broker_sync(login_clean, timeout_sec=6.0)

            self.connected_account = account_id
            self.last_connect_error = None
            return True

    def disconnect(self):
        """Desconecta a sessão MT5 atual."""
        with self._ipc_lock:
            if MT5_AVAILABLE:
                mt5.shutdown()
            self.connected_account = None

    @staticmethod
    def get_resource_snapshot() -> dict:
        """Coleta snapshot imediato de memória e CPU para diagnóstico técnico de extração."""
        cpu_usage = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        used_mb = round((mem.total - mem.available) / (1024 * 1024), 1)
        total_mb = round(mem.total / (1024 * 1024), 1)
        available_mb = round(mem.available / (1024 * 1024), 1)
        mem_percent = round(mem.percent, 1)
        return {
            "cpu_percent": cpu_usage,
            "memory_percent": mem_percent,
            "memory_used_mb": used_mb,
            "memory_total_mb": total_mb,
            "memory_available_mb": available_mb
        }

    def fetch_account_info(self, account_id: int, login: str, server: str) -> Optional[AccountInfo]:
        """Obtém dados completos de saldo, patrimônio, margem, ping e status de conexão da conta."""
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                return AccountInfo(
                    accountId=account_id,
                    login=login,
                    server=server,
                    currency="USD",
                    balance=10000.0,
                    equity=10050.0,
                    margin=250.0,
                    freeMargin=9800.0,
                    marginLevel=4020.0,
                    leverage=100,
                    profit=50.0,
                )

            try:
                info = mt5.account_info()
                if info is None:
                    logger.warning(f"Não foi possível obter account_info(): {mt5.last_error()}")
                    return None

                active_login_str = str(getattr(info, "login", "") or "").strip()
                expected_login_str = str(login or account_id).strip()
                if expected_login_str and active_login_str != expected_login_str:
                    logger.error(
                        f"[ISOLAMENTO DE CONTA] Abortando leitura de account_info: terminal está na conta "
                        f"{active_login_str} ({getattr(info, 'server', '')}), mas a sincronização pediu {expected_login_str} ({server})."
                    )
                    return None

                term = mt5.terminal_info()
                ping_raw = getattr(term, "ping_last", 0) if term is not None else 0
                ping_ms = round(float(ping_raw or 0) / 1000.0, 2) if isinstance(ping_raw, (int, float)) else 0.0
                term_build = getattr(term, "build", None) if term is not None else None
                term_build_int = int(term_build) if isinstance(term_build, int) else None
                term_connected = bool(getattr(term, "connected", True)) if term is not None else True

                raw_mode = getattr(info, "trade_mode", 0)
                trade_mode_map = {0: "DEMO", 1: "CONTEST", 2: "REAL"}
                trade_mode_str = trade_mode_map.get(raw_mode, "DEMO" if "demo" in str(server).lower() else "REAL")
                actual_server = str(getattr(info, "server", "") or server)

                return AccountInfo(
                    accountId=account_id,
                    login=login,
                    server=actual_server,
                    currency=str(getattr(info, "currency", "USD") or "USD"),
                    balance=float(getattr(info, "balance", 0.0) or 0.0),
                    equity=float(getattr(info, "equity", 0.0) or 0.0),
                    margin=float(getattr(info, "margin", 0.0) or 0.0),
                    freeMargin=float(getattr(info, "margin_free", 0.0) or 0.0),
                    marginLevel=float(getattr(info, "margin_level", 0.0) or 0.0),
                    leverage=int(getattr(info, "leverage", 1) or 1),
                    profit=float(getattr(info, "profit", 0.0) or 0.0),
                    credit=float(getattr(info, "credit", 0.0) or 0.0),
                    company=str(getattr(info, "company", "") or ""),
                    name=str(getattr(info, "name", "") or ""),
                    tradeMode=trade_mode_str,
                    tradeAllowed=bool(getattr(info, "trade_allowed", True)),
                    tradeExpert=bool(getattr(info, "trade_expert", True)),
                    pingMs=ping_ms,
                    terminalBuild=term_build_int,
                    connected=term_connected,
                )
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair account_info para conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Abortando."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_account_info", account_id=account_id)
            except Exception as e:
                logger.error(f"Erro inesperado ao extrair account_info para conta {account_id}: {e}")
                return None

    def fetch_positions(self, account_id: int, login: Optional[str] = None) -> SyncPositionsPayload:
        """Obtém todas as posições abertas no momento."""
        with self._ipc_lock:
            positions_list: List[PositionData] = []
            if not MT5_AVAILABLE:
                return SyncPositionsPayload(accountId=account_id, login=login, positions=positions_list)

            try:
                if login:
                    info = mt5.account_info()
                    if info is None or str(getattr(info, "login", "")).strip() != str(login).strip():
                        logger.warning(
                            f"[ISOLAMENTO DE CONTA] Ignorando positions_get para {login}: "
                            f"terminal ativo em {getattr(info, 'login', 'None')}."
                        )
                        return SyncPositionsPayload(accountId=account_id, login=login, positions=positions_list, skipped=True)

                positions = mt5.positions_get()
                if positions is None:
                    return SyncPositionsPayload(accountId=account_id, login=login, positions=positions_list, skipped=True)
                for pos in positions:
                    positions_list.append(PositionData(
                        ticket=pos.ticket,
                        symbol=pos.symbol,
                        type="POSITION_TYPE_BUY" if pos.type == mt5.POSITION_TYPE_BUY else "POSITION_TYPE_SELL",
                        volume=pos.volume,
                        priceOpen=pos.price_open,
                        priceCurrent=pos.price_current,
                        sl=pos.sl,
                        tp=pos.tp,
                        profit=pos.profit,
                        swap=pos.swap,
                        magic=pos.magic,
                        comment=pos.comment,
                        time=datetime.datetime.fromtimestamp(pos.time, tz=datetime.timezone.utc),
                    ))

                return SyncPositionsPayload(accountId=account_id, login=login, positions=positions_list, skipped=False)
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair posições para conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Abortando."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_positions", account_id=account_id)

    def fetch_orders(self, account_id: int, login: Optional[str] = None) -> SyncOrdersPayload:
        """Obtém ordens pendentes ativas."""
        with self._ipc_lock:
            orders_list: List[OrderData] = []
            if not MT5_AVAILABLE:
                return SyncOrdersPayload(accountId=account_id, login=login, orders=orders_list)

            try:
                if login:
                    info = mt5.account_info()
                    if info is None or str(getattr(info, "login", "")).strip() != str(login).strip():
                        return SyncOrdersPayload(accountId=account_id, login=login, orders=orders_list)

                orders = mt5.orders_get()
                if orders is not None:
                    for ord_item in orders:
                        orders_list.append(OrderData(
                            ticket=ord_item.ticket,
                            symbol=ord_item.symbol,
                            type=str(ord_item.type),
                            state=str(ord_item.state),
                            volumeInitial=ord_item.volume_initial,
                            volumeCurrent=ord_item.volume_current,
                            priceOpen=ord_item.price_open,
                            sl=ord_item.sl,
                            tp=ord_item.tp,
                            timeSetup=datetime.datetime.fromtimestamp(ord_item.time_setup, tz=datetime.timezone.utc),
                            magic=ord_item.magic,
                            comment=ord_item.comment,
                        ))

                return SyncOrdersPayload(accountId=account_id, login=login, orders=orders_list)
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair ordens para conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Abortando."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_orders", account_id=account_id)

    def _get_broker_utc_offset_seconds(self) -> int:
        """
        Estima o offset do fuso horário do servidor da corretora (em segundos) em relação ao UTC
        arredondado para múltiplos de 30 minutos (1800s), evitando deslocamento de 2-3h nos deals MT5.
        """
        if not MT5_AVAILABLE:
            return 0
        try:
            now_utc_ts = time.time()
            for sym in ("EURUSD", "XAUUSD", "BTCUSD", "GBPUSD", "USDJPY"):
                tick = mt5.symbol_info_tick(sym)
                if tick and getattr(tick, "time", 0) > 0:
                    diff = float(tick.time) - now_utc_ts
                    if abs(diff) <= 14 * 3600:
                        return int(round(diff / 1800.0) * 1800)
        except Exception:
            pass
        return 0

    def _find_entry_deal(self, position_id: int, cached_entries: Dict[int, Any]) -> Optional[Any]:
        """Localiza o deal de abertura (DEAL_ENTRY_IN) de uma posição para reconstruir preço/hora de entrada."""
        if not position_id:
            return None
        if position_id in cached_entries:
            return cached_entries[position_id]
        try:
            pos_deals = mt5.history_deals_get(position=position_id)
            if pos_deals:
                for pd in pos_deals:
                    if pd.entry == 0:  # DEAL_ENTRY_IN
                        cached_entries[position_id] = pd
                        return pd
        except Exception:
            pass
        return None

    def fetch_incremental_deals(
        self,
        account_id: int,
        login: Optional[str] = None,
        server: Optional[str] = None,
        last_deal_ticket: int = 0,
        last_deal_time: Optional[datetime.datetime] = None,
        from_date: Optional[datetime.datetime] = None
    ) -> SyncTradesPayload:
        """
        Coleta negócios fechados (deals) de forma incremental com Watermark de data
        e reconstrói preços/horários/direção reais pareando DEAL_ENTRY_IN + DEAL_ENTRY_OUT via position_id.
        """
        with self._ipc_lock:
            trades_list: List[DealData] = []
            max_ticket = last_deal_ticket

            if not MT5_AVAILABLE:
                return SyncTradesPayload(
                    accountId=account_id,
                    login=login,
                    server=server,
                    lastDealTicket=max_ticket,
                    trades=[]
                )

            now_utc = datetime.datetime.now(datetime.timezone.utc)
            # +24h garante cobertura para qualquer fuso horário de corretora (ex: UTC+2, UTC+3)
            end_time = (now_utc + datetime.timedelta(days=1)).replace(tzinfo=None)

            if from_date is not None:
                start_time = from_date
            elif last_deal_ticket > 0 and last_deal_time is not None:
                # Janela deslizante incremental com folga de 7 dias
                start_time = last_deal_time - datetime.timedelta(days=7)
            elif last_deal_ticket > 0:
                start_time = now_utc - datetime.timedelta(days=14)
            else:
                # Primeira sincronização completa
                start_time = datetime.datetime(2020, 1, 1)

            if isinstance(start_time, datetime.datetime) and start_time.tzinfo is not None:
                start_time = start_time.replace(tzinfo=None)

            try:
                if login:
                    info = mt5.account_info()
                    if info is None or str(getattr(info, "login", "")).strip() != str(login).strip():
                        logger.error(
                            f"[ISOLAMENTO DE CONTA] Abortando history_deals_get para {login}: "
                            f"terminal ativo em {getattr(info, 'login', 'None')}."
                        )
                        return SyncTradesPayload(
                            accountId=account_id,
                            login=login,
                            server=server,
                            lastDealTicket=last_deal_ticket,
                            trades=[]
                        )

                deals = mt5.history_deals_get(start_time, end_time)
                if deals is None:
                    start_ts = int(start_time.timestamp())
                    end_ts = int(end_time.timestamp())
                    deals = mt5.history_deals_get(start_ts, end_ts)

                if deals is None:
                    err = mt5.last_error()
                    logger.warning(f"mt5.history_deals_get retornou None para conta {login or account_id}: {err}")
                    return SyncTradesPayload(
                        accountId=account_id,
                        login=login,
                        server=server,
                        lastDealTicket=last_deal_ticket,
                        trades=[]
                    )

                # Cache rápido dos deals de entrada (DEAL_ENTRY_IN) presentes na janela
                entry_by_position: Dict[int, Any] = {}
                out_count_by_position: Dict[int, int] = {}
                for d in deals:
                    if d.ticket > max_ticket:
                        max_ticket = d.ticket
                    if d.entry == 0 and d.position_id:
                        entry_by_position[d.position_id] = d
                    elif d.entry in (1, 2, 3) and d.position_id:
                        out_count_by_position[d.position_id] = out_count_by_position.get(d.position_id, 0) + 1

                broker_offset_sec = self._get_broker_utc_offset_seconds()

                for d in deals:
                    if d.ticket <= last_deal_ticket:
                        continue

                    # Posições em aberto já vão via /sync/positions; em /sync/trades enviamos deals de fechamento
                    # (DEAL_ENTRY_OUT=1, DEAL_ENTRY_INOUT=2, DEAL_ENTRY_OUT_BY=3) para evitar colisão de positionId com profit=0
                    if d.entry == 0 and d.type in (0, 1):
                        continue

                    entry_type = DEAL_ENTRY_MAP.get(d.entry, "DEAL_ENTRY_OUT")
                    raw_deal_type = DEAL_TYPE_MAP.get(d.type, "DEAL_TYPE_BALANCE")

                    close_time = datetime.datetime.fromtimestamp(max(0, d.time - broker_offset_sec), tz=datetime.timezone.utc)
                    open_price = d.price
                    open_time = None
                    total_commission = float(d.commission or 0.0) + float(getattr(d, "fee", 0.0) or 0.0)
                    trade_direction = raw_deal_type

                    if d.type in (0, 1):
                        entry_deal = self._find_entry_deal(d.position_id, entry_by_position)
                        if entry_deal is not None:
                            open_price = float(entry_deal.price)
                            open_time = datetime.datetime.fromtimestamp(max(0, entry_deal.time - broker_offset_sec), tz=datetime.timezone.utc)
                            # Soma a comissão cobrada na abertura quando não houver múltiplas saídas parciais
                            if out_count_by_position.get(d.position_id, 1) <= 1:
                                total_commission += float(entry_deal.commission or 0.0) + float(getattr(entry_deal, "fee", 0.0) or 0.0)
                            trade_direction = "DEAL_TYPE_BUY" if entry_deal.type == 0 else "DEAL_TYPE_SELL"
                        elif d.entry in (1, 3):
                            # No MT5, um DEAL_ENTRY_OUT de SELL fecha uma posição de BUY (e vice-versa)
                            trade_direction = "DEAL_TYPE_BUY" if d.type == 1 else "DEAL_TYPE_SELL"

                    deal_obj = DealData(
                        ticket=d.ticket,
                        orderTicket=d.order,
                        positionId=d.position_id if out_count_by_position.get(d.position_id, 1) <= 1 else d.ticket,
                        symbol=d.symbol or "",
                        type=trade_direction,
                        entry=entry_type,
                        volume=d.volume,
                        price=d.price,
                        openPrice=open_price,
                        profit=d.profit,
                        commission=round(total_commission, 2),
                        swap=d.swap,
                        magic=d.magic,
                        comment=d.comment or "",
                        time=close_time,
                        openTime=open_time,
                    )
                    trades_list.append(deal_obj)

                return SyncTradesPayload(
                    accountId=account_id,
                    login=login,
                    server=server,
                    lastDealTicket=max_ticket,
                    trades=trades_list
                )
            except MemoryError:
                res = self.get_resource_snapshot()
                err_msg = (
                    f"[ESGOTAMENTO DE MEMÓRIA] Falha ao extrair negócios (deals) da conta {account_id}! "
                    f"Memória Consumida: {res['memory_used_mb']} MB / {res['memory_total_mb']} MB ({res['memory_percent']}%) | "
                    f"RAM Livre: {res['memory_available_mb']} MB | CPU: {res['cpu_percent']}%. Interrompendo para evitar colapso."
                )
                logger.critical(err_msg)
                raise ResourceExhaustionError(err_msg, res, operation="fetch_incremental_deals", account_id=account_id)
            except Exception as e:
                res = self.get_resource_snapshot()
                logger.error(
                    f"[ERRO EXTRAÇÃO DEALS] Falha ao processar deals da conta {account_id}: {e}. "
                    f"Memória Consumida: {res['memory_used_mb']} MB ({res['memory_percent']}%) | CPU: {res['cpu_percent']}%"
                )
                return SyncTradesPayload(
                    accountId=account_id,
                    login=login,
                    server=server,
                    lastDealTicket=last_deal_ticket,
                    trades=[]
                )

