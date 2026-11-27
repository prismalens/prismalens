# PrismaLens installer for Windows (#717): a release archive with its own Node,
# checked against SHA256SUMS. Run it with -Help for the options.
param(
	[string]$Version = $env:PRISMALENS_VERSION,
	[switch]$NoModifyPath,
	[switch]$NoDesktop,
	[switch]$Uninstall,
	[switch]$Help
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repo = "prismalens/prismalens"
$api = "https://api.github.com/repos/$repo"
# Archives: mirror first (it keeps the newest releases only), GitHub second; a set base is the only one.
# SHA256SUMS: from the last base only (GitHub, or the set one), so a mirror can't vouch for its own bytes.
$mirrorBase = "https://downloads.prismalens.io"
$githubBase = "https://github.com/prismalens/prismalens/releases/download"
[string[]]$bases = if ($env:PRISMALENS_RELEASE_BASE_URL) { @($env:PRISMALENS_RELEASE_BASE_URL.TrimEnd('/')) } else { @($mirrorBase, $githubBase) }
$sumsBase = $bases[$bases.Count - 1]
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
$dataRoot = if ($env:PRISMALENS_HOME) { $env:PRISMALENS_HOME } else { Join-Path $localAppData "prismalens" }
# One spelling of it, full and without a trailing separator, so its -kept sibling sits outside it.
$dataRoot = [IO.Path]::GetFullPath($dataRoot).TrimEnd('\')
$runtimeRoot = Join-Path $dataRoot "runtime"
$receipt = Join-Path $dataRoot "receipt"
$binDir = if ($env:PRISMALENS_INSTALL_BIN_DIR) { $env:PRISMALENS_INSTALL_BIN_DIR } else { Join-Path $dataRoot "bin" }
$marker = "rem Added by the PrismaLens installer"
$desktopRoot = Join-Path $dataRoot "desktop"
# The ID every app folder this installer unpacks carries; the receipt keeps it as desktop_app_id.
$ownId = ""
$desktopAsset = "PrismaLens-Windows-X64-unsigned.zip"
$shortcutDir = if ($env:PRISMALENS_SHORTCUT_DIR) { $env:PRISMALENS_SHORTCUT_DIR } else { [Environment]::GetFolderPath("Programs") }
# GetFolderPath returns "" for an account without a Start menu, and Join-Path refuses "".
$shortcut = if ($shortcutDir) { Join-Path $shortcutDir "PrismaLens.lnk" } else { "" }
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
  -NoDesktop       Install the CLI only, without the desktop app and its Start menu shortcut.
                   Skipped by itself on Server Core and in CI.
  -Uninstall       Remove the runtime, the desktop app, the pl wrappers, the shortcut and
                   the PATH entry. Your workspace (%USERPROFILE%\.prismalens) is kept.
  -Help            Show this.

Environment:
  PRISMALENS_VERSION, PRISMALENS_NO_MODIFY_PATH=1   Same as the options.
  PRISMALENS_DESKTOP=0           Same as -NoDesktop; =1 installs the app even where it would be skipped.
  PRISMALENS_ALLOW_DOWNGRADE=1   Allow an older version than the one installed.
  PRISMALENS_HOME                Where the runtime and receipt go (default %LOCALAPPDATA%\prismalens).
  PRISMALENS_INSTALL_BIN_DIR     Where pl goes (default %PRISMALENS_HOME%\bin).
  PRISMALENS_RELEASE_BASE_URL    Download only from this base, as <base>/v<version>/<file>.
                                 Default: archives from downloads.prismalens.io, then GitHub releases;
                                 SHA256SUMS always from GitHub (or that base).
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

# Glyphs from code points: the file stays ASCII, so Windows PowerShell 5.1 parses it under -File (#906).
$slash = [string][char]0x2571; $bslash = [string][char]0x2572; $low1 = [string][char]0x2582; $low2 = [string][char]0x2584; $low3 = [string][char]0x2586; $high = [string][char]0x2580
$heavy = [string][char]0x2501; $thin = [string][char]0x2500; $bullet = [string][char]0x2022; $tick = [string][char]0x2714; $cross = [string][char]0x2718; $middot = [string][char]0x00B7

function Banner([string]$what) {
	if (-not $fancy) { return }
	[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
	$lines = @(
		"",
		"               ${ink}${slash}${bslash}${r}",
		"              ${ink}${slash}  ${bslash}${r}            ${sky}${low1}${low2}${low3}${r}",
		"             ${ink}${slash}    ${bslash}${r}      ${sky}${low1}${low2}${low3}$($high * 2)${r}",
		"  ${beam}$($heavy * 10)${ink}${slash}${r}      ${ink}${bslash}${ind}$($heavy * 13)${r}",
		"           ${ink}${slash}        ${bslash}${r}    ${vio}$($high * 2)${low3}${low2}${low1}${r}",
		"          ${ink}${slash}$($thin * 10)${bslash}${r}        ${vio}${high}${low3}${low2}${low1}${r}",
		"",
		"   ${bold}${ind}Prisma${ink}Lens${r}  ${dim}$what${r}",
		"   ${dim}AI root-cause investigation, in your terminal${r}",
		""
	)
	foreach ($l in $lines) { [Console]::Error.WriteLine($l) }
}
function Step([string]$m) { [Console]::Error.WriteLine("  ${dim}${bullet}${r} $m") }
function Done([string]$m) { [Console]::Error.WriteLine("  ${okC}${tick}${r} $m") }
function Warn([string]$m) { [Console]::Error.WriteLine("  ${warnC}!${r} $m") }
# throw, not exit: under `irm | iex`, exit would close the user's PowerShell window.
function Fail([string]$m) { [Console]::Error.WriteLine("  ${errC}${cross}${r} $m"); throw "PrismaLens installer stopped." }

# --- helpers ----------------------------------------------------------------

# System32's curl.exe (Windows 10 and later) shows a progress bar and is far faster than
# Invoke-WebRequest in Windows PowerShell 5.1, which draws none here.
$curl = Join-Path $env:SystemRoot "System32\curl.exe"
if (-not (Test-Path $curl)) { $curl = $null }

# -Stall: seconds without a byte before curl gives up, so a silent mirror can't hold the install.
function Fetch([string]$Url, [string]$OutFile, [switch]$Progress, [int]$Stall = 0) {
	if ($Url.StartsWith("file://")) {
		$p = $Url.Substring(7)
		if ($p -match '^/([a-zA-Z]:/.*)') { $p = $matches[1] }
		$p = $p.Replace('/', '\')
		if (-not (Test-Path $p)) { return $false }
		Copy-Item -Path $p -Destination $OutFile -Force
		return $true
	}
	if ($curl) {
		[string[]]$flags = if ($Progress) { @("--progress-bar") } else { @("-s") }
		if ($Stall -gt 0) { $flags += @("--speed-limit", "1024", "--speed-time", "$Stall") }
		& $curl -f -L --retry 2 --connect-timeout 20 -A "prismalens-installer" @flags -o $OutFile $Url
		if ($LASTEXITCODE -ne 0) { Remove-Item $OutFile -Force -ErrorAction SilentlyContinue; return $false }
		return $true
	}
	try {
		[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
		Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -Headers @{ "User-Agent" = "prismalens-installer" }
		return $true
	} catch { return $false }
}

# The archive's size in bytes, or $null when the server doesn't say.
function Get-Size([string]$Url) {
	if ($Url.StartsWith("file://")) { return $null }
	try {
		if ($curl) {
			$headers = & $curl -s -I -L --connect-timeout 20 --max-time 20 -A "prismalens-installer" $Url
			# A failed or timed-out request may still hold a redirect's headers: no size then.
			if ($LASTEXITCODE -ne 0) { return $null }
			return $headers | ForEach-Object { if ($_ -match '^(?i)content-length:\s*(\d+)') { [long]$matches[1] } } | Select-Object -Last 1
		}
		[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
		$h = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 20 -Headers @{ "User-Agent" = "prismalens-installer" }
		return [long]$h.Headers["Content-Length"]
	} catch { return $null }
}

function Base-Host([string]$Base) { if ($Base.StartsWith("file:")) { "disk" } else { ([uri]$Base).Host } }
function Hosts-Tried { ($bases | ForEach-Object { Base-Host $_ }) -join ", " }

# Fetches v<version>/SHA256SUMS from $sumsBase, the only place checksums come from.
function Fetch-Sums([string]$Ver, [string]$OutFile) { Fetch "$sumsBase/v$Ver/SHA256SUMS" $OutFile }

function Read-Receipt {
	$h = @{}
	if (Test-Path $receipt) {
		foreach ($line in Get-Content -LiteralPath $receipt -Encoding UTF8) {
			$i = $line.IndexOf("=")
			if ($i -gt 0) { $h[$line.Substring(0, $i)] = $line.Substring($i + 1) }
		}
	}
	return $h
}

# The release's own checksum for $Name in the SHA256SUMS at $SumsFile, or "".
function Get-Sum([string]$SumsFile, [string]$Name) {
	foreach ($line in Get-Content $SumsFile) {
		$parts = $line.Trim() -split '\s+'
		if ($parts.Length -ge 2 -and ($parts[1] -eq $Name -or $parts[1] -eq "*$Name")) { return $parts[0].ToLower() }
	}
	return ""
}

# Downloads v$Version/$Name from each base in turn until one matches $Expected. "" on success, else why each failed.
function Fetch-Verified([string]$Name, [string]$Expected, [string]$OutFile, [string]$What) {
	$tried = @()
	foreach ($base in $bases) {
		$h = Base-Host $base
		# A base with a successor is dropped after 30 s without a byte.
		$stall = if ($base -eq $sumsBase) { 0 } else { 30 }
		$url = "$base/v$Version/$Name"
		$bytes = Get-Size $url
		$size = if ($bytes) { " ({0:N0} MB)" -f ($bytes / 1MB) } else { "" }
		Step "Downloading $What$size from $h"
		if (-not (Fetch $url $OutFile -Progress -Stall $stall)) { $tried += "${h}: download failed"; continue }
		$mb = "{0:N1} MB" -f ((Get-Item $OutFile).Length / 1MB)
		Step "Verifying $mb against SHA256SUMS from $(Base-Host $sumsBase)"
		$actual = (Get-FileHash -Path $OutFile -Algorithm SHA256).Hash.ToLower()
		if ($actual -eq $Expected) { return "" }
		$tried += "${h}: Checksum mismatch"
	}
	return ($tried -join '; ')
}

# The target of the shortcut at $Path, or "" when there is none.
function Get-ShortcutTarget([string]$Path) {
	if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return "" }
	try { return [string](New-Object -ComObject WScript.Shell).CreateShortcut($Path).TargetPath } catch { return "" }
}

# Get-Item expands 8.3 names (C:\Users\RUNNER~1), so both sides compare in long form.
function Get-LongPath([string]$Path) {
	$item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
	if ($item) { return $item.FullName.TrimEnd("\") }
	$parent = Split-Path -Parent $Path
	if (-not $parent -or $parent -eq $Path) { return $Path }
	Join-Path (Get-LongPath $parent) (Split-Path -Leaf $Path)
}

# Whether $Path is in a copy this install unpacked: inside its desktop folder (the separator keeps
# desktop-other\ out), in a folder that carries its ID. A folder someone else put there doesn't.
function Test-Ours([string]$Path) {
	[bool]($Path -and $ownId -and (Get-LongPath $Path).StartsWith("$(Get-LongPath $desktopRoot)\", [StringComparison]::OrdinalIgnoreCase) -and
		(Get-InstallId (Split-Path -Parent $Path)) -eq $ownId)
}

# Why the desktop app is skipped on this machine, or "" to install it. The receipt's desktop=0 keeps an earlier opt-out.
function Get-DesktopSkip($Rec) {
	if ($NoDesktop -or $env:PRISMALENS_DESKTOP -eq "0") { return "you asked for the CLI only" }
	if (-not $shortcutDir) { return "this account has no Start menu" }
	$other = Get-ShortcutTarget $shortcut
	if ($other -and -not (Test-Ours $other) -and (Test-Path -LiteralPath $other)) {
		return "the Start menu's PrismaLens shortcut opens $other, which isn't this installer's; it was left as it is"
	}
	$scoop = Get-ShortcutTarget (Join-Path $shortcutDir "Scoop Apps\PrismaLens.lnk")
	if ($scoop -and (Test-Path -LiteralPath $scoop)) { return "Scoop's prismalens-app is installed; it upgrades with scoop update" }
	if ($env:PRISMALENS_DESKTOP -eq "1") { return "" }
	if ($Rec["desktop"] -eq "0") { return "an earlier install left it out; set PRISMALENS_DESKTOP=1 to add it" }
	if ($env:CI) { return "this is CI" }
	$kind = try { (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction Stop).InstallationType } catch { "" }
	if ($kind -match 'Server Core|Nano') { return "$kind has no desktop" }
	if (-not [Environment]::UserInteractive) { return "this session has no desktop (a service or a scheduled task)" }
	return ""
}

# The installed app's processes; a running copy keeps its folder locked.
function Get-DesktopProcesses {
	@(Get-Process -Name PrismaLens -ErrorAction SilentlyContinue | Where-Object { Test-Ours $_.Path })
}

function Get-InstallId([string]$Dir) {
	$f = Join-Path $Dir ".prismalens-install-id"
	if (Test-Path -LiteralPath $f -PathType Leaf) { return ([IO.File]::ReadAllText($f)).Trim() }
	return ""
}

# The only way this installer deletes a folder. What it put there goes; an app folder (a folder in
# desktop\) that doesn't carry $ownId stays where it is with the folders that hold it, and is named.
# False when something of the installer's can't go: each folder is renamed before it's deleted, so
# a running copy is never half removed.
function Remove-Owned([string]$Path, [switch]$Quiet) {
	$script:ownedLeft = ""
	if (-not (Test-Path -LiteralPath $Path)) { return $true }
	$long = Get-LongPath $Path
	$root = Get-LongPath $desktopRoot
	$apps = @()
	if ((Split-Path -Parent $long) -eq $root) { $apps = @($long) }
	elseif ("$root\".StartsWith("$long\", [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $root)) {
		$apps = @(Get-ChildItem -LiteralPath $root -Directory -Force | ForEach-Object { $_.FullName })
	}
	$foreign = @($apps | Where-Object { -not ($ownId -and (Get-InstallId $_) -eq $ownId) })
	if (-not $Quiet) { foreach ($a in $foreign) { Warn "$a isn't the app this installer put there; it and the folders that hold it were left as they are" } }
	if ($foreign -contains $long) { return $true }
	if ($foreign.Count -gt 0) {
		$ok = $true
		foreach ($c in @(Get-ChildItem -LiteralPath $Path -Force)) {
			if ($foreign -contains $c.FullName) { continue }
			if (-not (Remove-Owned $c.FullName -Quiet)) { $ok = $false }
		}
		return $ok
	}
	$trash = "$Path.old-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
	# A just-quit app's helpers, or a scanner, can hold a file for a moment after its last window closes.
	for ($try = 1; $true; $try++) {
		try { Rename-Item -LiteralPath $Path -NewName (Split-Path $trash -Leaf) -ErrorAction Stop; break } catch {
			if ($try -ge 10) { return $false }
			Start-Sleep -Milliseconds 500
		}
	}
	# The install ID goes last, and a partial delete is put back at $Path, so what's left is still ours.
	# Only app folders carry an ID: the runtime's thousands of files go in one Remove-Item below.
	$below = @($trash, (Join-Path $trash "desktop") | ForEach-Object { Get-ChildItem -LiteralPath $_ -Directory -Force -ErrorAction SilentlyContinue } | ForEach-Object { $_.FullName })
	$marked = @(@($trash) + $below |
		Where-Object { Test-Path -LiteralPath (Join-Path $_ ".prismalens-install-id") -PathType Leaf })
	$left = @($marked | ForEach-Object { Get-DeletableFiles $_ } | Where-Object { Remove-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue; Test-Path -LiteralPath $_ })
	if (-not $left) { Remove-Item -LiteralPath $trash -Recurse -Force -ErrorAction SilentlyContinue }
	if (Test-Path -LiteralPath $trash) {
		try { Rename-Item -LiteralPath $trash -NewName (Split-Path $Path -Leaf) -ErrorAction Stop; $trash = $Path } catch {}
		$script:ownedLeft = $trash
		Warn "Some of $Path couldn't be deleted; what's left is in $trash"
		return $false
	}
	return $true
}

# The files under $Dir but its install IDs, not looking through links: Remove-Owned deletes these first.
function Get-DeletableFiles([string]$Dir) {
	foreach ($i in @(Get-ChildItem -LiteralPath $Dir -Force -ErrorAction SilentlyContinue)) {
		if ($i.PSIsContainer -and -not ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Get-DeletableFiles $i.FullName }
		elseif (-not $i.PSIsContainer -and $i.Name -ne ".prismalens-install-id") { $i.FullName }
	}
}

# Removes the shortcut and the app this installer made, and nothing else.
function Remove-Desktop {
	if (Get-DesktopProcesses) { Fail "The PrismaLens app is running; quit it (tray icon, then Quit) and run this again. Nothing was removed." }
	$hadApp = Test-Path $desktopRoot
	# Judged before the app goes: a shortcut is the installer's when its target carries the ID.
	$ownShortcut = Test-Ours (Get-ShortcutTarget $shortcut)
	if ($hadApp -and -not (Remove-Owned $desktopRoot)) {
		if ($ownedLeft) { Fail "Couldn't remove all of the desktop app; what's left is in $ownedLeft. Nothing else was removed." }
		Fail "Couldn't remove the desktop app in ${desktopRoot}: a file in it is open. Nothing was removed."
	}
	if ($ownShortcut) {
		Remove-Item -LiteralPath $shortcut -Force
		Done "Removed the Start menu shortcut $shortcut"
	}
	if ($hadApp) { Done "Removed the desktop app" }
}

# Unpacks the verified app zip to desktop\<version> and points the Start menu shortcut at it. Returns the shortcut path.
# Versioned folders, because Windows locks a running app's files; the one a running app holds is pruned next time.
function Install-Desktop([string]$ZipFile, [string]$InstallId) {
	$dest = Join-Path $desktopRoot $Version
	$unpacked = Join-Path $desktopRoot (".new-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
	New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
	# Marked before it's filled, so even an interrupted unpack is one this installer can delete.
	# The app reads this ID beside its exe to tell it is the copy the receipt names.
	try { Set-Content -Path (Join-Path $unpacked ".prismalens-install-id") -Encoding ASCII -Value $InstallId -ErrorAction Stop } catch {
		Remove-Item -LiteralPath $unpacked -Force -ErrorAction SilentlyContinue
		throw "couldn't mark the app as this installer's: $_"
	}
	$out = & (Join-Path $env:SystemRoot "System32\tar.exe") -xf $ZipFile -C $unpacked --strip-components 1 2>&1
	if ($LASTEXITCODE -ne 0) { [void](Remove-Owned $unpacked); throw "couldn't unpack it: $(($out | Out-String).Trim())" }
	if (-not (Test-Path (Join-Path $unpacked "PrismaLens.exe"))) { [void](Remove-Owned $unpacked); throw "the archive has no PrismaLens.exe" }
	# Checked here, after the download: a folder someone else put at $dest is never replaced.
	if ((Test-Path $dest) -and (Get-InstallId $dest) -ne $InstallId) {
		[void](Remove-Owned $unpacked)
		throw "$dest isn't the app this installer put there; it was left as it is"
	}
	# A same-version reinstall keeps the current copy aside until the new one is in place.
	$backup = ""
	if (Test-Path $dest) {
		$backup = "$dest.old-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
		try { Rename-Item -Path $dest -NewName (Split-Path $backup -Leaf) -ErrorAction Stop } catch {
			[void](Remove-Owned $unpacked)
			throw "PrismaLens $Version is running from $dest; quit it and run the installer again"
		}
	}
	try {
		# Test seam: the one failure a test can't otherwise cause between the two renames.
		if ($env:PRISMALENS_TEST_FAIL_DESKTOP_MOVE -eq "1") { throw "the test made the move fail" }
		Move-Item -Path $unpacked -Destination $dest -ErrorAction Stop
		# Into a folder that appeared at $dest, Move-Item nests the copy: only the copy itself there counts.
		$nested = Join-Path $dest (Split-Path -Leaf $unpacked)
		if ((Test-Path -LiteralPath $nested) -or (Get-InstallId $dest) -ne $InstallId) {
			if (Test-Path -LiteralPath $nested) { Move-Item -LiteralPath $nested -Destination $unpacked -ErrorAction SilentlyContinue }
			throw "something else appeared at $dest during the install"
		}
	} catch {
		$why = "$_"
		[void](Remove-Owned $unpacked)
		if ($backup) {
			try { Rename-Item -Path $backup -NewName (Split-Path $dest -Leaf) -ErrorAction Stop } catch { throw "couldn't move it into place ($why), nor put the old copy back; it is in $backup" }
		}
		throw "couldn't move it into place: $why"
	}
	if ($backup) { [void](Remove-Owned $backup) }
	$exe = Join-Path $dest "PrismaLens.exe"
	New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
	$old = Get-ShortcutTarget $shortcut
	# Another copy may have registered its shortcut while the zip downloaded.
	if ($old -and -not (Test-Ours $old) -and (Test-Path -LiteralPath $old)) {
		throw "the Start menu's PrismaLens shortcut now opens $old, which isn't this installer's; it was left as it is"
	}
	if ($old -and -not (Test-Ours $old)) { Warn "Replaced the Start menu shortcut to $old, which no longer exists." }
	$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
	$link.TargetPath = $exe
	$link.WorkingDirectory = $dest
	$link.IconLocation = "$exe,0"
	$link.Description = "PrismaLens desktop app"
	$link.Save()
	# Older versions and interrupted unpacks go once nothing runs from them; a running one is pruned by a later install.
	Get-ChildItem $desktopRoot -Directory | Where-Object { $_.Name -ne $Version } |
		ForEach-Object { [void](Remove-Owned $_.FullName) }
	return $shortcut
}

function Get-UserPath { [Environment]::GetEnvironmentVariable("Path", "User") }
function Set-UserPath([string]$v) { [Environment]::SetEnvironmentVariable("Path", $v, "User") }

# --- uninstall --------------------------------------------------------------

if ($Uninstall) {
	Banner "uninstaller"
	$rec = Read-Receipt
	$ownId = $rec["desktop_app_id"]
	if (Get-DesktopProcesses) { Fail "The PrismaLens app is running; quit it (tray icon, then Quit) and run this again. Nothing was removed." }
	$dir = if ($rec["bin_dir"]) { $rec["bin_dir"] } else { $binDir }
	# First, so an app Windows won't let go of leaves pl as it was.
	Remove-Desktop
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
	$ws = if ($env:PRISMALENS_WORKSPACE_DIR) { $env:PRISMALENS_WORKSPACE_DIR } else { Join-Path $env:USERPROFILE ".prismalens" }
	if (Test-Path -LiteralPath $dataRoot) {
		if ($rec["channel"] -ne "installer") {
			Warn "$dataRoot holds no receipt from this installer, so it was left as it is"
		} elseif ("$(Get-LongPath $ws)\".StartsWith("$(Get-LongPath $dataRoot)\", [StringComparison]::OrdinalIgnoreCase)) {
			Warn "Your workspace is inside $dataRoot, so $dataRoot was left as it is"
		} elseif (Remove-Owned $dataRoot) {
			if (Test-Path -LiteralPath $dataRoot) { Warn "$dataRoot stays, holding only what this installer didn't put there" } else { Done "Removed $dataRoot" }
		} else {
			Warn "$dataRoot was kept: a file in it is open, or an app in it couldn't be moved aside"
		}
	}
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

	# The newest release with its archives attached. build-standalone-cli.yml builds them for
	# about 20 minutes after a release publishes, so fall back to the one before.
	# 30 releases, because up to 10 nightly prereleases sit among them (nightly.yml prunes the rest).
	if ($Version) {
		if (-not (Fetch-Sums $Version $sums)) { Fail "Couldn't fetch SHA256SUMS for $Version from $(Base-Host $sumsBase), the only source of checksums, so nothing was installed. Check the version and your connection." }
	} else {
		Step "Finding the newest release"
		$relFile = Join-Path $staging "releases.json"
		if (-not (Fetch "$api/releases?per_page=30" $relFile)) { Fail "Couldn't reach GitHub. Pass -Version to install a known version." }
		$tags = @((Get-Content $relFile -Raw | ConvertFrom-Json) |
			Where-Object { -not $_.draft -and -not $_.prerelease } |
			ForEach-Object { $_.tag_name -replace '^v', '' } |
			Where-Object { $_ -match '^\d+\.\d+\.\d+$' })
		$newest = $tags | Select-Object -First 1
		foreach ($t in $tags) {
			if (Fetch-Sums $t $sums) { $Version = $t; break }
		}
		if (-not $Version) { Fail "No release has installer archives yet; use npm install -g prismalens" }
		if ($Version -ne $newest) { Warn "$newest is still being built, so this installs $Version. Run the installer again in a few minutes for $newest." }
	}

	$rec = Read-Receipt
	# One ID for every copy this install unpacks, so older versions' folders are its own to prune.
	$ownId = if ($rec["desktop_app_id"]) { $rec["desktop_app_id"] } else { [guid]::NewGuid().ToString("N") }
	$installed = $rec["version"]
	if ($installed -and ([version]$Version -lt [version]$installed)) {
		Warn "$Version is older than the $installed installed."
		Warn "A workspace $installed has migrated won't open in ${Version}: pl up stops with"
		Warn "`"migrations this build does not ship`". To go back, restore the prismalens.db.bak-*"
		Warn "file $installed left in your workspace before migrating."
		if ($env:PRISMALENS_ALLOW_DOWNGRADE -ne "1") { Fail "Set PRISMALENS_ALLOW_DOWNGRADE=1 to install $Version anyway." }
	}

	if (($NoDesktop -or $env:PRISMALENS_DESKTOP -eq "0") -and (Get-DesktopProcesses)) {
		Fail "The PrismaLens app is running; quit it (tray icon, then Quit) and run this again to leave it out. Nothing was changed."
	}
	# Before the CLI changes, so a removal that fails leaves the install as it was.
	if ($NoDesktop -or $env:PRISMALENS_DESKTOP -eq "0") { Remove-Desktop }

	$archive = "prismalens-$Version-$target.zip"
	$archiveFile = Join-Path $staging $archive
	$expected = Get-Sum $sums $archive
	if (-not $expected) { Fail "$archive isn't listed in SHA256SUMS on $(Base-Host $sumsBase); nothing was installed." }
	$tried = Fetch-Verified $archive $expected $archiveFile "PrismaLens $Version for $target"
	if ($tried) { Fail "Couldn't install $archive from $(Hosts-Tried); nothing was installed. $tried" }

	$dest = Join-Path $runtimeRoot $Version
	# A pl.cmd or prismalens.cmd in the bin dir that this installer didn't write is someone's own: never replaced.
	foreach ($name in "pl", "prismalens") {
		$f = Join-Path $binDir "$name.cmd"
		if ((Test-Path -LiteralPath $f) -and -not (Select-String -LiteralPath $f -SimpleMatch $marker -Quiet)) {
			Fail "$f isn't a wrapper this installer wrote, so nothing was installed; it was left as it is. Set PRISMALENS_INSTALL_BIN_DIR to install pl somewhere else."
		}
	}
	Step "Installing to $dest"
	# Unpack beside $dest, not under %TEMP%: Windows PowerShell 5.1 can't reach paths of 260+
	# chars on a default box, and build-standalone-cli.yml holds the archive to that from here (#902).
	# System32's bsdtar, not a tar on PATH: Git's GNU tar can't read a zip.
	$unpacked = Join-Path $runtimeRoot ".new"
	$tar = Join-Path $env:SystemRoot "System32\tar.exe"
	if (-not (Test-Path $tar)) { Fail "$tar is missing (Windows 10 1803 and later ship it); use npm install -g prismalens" }
	try {
		if (-not (Remove-Owned $unpacked)) { throw "a file in it is open" }
		New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
		$out = & $tar -xf $archiveFile -C $unpacked --strip-components 1 2>&1
		if ($LASTEXITCODE -ne 0) { throw ($out | Out-String) }
	} catch {
		$why = "$_".Trim()
		[void](Remove-Owned $unpacked)
		if ($why -match 'too long|PathTooLong') { $why += " (a path in it is longer than Windows allows; set LongPathsEnabled or use npm install -g prismalens)" }
		Fail "Couldn't unpack $archive into ${unpacked}: $why"
	}
	if (-not (Test-Path (Join-Path $unpacked "bin\pl.cmd"))) { Fail "Unexpected archive layout" }
	try {
		if (-not (Remove-Owned $dest)) { throw "a file in it is open" }
		Move-Item -Path $unpacked -Destination $dest
	} catch {
		# Windows locks a running node.exe's files; Unix lets them be replaced.
		Fail "Couldn't replace $dest, most likely because PrismaLens $Version is running. Stop pl up and run the installer again."
	}

	New-Item -ItemType Directory -Path $binDir -Force | Out-Null
	# cmd reads a .cmd file in the console's code page, which can change after the install. Inside the
	# data root (the default) the wrapper finds the runtime from its own folder, so it holds no path.
	$cp = [Console]::OutputEncoding.CodePage
	$cmdEncoding = if ($cp -eq 65001) { New-Object Text.UTF8Encoding $false } else { [Text.Encoding]::GetEncoding($cp) }
	$binLong = Get-LongPath $binDir
	$rootLong = Get-LongPath $dataRoot
	$up = ""
	if ("$binLong\".StartsWith("$rootLong\", [StringComparison]::OrdinalIgnoreCase)) {
		$up = "..\" * @($binLong.Substring($rootLong.Length).Split("\", [StringSplitOptions]::RemoveEmptyEntries)).Count
	}
	foreach ($name in "pl", "prismalens") {
		$runtimeCmd = if ($up) { "%~dp0${up}runtime\$Version\bin\$name.cmd" } else { "$dest\bin\$name.cmd" }
		$text = "@echo off`r`n$marker`r`n`"$runtimeCmd`" %*`r`n"
		if ($cmdEncoding.GetString($cmdEncoding.GetBytes($text)) -ne $text) { Warn "$dest has characters cmd can't read in code page $cp, so $name may not start" }
		[IO.File]::WriteAllText((Join-Path $binDir "$name.cmd"), $text, $cmdEncoding)
	}

	# Keep this version and the one it replaced, for rollback.
	Get-ChildItem $runtimeRoot -Directory | Where-Object { $_.Name -ne $Version -and $_.Name -ne $installed } |
		ForEach-Object { [void](Remove-Owned $_.FullName) }

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

	# Written before the desktop step too, so a run that stops partway still records the app's ID.
	$writeReceipt = {
		$lines = @(
		"version=$Version",
		"channel=installer",
		"target=$target",
		"bin_dir=$binDir",
		"path_added=$pathAdded",
		"desktop=$desktop",
		"desktop_app=$desktopApp",
		"desktop_version=$desktopVersion",
		"desktop_app_id=$desktopAppId",
		"installed_at=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))"
	)
		# UTF-8 without a BOM, which the app and CLI read; renamed into place, so a short write or a link
		# at the receipt's path never leaves a half receipt or changes another file.
		[IO.File]::WriteAllText("$receipt.new", (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
		Move-Item -LiteralPath "$receipt.new" -Destination $receipt -Force }

	# The desktop app is the release's own zip, verified like the CLI; a failure here leaves the CLI installed.
	# desktop= is the user's choice; the app and shortcut uninstall removes are the ones in $desktopRoot.
	$desktop = if ($rec["desktop"]) { $rec["desktop"] } else { "" }
	# desktop_app names the copy this installer owns; the app reads it to tell it's the installer's.
	$desktopApp = if ($rec["desktop_app"]) { $rec["desktop_app"] } else { "" }
	$desktopVersion = if ($rec["desktop_version"]) { $rec["desktop_version"] } else { "" }
	$desktopAppId = if ($rec["desktop_app_id"]) { $rec["desktop_app_id"] } else { "" }
	$launcher = ""
	if ($NoDesktop -or $env:PRISMALENS_DESKTOP -eq "0") {
		$desktop = "0"
		$desktopApp = ""
		$desktopVersion = ""
		$desktopAppId = ""
	} elseif ($env:PRISMALENS_DESKTOP -eq "1") {
		$desktop = "1"
	}
	$skip = Get-DesktopSkip $rec
	if ($skip) {
		Step "Desktop app skipped: $skip"
	} else {
		$appSum = Get-Sum $sums $desktopAsset
		if (-not $appSum) {
			Warn "PrismaLens $Version has no desktop app for $target, so only the CLI was installed."
		} else {
			$appZip = Join-Path $staging $desktopAsset
			try {
				$why = Fetch-Verified $desktopAsset $appSum $appZip "the PrismaLens $Version desktop app"
				if ($why) { throw "couldn't download it from $(Hosts-Tried): $why" }
				$running = Get-DesktopProcesses | Where-Object { -not (Get-LongPath $_.Path).StartsWith("$(Get-LongPath (Join-Path $desktopRoot $Version))\", [StringComparison]::OrdinalIgnoreCase) }
				$installId = $ownId
				# Recorded first: a copy left by a failure or a crash after it's unpacked carries this ID.
				$desktopAppId = $installId
				& $writeReceipt
				$launcher = Install-Desktop $appZip $installId
				$desktop = "1"
				$desktopApp = Join-Path $desktopRoot "$Version\PrismaLens.exe"
				$desktopVersion = $Version
				Done "Desktop app installed to $(Join-Path $desktopRoot $Version)"
				if ($running) { Warn "An older PrismaLens app is still running; quit it and open it again for $Version." }
			} catch {
				Warn "The desktop app wasn't installed: $_. The CLI is; run the installer again for the app."
			}
		}
	}

	& $writeReceipt

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
	if ($launcher) {
		[Console]::Error.WriteLine("`n  Open the desktop app from the Start menu: ${bold}PrismaLens${r}   ${dim}($launcher)${r}")
		[Console]::Error.WriteLine("  ${dim}The app isn't code-signed yet. If Windows SmartScreen stops it, choose More info, then Run anyway.${r}")
		[Console]::Error.WriteLine("  ${dim}Smart App Control, where it is on, blocks unsigned apps with no override; use pl up in a browser there.${r}")
	}
	[Console]::Error.WriteLine("`n  Start it with ${bold}pl up${r}   ${middot}   Upgrade with ${bold}pl upgrade${r}   ${middot}   Docs: https://docs.prismalens.io`n")
} finally {
	[void](Remove-Owned $staging)
}
