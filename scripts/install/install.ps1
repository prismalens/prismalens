# PrismaLens standalone CLI installer for Windows (#717).
# Downloads and verifies the per-OS release archive; no Node required.
$ErrorActionPreference = "Stop"

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
	Write-Error "PrismaLens standalone installer does not support $env:PROCESSOR_ARCHITECTURE. Install via npm instead: npm install -g prismalens"
	exit 1
}

$target = "win32-x64"

function Download-File {
	param([string]$Url, [string]$OutFile)
	if ($Url.StartsWith("file://")) {
		$localPath = $Url.Substring(7)
		if ($localPath -match '^/([a-zA-Z]:/.*)') { $localPath = $matches[1] }
		$localPath = $localPath.Replace('/', '\')
		if (-not (Test-Path $localPath)) { return $false }
		Copy-Item -Path $localPath -Destination $OutFile -Force
		return $true
	}
	try {
		[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
		Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -ErrorAction Stop
		return $true
	} catch {
		return $false
	}
}

$version = $env:PRISMALENS_VERSION
if (-not $version) {
	$latestUrl = "https://api.github.com/repos/prismalens/prismalens/releases/latest"
	$tmpMeta = [System.IO.Path]::GetTempFileName()
	if (-not (Download-File -Url $latestUrl -OutFile $tmpMeta)) {
		Remove-Item $tmpMeta -Force -ErrorAction SilentlyContinue
		Write-Error "Could not fetch latest release info from GitHub API; set PRISMALENS_VERSION=<version>"
		exit 1
	}
	$metaContent = Get-Content $tmpMeta -Raw | ConvertFrom-Json
	Remove-Item $tmpMeta -Force -ErrorAction SilentlyContinue
	$version = $metaContent.tag_name -replace '^v', ''
	if (-not $version) {
		Write-Error "Could not determine latest version from GitHub API; set PRISMALENS_VERSION=<version>"
		exit 1
	}
}

$baseUrl = if ($env:PRISMALENS_RELEASE_BASE_URL) { $env:PRISMALENS_RELEASE_BASE_URL } else { "https://github.com/prismalens/prismalens/releases/download" }
$archive = "prismalens-$version-$target.zip"

$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("pl-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
	$sumsFile = Join-Path $staging "SHA256SUMS"
	$archiveFile = Join-Path $staging $archive
	$releaseUrl = ""

	if (Download-File -Url "$baseUrl/v$version/SHA256SUMS" -OutFile $sumsFile) {
		$releaseUrl = "$baseUrl/v$version"
	} elseif (Download-File -Url "$baseUrl/SHA256SUMS" -OutFile $sumsFile) {
		$releaseUrl = "$baseUrl"
	} else {
		Write-Error "PrismaLens $version has no release archive or SHA256SUMS at $baseUrl"
		exit 1
	}

	if (-not (Download-File -Url "$releaseUrl/$archive" -OutFile $archiveFile)) {
		Write-Error "Failed to download $archive from $releaseUrl"
		exit 1
	}

	$expected = ""
	foreach ($line in (Get-Content $sumsFile)) {
		$parts = $line.Trim() -split '\s+'
		if ($parts.Length -ge 2 -and ($parts[1] -eq $archive -or $parts[1] -eq "*$archive")) {
			$expected = $parts[0].ToLower()
			break
		}
	}
	if (-not $expected) {
		Write-Error "$archive is not listed in SHA256SUMS"
		exit 1
	}

	$actual = (Get-FileHash -Path $archiveFile -Algorithm SHA256).Hash.ToLower()
	if ($actual -ne $expected) {
		Write-Error "checksum mismatch for $archive`nExpected: $expected`nActual:   $actual"
		exit 1
	}

	Expand-Archive -Path $archiveFile -DestinationPath $staging -Force

	$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
	$runtimeDir = Join-Path $localAppData "prismalens\runtime\$version"
	if (Test-Path $runtimeDir) {
		Remove-Item $runtimeDir -Recurse -Force
	}
	New-Item -ItemType Directory -Path (Split-Path $runtimeDir -Parent) -Force | Out-Null
	Move-Item -Path (Join-Path $staging "prismalens-$version-$target") -Destination $runtimeDir -Force

	$binDir = if ($env:PRISMALENS_INSTALL_BIN_DIR) { $env:PRISMALENS_INSTALL_BIN_DIR } else { Join-Path $localAppData "prismalens\bin" }
	New-Item -ItemType Directory -Path $binDir -Force | Out-Null

	$plCmd = Join-Path $binDir "pl.cmd"
	$prismalensCmd = Join-Path $binDir "prismalens.cmd"

	$cmdContent = "@echo off`r`n`"$runtimeDir\bin\pl.cmd`" %*`r`n"
	$plPrismalensContent = "@echo off`r`n`"$runtimeDir\bin\prismalens.cmd`" %*`r`n"
	Set-Content -Path $plCmd -Value $cmdContent -Encoding ASCII
	Set-Content -Path $prismalensCmd -Value $plPrismalensContent -Encoding ASCII

	# Add bin dir to user PATH if missing
	$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
	$pathParts = if ($userPath) { $userPath -split ';' | Where-Object { $_ -ne '' } } else { @() }
	if ($pathParts -notcontains $binDir) {
		$newUserPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
		[Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
		$env:Path = "$env:Path;$binDir"
	}

	$currentPathParts = ($env:Path -split ';')
	if ($currentPathParts -notcontains $binDir) {
		Write-Host "Add $binDir to your PATH to run pl directly."
	}

	& "$plCmd" --version
	Write-Host "run pl up"
} finally {
	Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
