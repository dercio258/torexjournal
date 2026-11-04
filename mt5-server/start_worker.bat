@echo off
SETLOCAL EnableDelayedExpansion
cd /d "%~dp0"
title TorexJournal MT5 Worker Supervisor

echo ========================================================
echo   TorexJournal MT5 Worker - Supervisor de Producao
echo ========================================================

IF NOT EXIST ".env" (
    IF EXIST ".env.example" (
        echo [INFO] Arquivo .env nao encontrado. Copiando de .env.example...
        copy /Y ".env.example" ".env" >nul
    )
)

IF NOT EXIST "venv\Scripts\python.exe" (
    echo [SETUP] Ambiente venv nao encontrado. Criando e verificando dependencias...
    python -m venv --system-site-packages venv
    "venv\Scripts\python.exe" -c "import loguru, MetaTrader5, pydantic_settings, psutil, requests" 2>nul
    IF !ERRORLEVEL! NEQ 0 (
        "venv\Scripts\python.exe" -m pip install -r requirements.txt
    )
)

:SUPERVISOR_LOOP
echo [%DATE% %TIME%] Iniciando MT5 Worker (main.py)...
"venv\Scripts\python.exe" main.py
SET EXIT_CODE=%ERRORLEVEL%

IF %EXIT_CODE% EQU 0 (
    echo [%DATE% %TIME%] Worker encerrado normalmente (codigo 0).
    goto :END
)

echo [AVISO] Worker encerrou com codigo %EXIT_CODE%. Reiniciando automaticamente em 5 segundos...
echo Pressione Ctrl+C para cancelar o reinicio automatico.
timeout /t 5 /nobreak
goto :SUPERVISOR_LOOP

:END
pause
