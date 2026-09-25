# End-to-end check of install.ps1 against local archives (#717): install, PATH,
# downgrade guard, upgrade from an older build, uninstall.
param(
	[Parameter(Mandatory)][string]$NewDir,
	[Parameter(Mandatory)][string]$NewVersion,
	[string]$OldDir,
	[string]$OldVersion
)
$ErrorActionPreference = "Stop"
$installer = Join-Path $PSScriptRoot "install.ps1"
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("pl-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory $work | Out-Null
$env:LOCALAPPDATA = Join-Path $work "appdata"
$env:CI = "true"
$bin = Join-Path $env:LOCALAPPDATA "prismalens\bin"
$port = 3943

function Fail([string]$m) { Write-Error "SMOKE FAIL: $m"; exit 1 }
function Pass([string]$m) { Write-Host "ok - $m" }

function Stage([string]$dir, [string]$v, [string]$label) {
	$d = Join-Path $work "base-$label\v$v"
	New-Item -ItemType Directory $d -Force | Out-Null
	$zip = Get-ChildItem (Join-Path $dir "prismalens-$v-*.zip") | Select-Object -First 1
	Copy-Item $zip.FullName $d
	"$((Get-FileHash $zip.FullName -Algorithm SHA256).Hash.ToLower())  $($zip.Name)" | Out-File (Join-Path $d "SHA256SUMS") -Encoding ascii
	return "file:///" + (Join-Path $work "base-$label").Replace('\', '/')
}

function Install([string]$base, [string[]]$more) {
	$env:PRISMALENS_RELEASE_BASE_URL = $base
	$log = & pwsh -NoProfile -File $installer @more 2>&1 | Out-String
	Write-Host $log
	return $LASTEXITCODE
}

# pl.cmd runs node.exe as a child; killing only cmd.exe leaves node holding the runtime open.
function Stop-Tree($p) { & taskkill /PID $p.Id /T /F 2>&1 | Out-Null; Start-Sleep 2 }

function Healthy([string]$ws) {
	$p = Start-Process -FilePath (Join-Path $bin "pl.cmd") -ArgumentList "up", "--port", "$port", "--workspace", $ws -PassThru -WindowStyle Hidden
	for ($i = 0; $i -lt 90; $i++) {
		try {
			if ((Invoke-WebRequest "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
				Stop-Tree $p; return $true
			}
		} catch {}
		if ($p.HasExited) { break }
		Start-Sleep 1
	}
	Stop-Tree $p
	return $false
}

$newBase = Stage $NewDir $NewVersion "new"

if ($OldDir) {
	$oldBase = Stage $OldDir $OldVersion "old"
	if ((Install $oldBase @("-Version", $OldVersion, "-NoModifyPath")) -ne 0) { Fail "installing $OldVersion" }
	$ws = Join-Path $work "workspace"
	if (-not (Healthy $ws)) { Fail "$OldVersion pl up" }
	if ((Install $newBase @("-Version", $NewVersion, "-NoModifyPath")) -ne 0) { Fail "upgrading to $NewVersion" }
	if (-not (Healthy $ws)) { Fail "$NewVersion pl up on the $OldVersion workspace" }
	Pass "upgrade $OldVersion -> ${NewVersion}: pl up healthy on the old workspace"
	& pwsh -NoProfile -File $installer -Uninstall | Out-Null
}

$out = Install $newBase @("-Version", $NewVersion)
if ($out -ne 0) { Fail "fresh install" }
if ((& (Join-Path $bin "pl.cmd") --version).Trim() -ne $NewVersion) { Fail "pl --version" }
if (([Environment]::GetEnvironmentVariable("Path", "User") -split ';') -notcontains $bin) { Fail "bin dir not on the user PATH" }
if (-not (Select-String -Path (Join-Path $env:LOCALAPPDATA "prismalens\receipt") -Pattern "^version=$NewVersion$" -Quiet)) { Fail "receipt" }
Pass "fresh install: pl $NewVersion, user PATH, receipt written"

$receipt = Join-Path $env:LOCALAPPDATA "prismalens\receipt"
(Get-Content $receipt) -replace '^version=.*', 'version=99.0.0' | Set-Content $receipt -Encoding ascii
if ((Install $newBase @("-Version", $NewVersion)) -eq 0) { Fail "downgrade from 99.0.0 was not refused" }
(Get-Content $receipt) -replace '^version=.*', "version=$NewVersion" | Set-Content $receipt -Encoding ascii
Pass "downgrade guard"

& pwsh -NoProfile -File $installer -Uninstall | Out-Null
if (Test-Path (Join-Path $bin "pl.cmd")) { Fail "pl wrapper left behind" }
if (([Environment]::GetEnvironmentVariable("Path", "User") -split ';') -contains $bin) { Fail "user PATH entry left behind" }
if (Test-Path (Join-Path $env:LOCALAPPDATA "prismalens")) { Fail "runtime left behind" }
Pass "uninstall: wrappers, PATH entry and runtime gone"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
