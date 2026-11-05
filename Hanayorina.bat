@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto folder_error
if not exist "package.json" goto files_missing
if not exist "package-lock.json" goto files_missing
if not exist "config\tsconfig.json" goto files_missing
title Hanayorina
where node >nul 2>&1
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto old_node
if not exist "node_modules\typescript\bin\tsc" goto install
if not exist "node_modules\pg\package.json" goto install
if not exist "node_modules\dotenv\package.json" goto install
if not exist "node_modules\@types\node\package.json" goto install
if not exist "node_modules\@types\pg\package.json" goto install
goto build
:install
  echo Installing dependencies. Internet connection is required...
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 goto install_error
:build
echo Building Hanayorina...
call npm.cmd run build
if errorlevel 1 goto build_error
echo Open http://127.0.0.1:4173 in your browser.
echo Keep this window open. Press Ctrl+C to stop.
call npm.cmd start
if errorlevel 1 goto run_error
goto done
:folder_error
echo Could not open the project folder. Extract the archive fully and retry.
goto fail
:files_missing
echo Project files are missing. Extract the whole project ZIP before running this file.
goto fail
:missing_node
echo Node.js and npm were not found. Install Node.js 22 or newer from https://nodejs.org/ and reopen this file.
goto fail
:old_node
echo Node.js 22 or newer is required. Update Node.js and reopen this file.
goto fail
:install_error
echo Dependency installation failed. Check the messages above and your internet connection.
goto fail
:build_error
echo Build failed. Check the messages above.
goto fail
:run_error
echo The server stopped with an error. Check the messages above.
:fail
pause
exit /b 1
:done
endlocal
