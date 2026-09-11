@echo off
REM JavTube 一键启动（双击运行；需先 npm install 过依赖）
REM 开发模式等价于 npm run dev（Vite 5173 + Electron），窗口关闭即退出
cd /d "%~dp0"
set VITE=1
if not exist "node_modules\electron\dist\electron.exe" (
  echo [!] node_modules 不完整，请先执行: npm install
  pause
  exit /b 1
)
start "" /b "<工具目录>\binaries\node\versions\22.22.2-2\npm.cmd" run dev
echo JavTube dev 已启动（关闭本窗口不影响运行）
