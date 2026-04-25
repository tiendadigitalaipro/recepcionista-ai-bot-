@echo off
chcp 65001 >nul
color 0A
echo.
echo  ╔════════════════════════════════════════╗
echo  ║   🤖 RECEPCIONISTA AI — WhatsApp Bot   ║
echo  ║      A2K Digital Studio                ║
echo  ╚════════════════════════════════════════╝
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo  📦 Instalando dependencias por primera vez...
    echo     (esto tarda 1-2 minutos, solo la primera vez)
    echo.
    npm install
    echo.
)

echo  🚀 Iniciando bot...
echo  📱 Escanea el QR con WhatsApp del negocio cliente
echo  ✅ Cuando veas "WhatsApp conectado" ya esta activo
echo.
node bot.js

pause
