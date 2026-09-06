@echo off
cd /d "c:\Users\<用户名>\Documents\<旧目录>\<旧项目名>\app"
echo Starting Javlibrary...
"node_modules\electron\dist\electron.exe" "electron\main\index.js"
pause
