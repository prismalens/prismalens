# PrismaLens installer for Windows (#717): a release archive with its own Node,
# checked against SHA256SUMS. Run it with -Help for the options.
param(
	[string]$Version = $env:PRISMALENS_VERSION,
	[switch]$NoModifyPath,
	[switch]$Uninstall,
	[switch]$Help
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repo = "prismalens/prismalens"
$api = "https://api.github.com/repos/$repo"
$baseUrl = if ($env:PRISMALENS_RELEASE_BASE_URL) { $env:PRISMALENS_RELEASE_BASE_URL } else { "https://github.com/$repo/releases/download" }
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
$dataRoot = Join-Path $localAppData "prismalens"
$runtimeRoot = Join-Path $dataRoot "runtime"
$receipt = Join-Path $dataRoot "receipt"
$binDir = if ($env:PRISMALENS_INSTALL_BIN_DIR) { $env:PRISMALENS_INSTALL_BIN_DIR } else { Join-Path $dataRoot "bin" }
$marker = "rem Added by the PrismaLens installer"
if ($env:PRISMALENS_NO_MODIFY_PATH -eq "1") { $NoModifyPath = $true }
if ($Version) { $Version = $Version -replace '^v', '' }

if ($Help) {
	@"
Install PrismaLens without Node.

  irm https://prismalens.io/install.ps1 | iex
  & ([scriptblock]::Create((irm https://prismalens.io/install.ps1))) -Version 0.5.1
  & ([scriptblock]::Create((irm https://prismalens.io/install.ps1))) -Uninstall

Options:
  -Version <v>     Install this version instead of the newest.
  -NoModifyPath    Don't add the bin directory to your user PATH.
  -Uninstall       Remove the runtime, the pl wrappers and the PATH entry.
                   Your workspace (%USERPROFILE%\.prismalens) is kept.
  -Help            Show this.

Environment:
  PRISMALENS_VERSION, PRISMALENS_NO_MODIFY_PATH=1   Same as the options.
  PRISMALENS_ALLOW_DOWNGRADE=1   Allow an older version than the one installed.
  PRISMALENS_INSTALL_BIN_DIR     Where pl goes (default %LOCALAPPDATA%\prismalens\bin).
  PRISMALENS_RELEASE_BASE_URL    Mirror for the release downloads.
  NO_COLOR                       Plain output.
"@
	return
}

# --- output -----------------------------------------------------------------

$fancy = -not [Console]::IsErrorRedirected -and -not $env:NO_COLOR -and -not $env:CI
$e = [char]27
function C([string]$rgb) { if ($fancy) { "$e[38;2;${rgb}m" } else { "" } }
$r = if ($fancy) { "$e[0m" } else { "" }
$bold = if ($fancy) { "$e[1m" } else { "" }
$dim = if ($fancy) { "$e[2m" } else { "" }
$ink = C "226;232;240"; $beam = C "148;163;184"
$sky = C "56;189;248"; $ind = C "99;102;241"; $vio = C "139;92;246"
$okC = C "52;211;153"; $warnC = C "251;191;36"; $errC = C "248;113;113"

function Banner([string]$what) {
	if (-not $fancy) { return }
	[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
	$lines = @(
		"",
		"               ${ink}╱╲${r}",
		"              ${ink}╱  ╲${r}            ${sky}▂▄▆${r}",
		"             ${ink}╱    ╲${r}      ${sky}▂▄▆▀▀${r}",
		"  ${beam}━━━━━━━━━━${ink}╱${r}      ${ink}╲${ind}━━━━━━━━━━━━━${r}",
		"           ${ink}╱        ╲${r}    ${vio}▀▀▆▄▂${r}",
		"          ${ink}╱──────────╲${r}        ${vio}▀▆▄▂${r}",
		"",
		"   ${bold}${ind}Prisma${ink}Lens${r}  ${dim}$what${r}",
		"   ${dim}AI root-cause investigation, in your terminal${r}",
		""
	)
	foreach ($l in $lines) { [Console]::Error.WriteLine($l) }
}
function Step([string]$m) { [Console]::Error.WriteLine("  ${dim}•${r} $m") }
function Done([string]$m) { [Console]::Error.WriteLine("  ${okC}✔${r} $m") }
function Warn([string]$m) { [Console]::Error.WriteLine("  ${warnC}!${r} $m") }
# throw, not exit: under `irm | iex`, exit would close the user's PowerShell window.
function Fail([string]$m) { [Console]::Error.WriteLine("  ${errC}✘${r} $m"); throw "PrismaLens installer stopped." }

# --- helpers ----------------------------------------------------------------

function Fetch([string]$Url, [string]$OutFile) {
	if ($Url.StartsWith("file://")) {
		$p = $Url.Substring(7)
		if ($p -match '^/([a-zA-Z]:/.*)') { $p = $matches[1] }
		$p = $p.Replace('/', '\')
		if (-not (Test-Path $p)) { return $false }
		Copy-Item -Path $p -Destination $OutFile -Force
		return $true
	}
	try {
		[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
		Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -Headers @{ "User-Agent" = "prismalens-installer" }
		return $true
	} catch { return $false }
}

function Read-Receipt {
	$h = @{}
	if (Test-Path $receipt) {
		foreach ($line in Get-Content $receipt) {
			$i = $line.IndexOf("=")
			if ($i -gt 0) { $h[$line.Substring(0, $i)] = $line.Substring($i + 1) }
		}
	}
	return $h
}

function Get-UserPath { [Environment]::GetEnvironmentVariable("Path", "User") }
function Set-UserPath([string]$v) { [Environment]::SetEnvironmentVariable("Path", $v, "User") }

# --- uninstall --------------------------------------------------------------

if ($Uninstall) {
	Banner "uninstaller"
	$rec = Read-Receipt
	$dir = if ($rec["bin_dir"]) { $rec["bin_dir"] } else { $binDir }
	foreach ($name in "pl.cmd", "prismalens.cmd") {
		$f = Join-Path $dir $name
		if ((Test-Path $f) -and (Select-String -Path $f -SimpleMatch $marker -Quiet)) {
			Remove-Item $f -Force
			Done "Removed $f"
		}
	}
	if ($rec["path_added"] -eq "1") {
		$parts = (Get-UserPath) -split ';' | Where-Object { $_ -and $_ -ne $dir }
		Set-UserPath ($parts -join ';')
		Done "Removed $dir from your user PATH"
	}
	if (Test-Path $dataRoot) {
		Remove-Item $dataRoot -Recurse -Force
		Done "Removed $dataRoot"
	}
	$ws = if ($env:PRISMALENS_WORKSPACE_DIR) { $env:PRISMALENS_WORKSPACE_DIR } else { Join-Path $env:USERPROFILE ".prismalens" }
	[Console]::Error.WriteLine("`n  Your workspace is kept: $ws`n  To delete it as well, run ${bold}pl reset${r} first, or remove that folder.`n")
	return
}

# --- install ----------------------------------------------------------------

Banner "installer"

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
	Fail "$env:PROCESSOR_ARCHITECTURE isn't supported by this installer; use npm install -g prismalens"
}
$target = "win32-x64"

$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("pl-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
	$sums = Join-Path $staging "SHA256SUMS"

	# The newest release with its archives attached. standalone.yml builds them for
	# about 20 minutes after a release publishes, so fall back to the one before.
	if ($Version) {
		if (-not (Fetch "$baseUrl/v$Version/SHA256SUMS" $sums)) { Fail "PrismaLens $Version has no installer archives" }
	} else {
		Step "Finding the newest release"
		$relFile = Join-Path $staging "releases.json"
		if (-not (Fetch "$api/releases?per_page=5" $relFile)) { Fail "Couldn't reach GitHub. Pass -Version to install a known version." }
		$tags = @((Get-Content $relFile -Raw | ConvertFrom-Json) |
			Where-Object { -not $_.draft -and -not $_.prerelease } |
			ForEach-Object { $_.tag_name -replace '^v', '' } |
			Where-Object { $_ -match '^\d+\.\d+\.\d+$' })
		$newest = $tags | Select-Object -First 1
		foreach ($t in $tags) {
			if (Fetch "$baseUrl/v$t/SHA256SUMS" $sums) { $Version = $t; break }
		}
		if (-not $Version) { Fail "No release has installer archives yet; use npm install -g prismalens" }
		if ($Version -ne $newest) { Warn "$newest is still being built, so this installs $Version. Run the installer again in a few minutes for $newest." }
	}

	$rec = Read-Receipt
	$installed = $rec["version"]
	if ($installed -and ([version]$Version -lt [version]$installed)) {
		Warn "$Version is older than the $installed installed."
		Warn "A workspace $installed has migrated won't open in ${Version}: pl up stops with"
		Warn "`"migrations this build does not ship`". To go back, restore the prismalens.db.bak-*"
		Warn "file $installed left in your workspace before migrating."
		if ($env:PRISMALENS_ALLOW_DOWNGRADE -ne "1") { Fail "Set PRISMALENS_ALLOW_DOWNGRADE=1 to install $Version anyway." }
	}

	$archive = "prismalens-$Version-$target.zip"
	$archiveFile = Join-Path $staging $archive
	Step "Downloading PrismaLens $Version for $target"
	if (-not (Fetch "$baseUrl/v$Version/$archive" $archiveFile)) { Fail "Couldn't download $archive" }

	$mb = "{0:N1} MB" -f ((Get-Item $archiveFile).Length / 1MB)
	Step "Verifying $mb against SHA256SUMS"
	$expected = ""
	foreach ($line in Get-Content $sums) {
		$parts = $line.Trim() -split '\s+'
		if ($parts.Length -ge 2 -and ($parts[1] -eq $archive -or $parts[1] -eq "*$archive")) { $expected = $parts[0].ToLower(); break }
	}
	if (-not $expected) { Fail "$archive isn't listed in SHA256SUMS" }
	$actual = (Get-FileHash -Path $archiveFile -Algorithm SHA256).Hash.ToLower()
	if ($actual -ne $expected) { Fail "Checksum mismatch for $archive; nothing was installed" }

	$dest = Join-Path $runtimeRoot $Version
	Step "Installing to $dest"
	Expand-Archive -Path $archiveFile -DestinationPath $staging -Force
	$unpacked = Join-Path $staging "prismalens-$Version-$target"
	if (-not (Test-Path $unpacked)) { Fail "Unexpected archive layout" }
	New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
	if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
	Move-Item -Path $unpacked -Destination $dest

	New-Item -ItemType Directory -Path $binDir -Force | Out-Null
	foreach ($name in "pl", "prismalens") {
		Set-Content -Path (Join-Path $binDir "$name.cmd") -Encoding ASCII -Value "@echo off`r`n$marker`r`n`"$dest\bin\$name.cmd`" %*`r`n"
	}

	# Keep this version and the one it replaced, for rollback.
	Get-ChildItem $runtimeRoot -Directory | Where-Object { $_.Name -ne $Version -and $_.Name -ne $installed } |
		ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

	$pathAdded = if ($rec["path_added"]) { $rec["path_added"] } else { "0" }
	$userParts = @((Get-UserPath) -split ';' | Where-Object { $_ })
	if ($userParts -notcontains $binDir) {
		if ($NoModifyPath) {
			Warn "$binDir isn't on your PATH; add it to run pl."
		} else {
			Set-UserPath ((@($userParts) + $binDir) -join ';')
			$pathAdded = "1"
			Done "Added $binDir to your user PATH"
			Warn "Open a new terminal for PATH to pick it up."
		}
	}
	if (($env:Path -split ';') -notcontains $binDir) { $env:Path = "$binDir;$env:Path" }

	@(
		"version=$Version",
		"channel=installer",
		"target=$target",
		"bin_dir=$binDir",
		"path_added=$pathAdded",
		"installed_at=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))"
	) | Set-Content -Path $receipt -Encoding ASCII

	$others = @(Get-Command pl -All -CommandType Application -ErrorAction SilentlyContinue |
		Where-Object { -not (Select-String -Path $_.Source -SimpleMatch $marker -Quiet -ErrorAction SilentlyContinue) })
	if ($others.Count -gt 0) {
		Warn "Another PrismaLens is on your PATH:"
		foreach ($o in $others) {
			$ov = try { (& $o.Source --version 2>$null) } catch { "version unknown" }
			Warn "  $($o.Source) ($ov)"
		}
		Warn "They share one workspace, and an older one stops once a newer one has migrated it."
		Warn "Remove the other one (npm uninstall -g prismalens, scoop uninstall prismalens) or keep both on one version."
	}

	$v = (& (Join-Path $binDir "pl.cmd") --version).Trim()
	Done "PrismaLens $v installed"
	[Console]::Error.WriteLine("`n  Start it with ${bold}pl up${r}   ·   Upgrade with ${bold}pl upgrade${r}   ·   Docs: https://docs.prismalens.io`n")
} finally {
	Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
