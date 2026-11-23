@echo off
rem Starts the .NET API (http://localhost:5080) and the React site (http://localhost:5173).
rem Website: http://localhost:5173   Admin: http://localhost:5173/admin
cd /d "%~dp0"
if not exist frontend\node_modules ( pushd frontend & call npm install & popd )
start "SuperWater API" cmd /k "cd /d %~dp0backend\SuperWater.Api && dotnet run"
start "SuperWater Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 6 >nul
start http://localhost:5173
