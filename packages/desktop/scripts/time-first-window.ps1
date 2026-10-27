# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel

# Time to the first visible window, and to the rendered app, over N launches of an unpacked
# Windows build (`pnpm dist`); a fresh workspace and Electron profile per launch (#875).
#   powershell -File scripts/time-first-window.ps1 -Exe release\win-unpacked\PrismaLens.exe -WsRoot <empty dir>

param([string]$Exe, [int]$Runs = 10, [string]$WsRoot)
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$firsts = @(); $apps = @()
for ($i = 1; $i -le $Runs; $i++) {
  $ws = Join-Path $WsRoot ("run-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $ws | Out-Null
  $env:PRISMALENS_WORKSPACE_DIR = $ws
  $ud = Join-Path $env:TEMP ("pl-ud-" + [guid]::NewGuid())
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $Exe -ArgumentList "--user-data-dir=$ud" -PassThru
  $first = $null; $appT = $null; $titles = @()
  while ($sw.ElapsedMilliseconds -lt 90000 -and -not $appT) {
    $ws_ = Get-Process -Name PrismaLens -EA SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
    if ($ws_ -and -not $first) { $first = $sw.ElapsedMilliseconds; $titles += $ws_.MainWindowTitle }
    if ($ws_ | Where-Object { $_.MainWindowTitle -like "?*PrismaLens" -and $_.MainWindowTitle -ne "PrismaLens" }) { $appT = $sw.ElapsedMilliseconds }
    if ($ws_ | Where-Object { $_.MainWindowTitle -eq "Error" }) { break }
    Start-Sleep -Milliseconds 10
  }
  if ($appT) { $firsts += $first; $apps += $appT }
  Write-Output ("run {0}: first window {1} ms [{2}], app rendered {3} ms" -f $i, $first, ($titles -join ","), $appT)
  taskkill /PID $p.Id /T /F 2>$null | Out-Null
  Start-Sleep -Seconds 3
  Get-Process -Name PrismaLens -EA SilentlyContinue | Stop-Process -Force
  Remove-Item -Recurse -Force $ud -EA SilentlyContinue
}
function Median($xs) { $s = $xs | Sort-Object; $n = $s.Count; if ($n % 2) { $s[[int][Math]::Floor($n/2)] } else { ($s[$n/2-1] + $s[$n/2]) / 2 } }
Write-Output ("valid runs {0}; median first window {1} ms; median app rendered {2} ms" -f $firsts.Count, (Median $firsts), (Median $apps))
Write-Output ("first sorted: " + (($firsts | Sort-Object) -join ", "))
Write-Output ("app sorted: " + (($apps | Sort-Object) -join ", "))
