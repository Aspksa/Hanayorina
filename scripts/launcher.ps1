$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$runtime = Join-Path $root '.runtime'
$portable = Join-Path $runtime 'node\node.exe'
$nodeVersion = '22.23.4'

function Find-Node {
    if (Test-Path -LiteralPath $portable) {
        try { & $portable -e 'process.exit(parseInt(process.versions.node,10) >= 22 ? 0 : 1)' 2>$null; if ($LASTEXITCODE -eq 0) { return $portable } } catch {}
    }
    $n = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($n) {
        try { & $n.Source -e 'process.exit(parseInt(process.versions.node,10) >= 22 ? 0 : 1)' 2>$null; if ($LASTEXITCODE -eq 0) { return $n.Source } } catch {}
    }
    return $null
}
function Download-Node {
    if (Test-Path -LiteralPath (Join-Path $runtime 'node')) { throw 'Папка .runtime\node уже существует, но Node.js в ней не работает. Переименуйте её и повторите запуск.' }
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $target = switch -Regex ($arch) { '^AMD64$' { 'x64'; break } '^ARM64$' { 'arm64'; break } default { throw "Архитектура $arch не поддерживается автоматической установкой." } }
    $name = "node-v$nodeVersion-win-$target.zip"
    $url = "https://nodejs.org/dist/v$nodeVersion"
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $temp = Join-Path $runtime ('node-install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host 'Проверка соединения и загрузка Node.js с nodejs.org...'
        try {
            $wc = New-Object System.Net.WebClient
            try { $sums = $wc.DownloadString("$url/SHASUMS256.txt"); $wc.DownloadFile("$url/$name", (Join-Path $temp $name)) } finally { $wc.Dispose() }
        } catch { throw 'Не удалось скачать Node.js. Проверьте интернет и доступ к nodejs.org; установка не завершена.' }
        $line = $sums -split "`n" | Where-Object { $_ -match ('^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($name) + '\s*$') } | Select-Object -First 1
        if (-not $line) { throw 'Контрольная сумма архива отсутствует в списке Node.js.' }
        $expected = ($line -split '\s+')[0].ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath (Join-Path $temp $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw 'Контрольная сумма Node.js не совпала. Установка отменена.' }
        Write-Host 'SHA-256 совпал. Распаковка...'
        Expand-Archive -LiteralPath (Join-Path $temp $name) -DestinationPath $temp
        $extracted = Join-Path $temp "node-v$nodeVersion-win-$target"
        if (-not (Test-Path -LiteralPath (Join-Path $extracted 'node.exe')) -or -not (Test-Path -LiteralPath (Join-Path $extracted 'node_modules\npm\bin\npm-cli.js'))) { throw 'Архив Node.js неполный.' }
        Move-Item -LiteralPath $extracted -Destination (Join-Path $runtime 'node')
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force } }
    return $portable
}
function Find-Npm([string]$node) {
    $candidate = Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($npm) { $candidate = Join-Path (Split-Path -Parent $npm.Source) 'node_modules\npm\bin\npm-cli.js'; if (Test-Path -LiteralPath $candidate) { return $candidate } }
    return $null
}
function Test-Dependencies([string]$node, [string]$npm) {
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $node $npm ls --all --silent 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $previous }
}
function Test-Port([int]$port) {
    $listener = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), $port
    try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}
function Diagnose {
    Write-Host "`n--- Диагностика ---"
    $n = Find-Node
    if ($n) {
        Write-Host 'Node.js:' (& $n --version)
        $npm = Find-Npm $n
        if ($npm) { Write-Host 'npm:' (& $n $npm --version) } else { Write-Host 'npm: не найден' }
        if ($npm -and (Test-Path -LiteralPath 'node_modules')) { if (Test-Dependencies $n $npm) { Write-Host 'Зависимости: проверка пройдена' } else { Write-Host 'Зависимости: требуется восстановление при запуске' } } else { Write-Host 'Зависимости: не установлены или не проверены' }
        if (Test-Path -LiteralPath 'node_modules\pg') {
            & $n 'scripts/db-check.cjs'
        } else { Write-Host 'PostgreSQL: проверка недоступна до установки зависимостей' }
    } else { Write-Host 'Node.js: не найден или версия ниже 22' }
    if (Test-Port 4173) { Write-Host 'Порт 4173: свободен' } else { Write-Host 'Порт 4173: занят' }
    Write-Host 'Подробности: docs\setup.md'
}
try {
    foreach ($file in @('package.json','package-lock.json','config\tsconfig.json','scripts\db-check.cjs')) { if (-not (Test-Path -LiteralPath $file)) { throw "Не найден файл $file. Распакуйте весь архив проекта." } }
    Write-Host 'Hanayorina'
    Write-Host '1. Запустить'
    Write-Host '2. Диагностика'
    $choice = Read-Host 'Выберите пункт (Enter — запуск)'
    if ($choice -eq '2') { Diagnose; Read-Host 'Нажмите Enter для выхода' | Out-Null; exit 0 }
    if ($choice -and $choice -ne '1') { throw 'Неизвестный пункт меню.' }
    $node = Find-Node
    if (-not $node) { $node = Download-Node }
    $env:PATH = (Split-Path -Parent $node) + [IO.Path]::PathSeparator + $env:PATH
    $npm = Find-Npm $node
    if (-not $npm) { throw 'npm не найден. Установите полную версию Node.js или переименуйте .runtime\node для автоматической установки.' }
    if (-not (Test-Dependencies $node $npm)) {
        Write-Host 'Установка или восстановление зависимостей. Для этого нужен интернет и доступ к registry.npmjs.org.'
        & $node $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости. Проверьте интернет и сообщения npm выше.' }
        if (-not (Test-Dependencies $node $npm)) { throw 'Зависимости не прошли проверку после установки.' }
    }
    Write-Host 'Сборка...'
    & $node 'node_modules/typescript/bin/tsc' -p 'config/tsconfig.json'
    if ($LASTEXITCODE -ne 0) { throw 'Ошибка сборки. Проверьте сообщения выше.' }
    $port = 4173
    while ($port -le 4193 -and -not (Test-Port $port)) { $port++ }
    if ($port -gt 4193) { throw 'Все порты 4173–4193 заняты. Закройте одну из программ и повторите запуск.' }
    if ($port -ne 4173) { Write-Host "Порт 4173 занят. Используется порт $port." }
    $env:HANAYORINA_PORT = "$port"
    $env:HANAYORINA_HEALTH_TOKEN = [guid]::NewGuid().ToString('N')
    $url = "http://127.0.0.1:$port"
    Write-Host 'Запуск сервера и проверка PostgreSQL...'
    $proc = Start-Process -FilePath $node -ArgumentList 'dist/server/index.js' -WorkingDirectory $root -NoNewWindow -PassThru
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        $proc.Refresh()
        if ($proc.HasExited) { throw "Сервер завершился с кодом $($proc.ExitCode). Проверьте PostgreSQL и сообщения выше." }
        try { $reply = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 1 -UseBasicParsing; if ($reply.token -eq $env:HANAYORINA_HEALTH_TOKEN) { $ready = $true; break } } catch {}
    }
    if (-not $ready) { if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }; throw 'Сервер не подтвердил готовность за 30 секунд.' }
    Write-Host "Hanayorina готова: $url"
    Write-Host 'Для остановки закройте окно или нажмите Ctrl+C.'
    try { Start-Process $url } catch { Write-Host 'Не удалось открыть браузер. Откройте адрес вручную.' }
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "Сервер завершился с кодом $($proc.ExitCode)." }
} catch { Write-Host "ОШИБКА: $($_.Exception.Message)"; exit 1 }
