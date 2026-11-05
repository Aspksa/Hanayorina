@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
title Hanayorina
pushd "%~dp0"
if errorlevel 1 goto folder_error
if not exist "scripts\launcher.ps1" goto missing
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "scripts\launcher.ps1"
if errorlevel 1 goto fail
popd
endlocal
exit /b 0
:folder_error
echo Не удалось открыть папку проекта. Скопируйте архив на доступный диск и распакуйте его.
goto finish
:missing
echo Файлы проекта не найдены. Распакуйте весь архив, включая папку scripts.
:fail
echo Запуск завершился с ошибкой. Прочитайте сообщения выше.
:finish
pause
endlocal
exit /b 1
