param([ValidateSet('start', 'stop', 'restart', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$serverRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.local-server'))
$serverJar = Join-Path $serverRoot 'bin\Suwayomi-Server-v2.4.2366.jar'
$serverData = Join-Path $serverRoot 'data'
$serverPidFile = Join-Path $serverRoot 'server.pid'

function Get-LocalServerProcess {
    # Oracle's javapath shim can spawn a separate JVM. Prefer the actual listener.
    $listener = Get-NetTCPConnection -LocalPort 4567 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if ($owner -and $owner.CommandLine.Contains($serverJar) -and $owner.CommandLine.Contains($serverData)) {
            [System.IO.File]::WriteAllText($serverPidFile, [string]$owner.ProcessId)
            return $owner
        }
    }
    if (-not (Test-Path -LiteralPath $serverPidFile)) { return $null }
    $serverProcessId = [int](Get-Content -LiteralPath $serverPidFile -Raw).Trim()
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
    if (-not $process) { return $null }
    if (-not $process.CommandLine -or -not $process.CommandLine.Contains($serverJar) -or -not $process.CommandLine.Contains($serverData)) {
        # Windows can reuse a PID after reboot. Discard only our stale record.
        Remove-Item -LiteralPath $serverPidFile
        return $null
    }
    return $process
}

$existing = Get-LocalServerProcess
if ($Action -eq 'status') {
    if ($existing) { Write-Output "Suwayomi local ativo: PID $($existing.ProcessId), http://127.0.0.1:4567" }
    else { Write-Output 'Suwayomi local parado.' }
    return
}
if ($Action -in @('stop', 'restart')) {
    if ($existing) {
        Stop-Process -Id $existing.ProcessId
        Wait-Process -Id $existing.ProcessId -Timeout 30 -ErrorAction SilentlyContinue
        Write-Output 'Suwayomi local encerrado. Os dados continuam na pasta fixa.'
    }
    if ($Action -eq 'stop') { return }
    $existing = $null
}
if ($existing) { Write-Output 'Suwayomi local ja esta ativo em http://127.0.0.1:4567'; return }
if (-not (Test-Path -LiteralPath $serverJar)) { throw 'Execute python tools/setup-suwayomi-local.py primeiro.' }
if (Get-NetTCPConnection -LocalPort 4567 -State Listen -ErrorAction SilentlyContinue) { throw 'A porta 4567 esta ocupada por outro processo.' }
$javaExecutable = (Get-Command java.exe).Source
$versionInfo = New-Object System.Diagnostics.ProcessStartInfo
$versionInfo.FileName = $javaExecutable
$versionInfo.Arguments = '-version'
$versionInfo.UseShellExecute = $false
$versionInfo.CreateNoWindow = $true
$versionInfo.RedirectStandardError = $true
$versionProcess = [System.Diagnostics.Process]::Start($versionInfo)
$versionText = $versionProcess.StandardError.ReadToEnd()
$versionProcess.WaitForExit()
$versionProcess.Dispose()
if ($versionText -notmatch 'version "(?<major>\d+)' -or [int]$Matches.major -lt 21) { throw 'Suwayomi requer Java 21 ou superior.' }
$javaInfo = New-Object System.Diagnostics.ProcessStartInfo
$javaInfo.FileName = $javaExecutable
$javaInfo.Arguments = '-XshowSettings:properties -version'
$javaInfo.UseShellExecute = $false
$javaInfo.CreateNoWindow = $true
$javaInfo.RedirectStandardError = $true
$javaInfoProcess = [System.Diagnostics.Process]::Start($javaInfo)
$javaInfoText = $javaInfoProcess.StandardError.ReadToEnd()
$javaInfoProcess.WaitForExit()
$javaInfoProcess.Dispose()
$javaHomeMatch = [regex]::Match($javaInfoText, '(?m)^\s*java.home\s*=\s*(.+)$')
if ($javaHomeMatch.Success) {
    $directJava = Join-Path $javaHomeMatch.Groups[1].Value.Trim() 'bin\java.exe'
    if (Test-Path -LiteralPath $directJava) { $javaExecutable = $directJava }
}
$arguments = @('-Djava.awt.headless=true', "`"-Dsuwayomi.tachidesk.config.server.rootDir=$serverData`"", '-jar', "`"$serverJar`"")
$process = Start-Process -FilePath $javaExecutable -ArgumentList $arguments -WorkingDirectory $serverRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $serverRoot 'logs\server.stdout.log') -RedirectStandardError (Join-Path $serverRoot 'logs\server.stderr.log')
[System.IO.File]::WriteAllText($serverPidFile, [string]$process.Id)
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4567/api/v1/settings/about' -TimeoutSec 2
        if ($health.name -eq 'Suwayomi-Server') { break }
    } catch {}
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { throw "O servidor encerrou. Confira $serverRoot\logs\server.stderr.log" }
    Start-Sleep -Milliseconds 1000
}
if ($health.name -ne 'Suwayomi-Server') { throw "O servidor ainda nao respondeu. Confira os logs em $serverRoot\logs" }
Write-Output "Suwayomi local iniciado: PID $($process.Id), http://127.0.0.1:4567"
Write-Output "Dados persistentes: $serverData"
