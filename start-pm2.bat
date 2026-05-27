@echo off
:: 企业云盘 - PM2 启动脚本
:: 将此文件放入 启动文件夹 或 创建计划任务 实现开机自启
:: shell:startup  -> %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

cd /d "%~dp0"
pm2 resurrect
