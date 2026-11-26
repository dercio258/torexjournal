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
        self._broker_tz_cache: Dict[str, Dict[str, Any]] = {}
        self._load_broker_tz_cache()

    def _get_tz_cache_file(self) -> Path:
        try:
            from config.settings import settings
            return Path(settings.data_dir).resolve() / "broker_tz_offsets.json"
        except Exception:
            return Path("data/broker_tz_offsets.json").resolve()

    def _load_broker_tz_cache(self):
        try:
            import json
            fp = self._get_tz_cache_file()
            if fp.exists():
                raw = json.loads(fp.read_text(encoding="utf-8", errors="ignore"))
                if isinstance(raw, dict):
                    self._broker_tz_cache = raw
        except Exception as e:
            logger.debug(f"Não foi possível carregar cache de fusos horários MT5: {e}")

    def _save_broker_tz_cache(self):
        try:
            import json
            fp = self._get_tz_cache_file()
            fp.parent.mkdir(parents=True, exist_ok=True)
            tmp = fp.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._broker_tz_cache, indent=2), encoding="utf-8")
            tmp.replace(fp)
        except Exception as e:
            logger.debug(f"Não foi possível salvar cache de fusos horários MT5: {e}")

    @staticmethod
    def _is_us_dst_at_server_epoch(raw_server_ts: int) -> bool:
        """
        Verifica se um timestamp wall-clock do servidor MT5 cai no horário de verão dos EUA
        (2º domingo de março às 02:00 até 1º domingo de novembro às 02:00 — padrão NY-Close GMT+2/GMT+3).
        """
        dt = datetime.datetime.fromtimestamp(int(raw_server_ts), tz=datetime.timezone.utc)
        m = dt.month
        if m < 3 or m > 11:
            return False
        if 3 < m < 11:
            return True
        if m == 3:
            first_wd = datetime.date(dt.year, 3, 1).weekday()  # Mon=0 .. Sun=6
            first_sun = 1 + ((6 - first_wd) % 7)
            second_sun = first_sun + 7
            return (dt.day > second_sun) or (dt.day == second_sun and dt.hour >= 2)
        # m == 11
        first_wd = datetime.date(dt.year, 11, 1).weekday()
        first_sun = 1 + ((6 - first_wd) % 7)
        return (dt.day < first_sun) or (dt.day == first_sun and dt.hour < 2)

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
    def _clean_pending_liveupdate(target_path: Optional[str] = None):
        """
        Remove executáveis pendentes na pasta 'liveupdate' do MetaQuotes em AppData e também
        dentro da instância portátil alvo (instances/acc_*/liveupdate).
        Quando o MT5 baixa um update em background, ao iniciar ele tenta rodar liveupdate\\terminal64.exe,
        o que abre um prompt UAC/reinício do Windows e congela o Pipe Server IPC (-10003 / -10005).
        """
        try:
            import os
            import shutil
            appdata = os.environ.get("APPDATA")
            if appdata:
                terminals_root = Path(appdata) / "MetaQuotes" / "Terminal"
                if terminals_root.exists():
                    for liveupdate_dir in terminals_root.glob("*/liveupdate"):
                        if liveupdate_dir.is_dir():
                            logger.info(f"Removendo pasta de LiveUpdate pendente que bloqueia o IPC: {liveupdate_dir}")
                            shutil.rmtree(liveupdate_dir, ignore_errors=True)
                    common_lu = terminals_root / "Common" / "liveupdate"
                    if common_lu.is_dir():
                        shutil.rmtree(common_lu, ignore_errors=True)

            if target_path:
                inst_root = Path(target_path).resolve().parent
                for lu_name in ("liveupdate", "LiveUpdate"):
                    inst_lu = inst_root / lu_name
                    if inst_lu.is_dir():
                        logger.info(f"Removendo LiveUpdate pendente na instância portátil: {inst_lu}")
                        shutil.rmtree(inst_lu, ignore_errors=True)
        except Exception as e:
            logger.debug(f"Limpeza preventiva de liveupdate ignorada: {e}")

    @staticmethod
    def _reclaim_memory_from_other_terminals(
        keep_path: Optional[str] = None,
        min_free_mb: float = 350.0,
        max_mem_pct: float = 82.0,
        force: bool = False,
    ) -> int:
        """
        Em VPS com pouca RAM (ex.: 2 GB) ou após timeout persistente de IPC (-10005 / porta 22346),
        encerra outras instâncias concorrentes de terminal64.exe antes de inicializar a conta alvo.
        """
        import os
        avail_mb = 0.0
        try:
            mem = psutil.virtual_memory()
            avail_mb = mem.available / (1024 * 1024)
            if not force and avail_mb >= min_free_mb and mem.percent < max_mem_pct:
                return 0
        except Exception:
            if not force:
                return 0

        norm_keep = os.path.normcase(os.path.abspath(keep_path)) if keep_path else None
        reclaimed = 0
        for proc in psutil.process_iter(['pid', 'name', 'exe']):
            try:
                name = (proc.info.get('name') or '').lower()
                if 'terminal64' not in name:
                    continue
                exe_path = proc.info.get('exe') or ''
                norm_exe = os.path.normcase(os.path.abspath(exe_path)) if exe_path else ''
                if norm_keep and norm_exe and norm_exe == norm_keep:
                    continue
                if 'instances' in norm_exe or norm_keep:
                    logger.warning(
                        f"[RAM-RECLAIM] Encerrando terminal MT5 concorrente (PID: {proc.info['pid']}, Path: {exe_path}) "
                        f"para liberar RAM antes de inicializar a conta alvo (RAM livre: {round(avail_mb, 1)} MB)..."
                    )
                    proc.kill()
                    reclaimed += 1
            except Exception:
                pass
        return reclaimed

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
        for proc in psutil.process_iter(['pid', 'name', 'exe', 'cwd', 'cmdline']):
            try:
                name = (proc.info.get('name') or '').lower()
                if 'terminal64' not in name:
                    continue
                exe_path = proc.info.get('exe') or ''
                cwd_path = proc.info.get('cwd') or ''
                cmdline_list = proc.info.get('cmdline') or []
                cmdline_str = " ".join(str(x) for x in cmdline_list).lower()
                norm_exe = os.path.normcase(os.path.abspath(exe_path)) if exe_path else ''
                norm_cwd = os.path.normcase(os.path.abspath(cwd_path)) if cwd_path else ''
                is_instance_proc = (
                    'instances' in norm_exe
                    or 'instances' in norm_cwd
                    or 'instances' in cmdline_str
                    or '/portable' in cmdline_str
                    or (norm_keep and norm_exe and norm_exe != norm_keep)
                )
                if is_instance_proc:
                    logger.warning(
                        f"Encerrando instância secundária/portable terminal64.exe (PID: {proc.info['pid']}, CWD: {cwd_path}) "
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
        """
        Encerra apenas o processo terminal64.exe da instância alvo (target_path) ou terminais não-isolados
        sem derrubar as janelas isoladas das demais contas!
        """
        import os
        norm_target = os.path.normcase(os.path.abspath(target_path)) if target_path else None
        for proc in psutil.process_iter(['pid', 'name', 'exe', 'cwd']):
            try:
                name = proc.info.get('name') or ''
                if 'terminal64' in name.lower():
                    exe_path = proc.info.get('exe') or ''
                    norm_exe = os.path.normcase(os.path.abspath(exe_path)) if exe_path else ''
                    if norm_target and norm_exe:
                        # Encerra estritamente o processo terminal64.exe da instância isolada alvo
                        if norm_exe != norm_target:
                            continue
                    logger.warning(f"Encerrando processo terminal64 (PID: {proc.info['pid']}, Path: {exe_path}) para reinicialização limpa...")
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
        """Corrige erros comuns de digitação e caixa de servidores MT5 (Exness, XM, HFM, IC Markets, Deriv, Prop Firms, etc.)."""
        import re

        s = (server or "").strip()
        if not s:
            return s
        lower = s.lower()

        m = re.match(r"^exness(ke|za|eu|uk)?[\s_-]*mt5[\s_-]*(real[a-z]?|trial[a-z]?|demo)[\s_-]*(\d*)$", lower)
        if m:
            region = (m.group(1) or "").upper()
            kind = "Real" if m.group(2).startswith("real") else "Trial"
            num = int(m.group(3)) if m.group(3) else 0
            return f"Exness{region}-MT5{kind}{num if num > 1 else ''}"

        m = re.match(r"^xmglobal[\s_-]*mt5(?:[\s_-]*(\d+))?$", lower)
        if m:
            num = int(m.group(1)) if m.group(1) else 0
            return f"XMGlobal-MT5 {num}" if num > 1 else "XMGlobal-MT5"

        m = re.match(r"^hfmarketsglobal[\s_-]*live[\s_-]*(\d+)$", lower)
        if m:
            return f"HFMarketsGlobal-Live{int(m.group(1))}"
        if re.match(r"^hfmarketsglobal[\s_-]*demo$", lower):
            return "HFMarketsGlobal-Demo"

        m = re.match(r"^hfmarkets(sv|sa|ke)[\s_-]*(live|demo)[\s_-]*(\d*)$", lower)
        if m:
            reg = m.group(1).upper()
            kind = "Live" if m.group(2) == "live" else "Demo"
            num = int(m.group(3)) if m.group(3) else 0
            return f"HFMarkets{reg}-{kind}{num if num > 1 else ''}"

        m = re.match(r"^icmarkets(sc|eu|au)[\s_-]*(mt5|demo)(?:[\s_-]*(\d+))?$", lower)
        if m:
            reg = m.group(1).upper()
            if m.group(2) == "demo":
                return f"ICMarkets{reg}-Demo"
            num = int(m.group(3)) if m.group(3) else 0
            return f"ICMarkets{reg}-MT5-{num}" if num > 1 else f"ICMarkets{reg}-MT5"

        m = re.match(r"^pepperstone[\s_-]*mt5[\s_-]*live[\s_-]*(\d+)$", lower)
        if m:
            return f"Pepperstone-MT5-Live{int(m.group(1)):02d}"

        m = re.match(r"^vantageinternational[\s_-]*(live|demo)(?:[\s_-]*(\d+))?$", lower)
        if m:
            if m.group(1) == "demo":
                return "VantageInternational-Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"VantageInternational-Live {num}" if num > 1 else "VantageInternational-Live"

        m = re.match(r"^justmarkets[\s_-]*(live|demo)[\s_-]*(\d*)$", lower)
        if m:
            kind = "Live" if m.group(1) == "live" else "Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"JustMarkets-{kind}{num if num > 1 else ''}"

        m = re.match(r"^fxgt[\s_-]*(live|demo)[\s_-]*(\d*)$", lower)
        if m:
            kind = "Live" if m.group(1) == "live" else "Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"FXGT-{kind}{num if num > 1 else ''}"

        m = re.match(r"^puprime[\s_-]*(live|demo)[\s_-]*(\d*)$", lower)
        if m:
            kind = "Live" if m.group(1) == "live" else "Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"PUPrime-{kind}{num if num > 1 else ''}"

        m = re.match(r"^dooprime[\s_-]*(live|demo)(?:[\s_-]*(\d+))?$", lower)
        if m:
            if m.group(1) == "demo":
                return "DooPrime-Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"DooPrime-Live {num}" if num > 1 else "DooPrime-Live"

        m = re.match(r"^swissquote[\s_-]*live[\s_-]*(\d+)$", lower)
        if m:
            return f"Swissquote-Live{int(m.group(1))}"

        m = re.match(r"^cptmarkets[\s_-]*live[\s_-]*(\d+)$", lower)
        if m:
            return f"CPTMarkets-Live{int(m.group(1)):02d}"

        m = re.match(r"^valetaxintl[\s_-]*(live|demo)[\s_-]*(\d*)$", lower)
        if m:
            kind = "Live" if m.group(1) == "live" else "Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"ValetaxIntl-{kind}{num if num > 1 else ''}"

        m = re.match(r"^ftmo[\s_-]*(server|demo)[\s_-]*(\d*)$", lower)
        if m:
            kind = "Server" if m.group(1) == "server" else "Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"FTMO-{kind}{num if num > 1 else ''}"

        m = re.match(r"^fundednext[\s_-]*(server|trial)[\s_-]*(\d*)$", lower)
        if m:
            num = int(m.group(2)) if m.group(2) else 0
            if m.group(1) == "trial":
                return f"FundedNext-Trial{num if num > 1 else ''}"
            return f"FundedNext-Server {num}" if num > 1 else "FundedNext-Server"

        m = re.match(r"^fundingpips[\s_-]*(server|demo)[\s_-]*(\d*)$", lower)
        if m:
            kind = "Server" if m.group(1) == "server" else "Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"FundingPips-{kind}{num if num > 1 else ''}"

        m = re.match(r"^goatfunded[\s_-]*(server|demo)[\s_-]*(\d*)$", lower)
        if m:
            kind = "Server" if m.group(1) == "server" else "Demo"
            num = int(m.group(2)) if m.group(2) else 0
            return f"GoatFunded-{kind}{num if num > 1 else ''}"

        typo_map = {
            "deric-demo": "Deriv-Demo",
            "deriv-demo": "Deriv-Demo",
            "deric-server": "Deriv-Server",
            "deriv-server": "Deriv-Server",
            "deric-server-02": "Deriv-Server-02",
            "deriv-server-02": "Deriv-Server-02",
            "deriv-server-03": "Deriv-Server-03",
            "goatfundedtrader-server": "GoatFundedTrader-Server",
            "goatfundedtrader-server2": "GoatFundedTrader-Server2",
            "fivepercentonline-real": "FivePercentOnline-Real",
            "fivepercentonline-demo": "FivePercentOnline-Demo",
            "fivepercentonline-server": "FivePercentOnline-Server",
            "alphacapitalgroup-server": "AlphaCapitalGroup-Server",
            "alphacapitalgroup-server2": "AlphaCapitalGroup-Server2",
            "alphacapitalgroup-demo": "AlphaCapitalGroup-Demo",
            "acgmarkets-live": "ACGMarkets-Live",
            "acgmarkets-demo": "ACGMarkets-Demo",
            "maven-server": "Maven-Server",
            "maven-server2": "Maven-Server2",
            "maven-demo": "Maven-Demo",
            "maventrade-server": "MavenTrade-Server",
            "e8markets-server": "E8Markets-Server",
            "e8markets-demo": "E8Markets-Demo",
            "e8funding-server": "E8Funding-Server",
            "blueguardian-server": "BlueGuardian-Server",
            "blueguardian-server2": "BlueGuardian-Server2",
            "blueguardian-demo": "BlueGuardian-Demo",
            "fxify-server": "FXIFY-Server",
            "fxify-demo": "FXIFY-Demo",
            "fundedtradingplus-live": "FundedTradingPlus-Live",
            "fundedtradingplus-demo": "FundedTradingPlus-Demo",
            "fttrading-server": "fttrading-server",
            "fortraders-demo": "ForTraders-Demo",
            "fundingtradersgroup-server": "FundingTradersGroup-Server",
            "fundingtraders-demo": "FundingTraders-Demo",
            "thefundedtrader-server": "TheFundedTrader-Server",
            "thefundedtrader-demo": "TheFundedTrader-Demo",
            "dnafunded-live": "DNAFunded-Live",
            "dnafunded-demo": "DNAFunded-Demo",
            "oandaproptrader-live": "OANDAPropTrader-Live",
            "oandaproptrader-demo": "OANDAPropTrader-Demo",
            "xm.com-mt5": "XM.COM-MT5",
            "xmmena-mt5": "XMMena-MT5",
            "fbs-demo": "FBS-Demo",
            "fbs-real": "FBS-Real",
            "octafx-demo": "OctaFX-Demo",
            "octafx-real": "OctaFX-Real",
            "octafx-real2": "OctaFX-Real2",
            "octafx-real3": "OctaFX-Real3",
            "octamarkets-demo": "OctaMarkets-Demo",
            "octamarkets-real": "OctaMarkets-Real",
            "tickmill-demo": "Tickmill-Demo",
            "tickmill-live": "Tickmill-Live",
            "tickmill-live02": "Tickmill-Live02",
            "tickmilluk-demo": "TickmillUK-Demo",
            "tickmilluk-live": "TickmillUK-Live",
            "fusionmarkets-demo": "FusionMarkets-Demo",
            "fusionmarkets-demo 2": "FusionMarkets-Demo 2",
            "fusionmarkets-live": "FusionMarkets-Live",
            "fusionmarkets-live 2": "FusionMarkets-Live 2",
            "fusionmarkets-live 3": "FusionMarkets-Live 3",
            "forextimefxtm-demo01": "ForexTimeFXTM-Demo01",
            "forextimefxtm-demo02": "ForexTimeFXTM-Demo02",
            "forextimefxtm-live01": "ForexTimeFXTM-Live01",
            "forextimefxtm-live02": "ForexTimeFXTM-Live02",
            "startrader-demo": "STARTRADER-Demo",
            "startrader-live": "STARTRADER-Live",
            "startrader-live2": "STARTRADER-Live2",
            "startrader-live3": "STARTRADER-Live3",
            "startrader-live4": "STARTRADER-Live4",
            "startraderfinancial-demo": "STARTRADERFinancial-Demo",
            "startraderfinancial-live": "STARTRADERFinancial-Live",
            "dprimevu-demo": "DPrimeVU-Demo",
            "monetamarkets-demo": "MonetaMarkets-Demo",
            "monetamarkets-live": "MonetaMarkets-Live",
            "monetamarkets-live 2": "MonetaMarkets-Live 2",
            "activtrades-demo": "ActivTrades-Demo",
            "activtrades-live": "ActivTrades-Live",
            "activtradescorp-demo": "ActivTradesCorp-Demo",
            "activtradescorp-live": "ActivTradesCorp-Live",
            "equitibrokeragesc-demo": "EquitiBrokerageSC-Demo",
            "equitibrokeragesc-live": "EquitiBrokerageSC-Live",
            "equitigroupltd-live": "EquitiGroupLtd-Live",
            "mexatlantic-demo": "MEXAtlantic-Demo",
            "mexatlantic-real": "MEXAtlantic-Real",
            "mexatlantic-real-2": "MEXAtlantic-Real-2",
            "mexgroup-demo": "MEXGroup-Demo",
            "mexgroup-live": "MEXGroup-Live",
            "atfx-demo": "ATFX-Demo",
            "atfx-live": "ATFX-Live",
            "atfxgm-demo": "ATFXGM-Demo",
            "atfxgm-live": "ATFXGM-Live",
            "alpari-mt5-demo": "Alpari-MT5-Demo",
            "alpari-mt5": "Alpari-MT5",
            "amarkets-demo": "AMarkets-Demo",
            "amarkets-real": "AMarkets-Real",
            "infinoxlimited-mt5demo": "InfinoxLimited-MT5Demo",
            "infinoxlimited-mt5live": "InfinoxLimited-MT5Live",
            "swissquote-demo": "Swissquote-Demo",
            "swissquote-server": "Swissquote-Server",
            "swissquote-real": "Swissquote-Real",
            "swissquotebankeu-server": "SwissquoteBankEU-Server",
            "darwinex-demo": "Darwinex-Demo",
            "darwinex-live": "Darwinex-Live",
            "globalprime-demo": "GlobalPrime-Demo",
            "globalprime-trade": "GlobalPrime-Trade",
            "gomarkets-demo": "GOMarkets-Demo",
            "gomarkets-live": "GOMarkets-Live",
            "cptmarkets-demo": "CPTMarkets-Demo",
            "cptmarketsuklimited-trading-live": "CPTMarketsUKLimited-Trading-Live",
            "scopemarkets-demo": "ScopeMarkets-Demo",
            "scopemarkets-live": "ScopeMarkets-Live",
            "capitalpointtrading-demo": "CapitalPointTrading-Demo",
            "capitalpointtrading-mt5": "CapitalPointTrading-MT5",
            "capitalpointtrading-mt5-6": "CapitalPointTrading-MT5-6",
            "libertex-demo": "Libertex-Demo",
            "libertex-real": "Libertex-Real",
            "instaforex-demo": "InstaForex-Demo",
            "instaforex-server": "InstaForex-Server",
            "instaforex-europe": "InstaForex-Europe",
            "instaforex-asia": "InstaForex-Asia",
            "freshforex-mt5-demo": "FreshForex-MT5-Demo",
            "freshforex-mt5": "FreshForex-MT5",
            "nordfx-demo": "NordFX-Demo",
            "nordfx-real": "NordFX-Real",
            "cmtrading-demo": "CMTrading-Demo",
            "cmtrading-live": "CMTrading-Live",
            "bdswissglobal-demo": "BDSwissGlobal-Demo",
            "bdswissglobal-live": "BDSwissGlobal-Live",
            "cfifinancial-demo": "CFIFinancial-Demo",
            "cfifinancial-live": "CFIFinancial-Live",
            "btgpactual-demo": "BTGPactual-Demo",
            "btgpactual-prd": "BTGPactual-PRD",
            "xpinvestimentos-demo": "XPInvestimentos-Demo",
            "xpinvestimentos-prd": "XPInvestimentos-PRD",
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

    def _run_with_dialog_watchdog(self, fn, initial_delay: float = 0.5):
        """
        Executa uma chamada IPC bloqueante (mt5.initialize / mt5.login) monitorando e fechando
        qualquer popup modal Win32 ('#32770', ex: 'Login') que trave a thread UI do MT5.
        IMPORTANTE: Como a extensão C++ MetaTrader5 (_core.pyd) retém o GIL do Python durante todo
        o mt5.initialize(), uma threading.Thread ficaria congelada até o timeout de 60s (-10005).
        Por isso lançamos um subprocesso OS independente (sem compartilhar o GIL) que fecha o modal '#32770'
        em tempo real (< 0.4s) enquanto o mt5.initialize() aguarda a resposta do pipe IPC!
        """
        import sys
        import subprocess

        watchdog_proc = None
        if sys.platform == "win32":
            killer_code = (
                "import time, ctypes\n"
                "from ctypes import wintypes\n"
                "user32 = ctypes.windll.user32\n"
                "WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)\n"
                "def cb(hwnd, _):\n"
                "    if user32.IsWindowVisible(hwnd):\n"
                "        cbuf = ctypes.create_unicode_buffer(64)\n"
                "        user32.GetClassNameW(hwnd, cbuf, 64)\n"
                "        if cbuf.value == '#32770':\n"
                "            tbuf = ctypes.create_unicode_buffer(256)\n"
                "            user32.GetWindowTextW(hwnd, tbuf, 256)\n"
                "            title = (tbuf.value or '').lower()\n"
                "            if title in ('login', 'metatrader 5', '') or any(k in title for k in ('account', 'demo', 'password', 'autoriza', 'conta', 'senha', 'conectar', 'servidor', 'abrir', 'update', 'atualiza', 'aviso', 'disclaimer', 'certificate', 'proxy')):\n"
                "                user32.PostMessageW(hwnd, 0x0010, 0, 0)\n"
                "                user32.PostMessageW(hwnd, 0x0111, 2, 0)\n"
                "    return True\n"
                "c_cb = WNDENUMPROC(cb)\n"
                f"time.sleep({max(0.1, float(initial_delay))})\n"
                "for _ in range(180):\n"
                "    user32.EnumWindows(c_cb, 0)\n"
                "    time.sleep(0.4)\n"
            )
            try:
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
                watchdog_proc = subprocess.Popen(
                    [sys.executable, "-c", killer_code],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=creationflags,
                )
            except Exception as e:
                logger.debug(f"Não foi possível iniciar subprocesso watchdog Win32: {e}")

        try:
            return fn()
        finally:
            if watchdog_proc is not None:
                try:
                    watchdog_proc.terminate()
                    watchdog_proc.wait(timeout=1.0)
                except Exception:
                    try:
                        watchdog_proc.kill()
                    except Exception:
                        pass

    def ensure_connected(
        self,
        account_id: int,
        login: str,
        server: str,
        password: Optional[str] = None,
        path: Optional[str] = None,
        progress_callback: Optional[Any] = None,
    ) -> bool:
        """Garante que a sessão IPC com o terminal MT5 isolado da conta está ativa sem deslogar outras contas."""
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                self.connected_account = account_id
                return True

            import os
            self._dismiss_mt5_dialogs()
            login_clean = int(str(login).strip()) if str(login).strip().isdigit() else 0
            server_clean = self._normalize_broker_server(server)
            pass_clean = str(password).strip() if password else ""

            same_terminal = True
            if path and self.active_terminal_path:
                same_terminal = os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(self.active_terminal_path))

            if same_terminal and not pass_clean:
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
        """
        Conecta ao terminal MT5 isolado da conta (instances/acc_<id>/terminal64.exe).
        CRÍTICO: Quando alternamos o cliente Python entre duas janelas terminal64.exe abertas,
        PRECISAMOS chamar mt5.shutdown() antes de mt5.initialize(path=term_path, ...).
        mt5.shutdown() fecha APENAS o pipe cliente do Python (NÃO fecha a janela do MT5!)
        e permite que mt5.initialize(path=term_path) anexe à janela isolada da próxima conta!
        """
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
            term_path = path or settings.mt5_default_path

            # Se o executável estiver em instances/acc_<id>, usa portable=True para isolar dados e sessão
            use_portable = "program files" not in (term_path or "").lower()

            # Remove qualquer atualização automática pendente que trave o Pipe Server (-10003 / -10005) e fecha popups
            self._clean_pending_liveupdate(target_path=term_path)
            self._dismiss_mt5_dialogs()

            switching_terminal = bool(
                term_path
                and (
                    not self.active_terminal_path
                    or os.path.normcase(os.path.abspath(term_path)) != os.path.normcase(os.path.abspath(self.active_terminal_path))
                )
            )

            def _init_with_or_without_creds(timeout_ms: int = 25000) -> bool:
                if login_clean and pass_clean and server_clean and term_path:
                    return bool(
                        mt5.initialize(
                            path=term_path,
                            login=login_clean,
                            password=pass_clean,
                            server=server_clean,
                            portable=use_portable,
                            timeout=timeout_ms,
                        )
                    )
                if login_clean and not pass_clean:
                    self.last_connect_error = "Senha MT5 obrigatória para autenticar a conta com segurança."
                    return False
                if term_path:
                    return bool(mt5.initialize(path=term_path, portable=use_portable, timeout=timeout_ms))
                return bool(mt5.initialize(timeout=timeout_ms))

            # Passo 1: Se estamos trocando de instância de terminal (ex: acc_408953138 -> acc_6371945),
            # desconecta o handle IPC do Python da janela anterior (sem fechar a janela!) e anexa à janela de term_path!
            init_ok = False
            try:
                if switching_terminal:
                    try:
                        mt5.shutdown()
                    except Exception:
                        pass
                    self._reclaim_memory_from_other_terminals(keep_path=term_path)
                    init_ok = self._run_with_dialog_watchdog(
                        lambda: _init_with_or_without_creds(35000),
                        initial_delay=0.3,
                    )
                else:
                    term_info = mt5.terminal_info()
                    if term_info is not None and isinstance(getattr(term_info, "name", None), str):
                        init_ok = True
                    else:
                        if progress_callback:
                            progress_callback(f"Conectando ao canal IPC do terminal MT5 para conta {login_clean}...")
                        init_ok = self._run_with_dialog_watchdog(
                            lambda: _init_with_or_without_creds(30000),
                            initial_delay=0.3,
                        )
            except Exception as e:
                logger.debug(f"Terminal ativo não respondeu na tentativa rápida: {e}")

            # Passo 2: Se a instância isolada da conta não respondeu, libera RAM se necessário, reinicia apenas o processo dela
            # e tenta novamente com timeout ampliado (60s).
            if not init_ok:
                logger.info(f"Reiniciando processo MT5 isolado da conta {login_clean} via: {term_path}")
                if progress_callback:
                    progress_callback(f"Inicializando processo MetaTrader 5 na VPS para {login_clean}@{server_clean}...")
                try:
                    mt5.shutdown()
                except Exception:
                    pass
                self._kill_stuck_terminals(target_path=term_path)
                reclaimed = self._reclaim_memory_from_other_terminals(keep_path=term_path)
                self._clean_pending_liveupdate(target_path=term_path)
                time.sleep(3.0 if reclaimed > 0 else 2.0)
                try:
                    init_ok = self._run_with_dialog_watchdog(
                        lambda: _init_with_or_without_creds(60000),
                        initial_delay=0.5,
                    )
                except Exception as e:
                    logger.error(f"Erro ao inicializar terminal MT5 via path: {e}")

            # Passo 2b: Se ainda deu IPC timeout (-10005) ao autenticar inline no initialize(),
            # separa abertura do pipe IPC (initialize sem credenciais) do login explícito no Passo 3.
            if not init_ok and term_path and login_clean and pass_clean:
                last_err = mt5.last_error()
                last_code = last_err[0] if isinstance(last_err, (tuple, list)) and len(last_err) > 0 else None
                if last_code == -10005:
                    logger.warning(
                        f"[IPC-RECOVERY] Timeout (-10005) no initialize com credenciais para {login_clean}@{server_clean}. "
                        f"Tentando abrir o canal IPC do terminal primeiro e autenticar via mt5.login() em seguida..."
                    )
                    try:
                        mt5.shutdown()
                    except Exception:
                        pass
                    self._reclaim_memory_from_other_terminals(keep_path=term_path, force=True)
                    self._dismiss_mt5_dialogs()
                    time.sleep(2.0)
                    try:
                        init_ok = self._run_with_dialog_watchdog(
                            lambda: bool(mt5.initialize(path=term_path, portable=use_portable, timeout=60000)),
                            initial_delay=0.5,
                        )
                    except Exception as e:
                        logger.error(f"Erro na recuperação de pipe IPC para {login_clean}: {e}")

            self._dismiss_mt5_dialogs()

            if not init_ok:
                err = mt5.last_error()
                snap = self.get_resource_snapshot()
                ui_diag = self.inspect_mt5_ui_state(close_modals=False)
                self.last_connect_error = (
                    f"Não foi possível inicializar o processo MT5 na VPS: {err} "
                    f"(RAM livre: {snap['memory_available_mb']} MB / {snap['memory_total_mb']} MB | "
                    f"Terminais MT5 abertos: {len(ui_diag.get('pids', []))} | "
                    f"Modais: {len(ui_diag.get('modals', []))})"
                )
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

                if pass_clean and self._is_account_authenticated(info, login_clean, server_clean):
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
                        if pass_clean and self._is_account_authenticated(info, login_clean, server_clean):
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
                            self.last_error_code = -6
                            self.last_connect_error = f"Senha MT5 ausente ao tentar autenticar conta {login_clean}@{server_clean}."
                            logger.error(self.last_connect_error)
                            return False

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

                        # Se o erro for -6 (Terminal: Authorization failed) e senha foi informada, falha imediatamente sem fallback sem senha
                        if err_code == -6:
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
        """Coleta snapshot imediato de memória e CPU suavizada para diagnóstico técnico de extração."""
        from .health_monitor import sample_smoothed_cpu_percent
        cpu_usage, _ = sample_smoothed_cpu_percent()
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
                info_srv = mt5.account_info()
                active_srv = str(getattr(info_srv, "server", "") or "") if info_srv else ""
                tz_prof = self._detect_broker_tz_profile(active_srv)
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
                        time=self._mt5_ts_to_utc(int(pos.time), active_srv, tz_prof),
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
                    info_srv = mt5.account_info()
                    active_srv = str(getattr(info_srv, "server", "") or "") if info_srv else ""
                    tz_prof = self._detect_broker_tz_profile(active_srv)
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
                            timeSetup=self._mt5_ts_to_utc(int(ord_item.time_setup), active_srv, tz_prof),
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

    @staticmethod
    def _is_24_7_symbol(sym_name: str) -> bool:
        s = (sym_name or "").lower()
        return any(
            k in s
            for k in (
                "btc",
                "eth",
                "sol",
                "xrp",
                "crypto",
                "volatility",
                "crash",
                "boom",
                "step index",
                "jump",
                "range break",
                "dex ",
            )
        )

    def _detect_broker_tz_profile(self, server: Optional[str] = None) -> Dict[str, Any]:
        """
        Detecta com precisão o fuso horário do servidor MT5 conectado (ex: GMT+0 na Deriv/Exness,
        GMT+2 inverno / GMT+3 verão US-DST em prop firms e corretoras Forex como FTMO, GoatFunded, ICMarkets)
        e persiste o perfil por servidor para manter exatidão mesmo durante o fim de semana.
        """
        srv_clean = (server or "").strip()
        if not srv_clean and MT5_AVAILABLE:
            try:
                info = mt5.account_info()
                if info:
                    srv_clean = str(getattr(info, "server", "") or "").strip()
            except Exception:
                pass
        srv_key = srv_clean.lower() or "default"

        now_utc_ts = time.time()
        utc_dt = datetime.datetime.fromtimestamp(now_utc_ts, tz=datetime.timezone.utc)
        is_forex_weekend = (
            (utc_dt.weekday() == 4 and utc_dt.hour >= 22)
            or (utc_dt.weekday() == 5)
            or (utc_dt.weekday() == 6 and utc_dt.hour < 22)
        )

        if MT5_AVAILABLE:
            try:
                probe_symbols: List[str] = [
                    "BTCUSD",
                    "ETHUSD",
                    "Volatility 75 Index",
                    "Volatility 100 Index",
                    "Step Index",
                    "EURUSD",
                    "XAUUSD",
                    "GBPUSD",
                    "USDJPY",
                    "US30",
                ]
                try:
                    mw_syms = mt5.symbols_get()
                    if mw_syms:
                        for s_obj in mw_syms[:60]:
                            if getattr(s_obj, "visible", False):
                                s_name = str(getattr(s_obj, "name", "") or "")
                                if s_name and s_name not in probe_symbols:
                                    probe_symbols.append(s_name)
                except Exception:
                    pass

                best_tick_ts = 0
                best_sym = ""
                for sym in probe_symbols:
                    if is_forex_weekend and not self._is_24_7_symbol(sym):
                        continue
                    tick = mt5.symbol_info_tick(sym)
                    t_val = int(getattr(tick, "time", 0) or 0) if tick else 0
                    if t_val > best_tick_ts:
                        best_tick_ts = t_val
                        best_sym = sym

                if best_tick_ts > 0:
                    diff = float(best_tick_ts) - now_utc_ts
                    rounded_15m = int(round(diff / 900.0) * 900)
                    # Aceita apenas se o tick for recente (dentro de 5 min do múltiplo de fuso horário e [-12h, +14h])
                    if -12 * 3600 <= rounded_15m <= 14 * 3600 and abs(diff - rounded_15m) <= 300:
                        if rounded_15m == 0:
                            mode = "UTC"
                        elif (
                            (rounded_15m == 10800 and self._is_us_dst_at_server_epoch(best_tick_ts))
                            or (rounded_15m == 7200 and not self._is_us_dst_at_server_epoch(best_tick_ts))
                        ):
                            mode = "NY_CLOSE_DST"
                        else:
                            mode = "FIXED"

                        prev = self._broker_tz_cache.get(srv_key)
                        profile = {
                            "server": srv_clean or srv_key,
                            "offsetSec": rounded_15m,
                            "mode": mode,
                            "referenceSymbol": best_sym,
                            "updatedAt": int(now_utc_ts),
                        }
                        self._broker_tz_cache[srv_key] = profile
                        if not prev or prev.get("offsetSec") != rounded_15m or prev.get("mode") != mode:
                            sign = "+" if rounded_15m >= 0 else "-"
                            hrs = abs(rounded_15m) / 3600.0
                            logger.info(
                                f"[MT5-TZ] Fuso horário do servidor '{srv_clean}' detectado ao vivo via {best_sym}: "
                                f"UTC{sign}{hrs:g} ({rounded_15m}s, modo={mode})"
                            )
                            self._save_broker_tz_cache()
                        return profile
            except Exception as e:
                logger.debug(f"Falha ao sondar fuso horário ao vivo para {srv_clean}: {e}")

        # Fallback 1: Cache persistido de sessões anteriores desse mesmo servidor
        cached = self._broker_tz_cache.get(srv_key)
        if isinstance(cached, dict) and "offsetSec" in cached:
            return cached

        # Fallback 2: Heurística por família de corretora (quando sincronizado no fim de semana sem símbolo 24/7)
        if any(k in srv_key for k in ("deriv", "exness", "binance", "bybit", "okx", "kraken")):
            return {"server": srv_clean, "offsetSec": 0, "mode": "UTC"}

        if srv_clean:
            approx_srv_ts = int(now_utc_ts) + 7200
            is_dst = self._is_us_dst_at_server_epoch(approx_srv_ts)
            return {
                "server": srv_clean,
                "offsetSec": 10800 if is_dst else 7200,
                "mode": "NY_CLOSE_DST",
            }

        return {"server": srv_clean, "offsetSec": 0, "mode": "UTC"}

    def _resolve_offset_for_mt5_ts(
        self,
        raw_ts: int,
        server: Optional[str] = None,
        tz_profile: Optional[Dict[str, Any]] = None,
    ) -> int:
        prof = tz_profile or self._detect_broker_tz_profile(server)
        mode = prof.get("mode", "UTC")
        if mode == "UTC":
            return 0
        if mode == "NY_CLOSE_DST":
            return 10800 if self._is_us_dst_at_server_epoch(int(raw_ts)) else 7200
        return int(prof.get("offsetSec", 0) or 0)

    def _mt5_ts_to_utc(
        self,
        raw_ts: int,
        server: Optional[str] = None,
        tz_profile: Optional[Dict[str, Any]] = None,
    ) -> datetime.datetime:
        """
        Converte o timestamp wall-clock retornado pelo MT5 (DEAL_TIME, POSITION_TIME, copy_rates)
        para UTC canônico real (ISO-8601 com timezone.utc), subtraindo o offset exato do servidor da corretora.
        """
        offset_sec = self._resolve_offset_for_mt5_ts(int(raw_ts), server=server, tz_profile=tz_profile)
        true_utc_ts = int(raw_ts) - offset_sec
        return datetime.datetime.fromtimestamp(true_utc_ts, tz=datetime.timezone.utc)

    def _get_broker_utc_offset_seconds(self, server: Optional[str] = None) -> int:
        prof = self._detect_broker_tz_profile(server)
        return int(prof.get("offsetSec", 0) or 0)

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
                entry_comm_by_position: Dict[int, float] = {}
                out_count_by_position: Dict[int, int] = {}
                for d in deals:
                    if d.ticket > max_ticket:
                        max_ticket = d.ticket
                    if d.entry == 0 and d.position_id:
                        if d.position_id not in entry_by_position:
                            entry_by_position[d.position_id] = d
                        entry_comm_by_position[d.position_id] = (
                            entry_comm_by_position.get(d.position_id, 0.0)
                            + float(d.commission or 0.0)
                            + float(getattr(d, "fee", 0.0) or 0.0)
                        )
                    elif d.entry in (1, 2, 3) and d.position_id:
                        out_count_by_position[d.position_id] = out_count_by_position.get(d.position_id, 0) + 1

                info_srv = mt5.account_info()
                effective_server = str(getattr(info_srv, "server", "") or server or "").strip() if info_srv else (server or "")
                tz_profile = self._detect_broker_tz_profile(effective_server)
                current_tz_offset_sec = int(tz_profile.get("offsetSec", 0) or 0)

                for d in deals:
                    if d.ticket <= last_deal_ticket:
                        continue

                    # Ignora deals de depósito/saque/crédito e entradas em aberto (DEAL_ENTRY_IN=0)
                    if d.type not in (0, 1) or d.entry == 0:
                        continue

                    entry_type = DEAL_ENTRY_MAP.get(d.entry, "DEAL_ENTRY_OUT")
                    raw_deal_type = DEAL_TYPE_MAP.get(d.type, "DEAL_TYPE_BALANCE")

                    # Converte o horário wall-clock do servidor MT5 (ex: GMT+0, GMT+2, GMT+3) para UTC canônico real
                    close_time = self._mt5_ts_to_utc(int(d.time), effective_server, tz_profile)
                    open_price = float(d.price)
                    open_time = None
                    total_commission = float(d.commission or 0.0) + float(getattr(d, "fee", 0.0) or 0.0)
                    trade_direction = raw_deal_type

                    if d.type in (0, 1):
                        entry_deal = self._find_entry_deal(d.position_id, entry_by_position)
                        if entry_deal is not None:
                            open_price = float(entry_deal.price)
                            open_time = self._mt5_ts_to_utc(int(entry_deal.time), effective_server, tz_profile)
                            # Soma a comissão cobrada na abertura quando não houver múltiplas saídas parciais
                            if out_count_by_position.get(d.position_id, 1) <= 1:
                                entry_c = entry_comm_by_position.get(
                                    d.position_id,
                                    float(entry_deal.commission or 0.0) + float(getattr(entry_deal, "fee", 0.0) or 0.0)
                                )
                                total_commission += entry_c
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
                    server=effective_server or server,
                    serverTzOffsetSec=current_tz_offset_sec,
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

    def fetch_candle_batches(
        self,
        symbols: List[str],
        timeframes: List[str],
        from_ts_ms: Optional[int] = None,
        to_ts_ms: Optional[int] = None,
        chunk_size: int = 500,
    ) -> List[Dict[str, Any]]:
        """
        Extrai lotes históricos de 500 velas (OHLCV) diretamente do terminal MetaTrader 5 conectado
        usando mt5.copy_rates_range / mt5.copy_rates_from para alimentar Backtesting e Replay.
        """
        with self._ipc_lock:
            if not MT5_AVAILABLE:
                return []

            tf_map = {
                "1m": getattr(mt5, "TIMEFRAME_M1", 1),
                "5m": getattr(mt5, "TIMEFRAME_M5", 5),
                "15m": getattr(mt5, "TIMEFRAME_M15", 15),
                "30m": getattr(mt5, "TIMEFRAME_M30", 30),
                "1h": getattr(mt5, "TIMEFRAME_H1", 16385),
                "1H": getattr(mt5, "TIMEFRAME_H1", 16385),
                "4h": getattr(mt5, "TIMEFRAME_H4", 16388),
                "4H": getattr(mt5, "TIMEFRAME_H4", 16388),
                "1d": getattr(mt5, "TIMEFRAME_D1", 16408),
                "D": getattr(mt5, "TIMEFRAME_D1", 16408),
            }

            info_srv = mt5.account_info()
            active_srv = str(getattr(info_srv, "server", "") or "") if info_srv else ""
            tz_prof = self._detect_broker_tz_profile(active_srv)
            curr_offset_sec = int(tz_prof.get("offsetSec", 0) or 0)

            now_srv_ts = time.time() + curr_offset_sec
            to_srv_ts = (to_ts_ms / 1000.0 + curr_offset_sec) if (to_ts_ms and to_ts_ms > 0) else now_srv_ts
            to_dt = datetime.datetime.fromtimestamp(to_srv_ts, tz=datetime.timezone.utc)

            batches: List[Dict[str, Any]] = []
            for raw_sym in (symbols or [])[:8]:
                clean_sym = (raw_sym or "").strip()
                if not clean_sym:
                    continue
                try:
                    mt5.symbol_select(clean_sym, True)
                except Exception:
                    pass

                for tf_str in (timeframes or ["15m"]):
                    mt5_tf = tf_map.get(tf_str, getattr(mt5, "TIMEFRAME_M15", 15))
                    try:
                        rates = None
                        if from_ts_ms and from_ts_ms > 0:
                            from_srv_ts = from_ts_ms / 1000.0 + curr_offset_sec
                            from_dt = datetime.datetime.fromtimestamp(from_srv_ts, tz=datetime.timezone.utc)
                            rates = mt5.copy_rates_range(clean_sym, mt5_tf, from_dt, to_dt)
                        if rates is None or len(rates) == 0:
                            rates = mt5.copy_rates_from(clean_sym, mt5_tf, to_dt, int(chunk_size or 500))
                        if rates is None or len(rates) == 0:
                            rates = mt5.copy_rates_from_pos(clean_sym, mt5_tf, 0, int(chunk_size or 500))

                        if rates is not None and len(rates) > 0:
                            candles = []
                            is_intraday = tf_str not in ("1d", "D", "1W", "W")
                            for r in rates[-int(chunk_size or 500):]:
                                raw_bar_ts = int(r["time"])
                                bar_offset = (
                                    self._resolve_offset_for_mt5_ts(raw_bar_ts, active_srv, tz_prof)
                                    if is_intraday
                                    else 0
                                )
                                candles.append({
                                    "timestamp": (raw_bar_ts - bar_offset) * 1000,
                                    "open": float(r["open"]),
                                    "high": float(r["high"]),
                                    "low": float(r["low"]),
                                    "close": float(r["close"]),
                                    "volume": float(r["tick_volume"]),
                                })
                            batches.append({
                                "symbol": clean_sym,
                                "timeframe": tf_str,
                                "candles": candles,
                            })
                            logger.info(
                                f"[OHLCV-BATCH] Lote extraído do MT5: {clean_sym} ({tf_str}) -> {len(candles)} velas."
                            )
                    except Exception as e:
                        logger.warning(f"[OHLCV-BATCH] Falha ao extrair lote OHLCV ({clean_sym} {tf_str}): {e}")
            return batches

    def fetch_economic_calendar_events(self) -> List[Dict[str, Any]]:
        """
        Lê eventos do Calendário Econômico exportados pelos EAs MQL5 (TorexCalendarSync / Torex_journal)
        procurando o arquivo mais recente entre MQL5/Files, FILE_COMMON e instâncias isoladas.
        """
        import os
        import json

        candidate_paths: List[Path] = []

        if MT5_AVAILABLE:
            with self._ipc_lock:
                try:
                    term_info = mt5.terminal_info()
                    data_path = getattr(term_info, "data_path", None) if term_info else None
                    common_path = getattr(term_info, "commondata_path", None) if term_info else None
                    if data_path:
                        candidate_paths.append(Path(data_path) / "MQL5" / "Files" / "torex_economic_calendar.json")
                    if common_path:
                        candidate_paths.append(Path(common_path) / "Files" / "torex_economic_calendar.json")
                except Exception as e:
                    logger.debug(f"[CALENDAR-FILE] terminal_info indisponível: {e}")

        appdata = os.environ.get("APPDATA")
        if appdata:
            mq_root = Path(appdata) / "MetaQuotes" / "Terminal"
            candidate_paths.append(mq_root / "Common" / "Files" / "torex_economic_calendar.json")
            if mq_root.exists():
                try:
                    for sub in mq_root.iterdir():
                        if sub.is_dir() and sub.name.lower() not in ("common", "community", "help"):
                            candidate_paths.append(sub / "MQL5" / "Files" / "torex_economic_calendar.json")
                except Exception:
                    pass

        try:
            from config.settings import settings
            inst_root = Path(settings.instances_dir).resolve()
            if inst_root.exists():
                for acc_dir in inst_root.glob("acc_*"):
                    candidate_paths.append(acc_dir / "MQL5" / "Files" / "torex_economic_calendar.json")
        except Exception:
            pass

        unique_existing: List[Path] = []
        seen = set()
        for p in candidate_paths:
            try:
                rp = str(p.resolve())
                if rp not in seen and p.exists() and p.is_file():
                    seen.add(rp)
                    unique_existing.append(p)
            except Exception:
                continue

        unique_existing.sort(key=lambda p: p.stat().st_mtime, reverse=True)

        for cal_file in unique_existing:
            try:
                content = cal_file.read_text(encoding="utf-8-sig", errors="ignore").strip()
                if not content:
                    continue
                raw = json.loads(content)
                if isinstance(raw, list) and len(raw) > 0:
                    logger.info(f"[CALENDAR-FILE] Lidas {len(raw)} notícias de {cal_file}")
                    return raw
            except Exception as e:
                logger.warning(f"[CALENDAR-FILE] Falha na leitura de {cal_file}: {e}")

        if not unique_existing:
            logger.debug("[CALENDAR-FILE] Nenhum arquivo torex_economic_calendar.json encontrado ainda.")
        return []

