@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
title Hanayorina
pushd "%~dp0"
if errorlevel 1 goto folder_error
set "PROJECT_DIR_ENTERED=1"
if not exist "package.json" goto files_missing
if not exist "package-lock.json" goto files_missing
if not exist "config\tsconfig.json" goto files_missing

rem Prefer a portable Node.js distribution placed inside the project.
set "NODE_EXE=node"
if exist ".runtime\node\node.exe" set "NODE_EXE=%CD%\.runtime\node\node.exe"
if exist ".runtime\node\node.exe" set "PATH=%CD%\.runtime\node;%PATH%"
"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 goto missing_node
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto old_node

if not exist "node_modules\typescript\bin\tsc" goto install
if not exist "node_modules\pg\package.json" goto install
if not exist "node_modules\dotenv\package.json" goto install
if not exist "node_modules\@types\node\package.json" goto install
if not exist "node_modules\@types\pg\package.json" goto install
goto build

:install
set "NPM_CLI="
if exist ".runtime\node\node_modules\npm\bin\npm-cli.js" set "NPM_CLI=%CD%\.runtime\node\node_modules\npm\bin\npm-cli.js"
if defined NPM_CLI goto npm_ready
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM_CLI set "NPM_CLI=%%~dpInode_modules\npm\bin\npm-cli.js"
:npm_ready
if not defined NPM_CLI goto missing_npm
if not exist "%NPM_CLI%" goto missing_npm
echo Установка зависимостей. Для первого запуска нужен интернет.
"%NODE_EXE%" "%NPM_CLI%" ci --no-audit --no-fund
if errorlevel 1 goto install_error

:build
echo Сборка Hanayorina...
"%NODE_EXE%" "node_modules\typescript\bin\tsc" -p "config\tsconfig.json"
if errorlevel 1 goto build_error
echo Откройте в браузере: http://127.0.0.1:4173
echo Оставьте это окно открытым. Для остановки нажмите Ctrl+C.
"%NODE_EXE%" "dist\server\index.js"
if errorlevel 1 goto run_error
popd
endlocal
exit /b 0

:folder_error
echo Не удалось открыть папку проекта. Распакуйте архив полностью и повторите запуск.
goto fail
:files_missing
echo Не найдены файлы проекта. Распакуйте весь архив, а не только BAT-файл.
goto fail
:missing_node
echo Не найден Node.js. Установите Node.js 22 или новее либо положите переносную версию в .runtime\node.
goto fail
:missing_npm
echo Не найден npm. Установите Node.js вместе с npm или используйте полный переносной архив Node.js.
goto fail
:old_node
echo Требуется Node.js версии 22 или новее. Обновите Node.js и повторите запуск.
goto fail
:install_error
echo Не удалось установить зависимости. Проверьте сообщения выше и подключение к интернету.
goto fail
:build_error
echo Ошибка сборки. Проверьте сообщения выше.
goto fail
:run_error
echo Сервер завершился с ошибкой. Проверьте сообщения выше.
:fail
echo.
echo Окно останется открытым, чтобы можно было прочитать ошибку.
pause
if defined PROJECT_DIR_ENTERED popd
endlocal
exit /b 1
