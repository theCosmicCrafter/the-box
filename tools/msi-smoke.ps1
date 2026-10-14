# SPDX-License-Identifier: LicenseRef-Proprietary
# MSI install smoke test - validates the produced installer end-to-end on
# this machine (install -> launch -> process alive -> uninstall).
# Usage: powershell -File tools/msi-smoke.ps1
$ErrorActionPreference = 'Stop'
$msi = Get-ChildItem "$PSScriptRoot\..\apps\desktop\src-tauri\target\release\bundle\msi\*.msi" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msi) { throw 'No MSI found - run npx tauri build first' }
Write-Host "MSI: $($msi.Name) ($([math]::Round($msi.Length/1MB,2)) MiB)"

Write-Host 'Installing silently...'
$p = Start-Process msiexec.exe -ArgumentList "/i `"$($msi.FullName)`" /qn /norestart" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "msiexec install failed: $($p.ExitCode)" }

$exe = "$env:ProgramFiles\The Box\the-box.exe"
if (-not (Test-Path $exe)) {
    # Tauri MSI may install per-user or under a different dir - locate it
    $exe = Get-ChildItem "$env:ProgramFiles","$env:LOCALAPPDATA\Programs" -Recurse -Filter 'the-box.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $exe) { throw 'the-box.exe not found after install' }
Write-Host "Installed at: $exe"

Write-Host 'Launching installed binary...'
$proc = Start-Process $exe -PassThru
Start-Sleep -Seconds 6
$alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($alive) {
    Write-Host "PASS: installed binary alive (PID $($proc.Id))"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
} else {
    throw 'Installed binary exited within 6s'
}

Write-Host 'Uninstalling...'
$u = Start-Process msiexec.exe -ArgumentList "/x `"$($msi.FullName)`" /qn /norestart" -Wait -PassThru
if ($u.ExitCode -ne 0) { Write-Warning "uninstall returned $($u.ExitCode) - remove manually" }
Write-Host 'MSI smoke test complete.'
