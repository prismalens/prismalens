# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel

# Runs install.ps1 under Windows PowerShell 5.1: Invoke-Pester scripts/install (Pester 5, #1224).

BeforeAll {
	if ($PSVersionTable.PSEdition -ne "Desktop") { throw "needs Windows PowerShell 5.1, not $($PSVersionTable.PSEdition)" }
	$installer = Join-Path $PSScriptRoot "install.ps1"
	$system32 = Join-Path $env:SystemRoot "System32"
	$version = "0.5.6"
	$archive = "prismalens-$version-win32-x64.zip"
	$appArchive = "PrismaLens-Windows-X64-unsigned.zip"
	$mirror = "https://downloads.prismalens.io"
	$github = "https://github.com/prismalens/prismalens/releases/download"

	# <Root>\v<version>\ holding an archive whose pl prints $Says, and its SHA256SUMS; -App adds the
	# desktop app's zip, win-unpacked\PrismaLens.exe as the release builds it.
	function New-Release([string]$Root, [string]$Says, [switch]$App) {
		$top = "prismalens-$version-win32-x64"
		$stage = Join-Path $Root "stage"
		New-Item -ItemType Directory -Path (Join-Path $stage "$top\bin") -Force | Out-Null
		foreach ($name in "pl", "prismalens") {
			Set-Content -Path (Join-Path $stage "$top\bin\$name.cmd") -Encoding ASCII -Value "@echo $Says"
		}
		$dir = Join-Path $Root "v$version"
		New-Item -ItemType Directory -Path $dir -Force | Out-Null
		$zip = Join-Path $dir $archive
		& (Join-Path $system32 "tar.exe") -a -cf $zip -C $stage $top
		if ($LASTEXITCODE -ne 0) { throw "tar could not build $zip" }
		$digest = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
		$lines = @("$digest  $archive")
		if ($App) {
			New-Item -ItemType Directory -Path (Join-Path $stage "win-unpacked") -Force | Out-Null
			Copy-Item (Join-Path $system32 "whoami.exe") (Join-Path $stage "win-unpacked\PrismaLens.exe")
			$appZip = Join-Path $dir $appArchive
			& (Join-Path $system32 "tar.exe") -a -cf $appZip -C $stage "win-unpacked"
			if ($LASTEXITCODE -ne 0) { throw "tar could not build $appZip" }
			$lines += "$((Get-FileHash -Path $appZip -Algorithm SHA256).Hash.ToLower())  $appArchive"
		}
		Set-Content -Path (Join-Path $dir "SHA256SUMS") -Encoding ASCII -Value $lines
	}

	# Answers GETs from $Root. A HEAD of the archive redirects, and the redirect's target never answers.
	function Start-StallingServer([string]$Root) {
		$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
		$listener.Start()
		$log = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))
		$server = [powershell]::Create()
		[void]$server.AddScript({
			param($listener, $root, $log)
			$held = @()
			while ($true) {
				$client = $listener.AcceptTcpClient()
				$stream = $client.GetStream()
				$reader = New-Object System.IO.StreamReader($stream)
				$first = $reader.ReadLine()
				if (-not $first) { $client.Close(); continue }
				while ($reader.ReadLine()) { }
				$method, $path = ($first -split ' ')[0, 1]
				[void]$log.Add("$method $path")
				if ($method -eq "HEAD" -and $path -eq "/stalled") { $held += $client; continue }
				$body = [byte[]]@()
				if ($method -eq "HEAD") {
					$head = "HTTP/1.1 302 Found`r`nLocation: /stalled`r`nContent-Length: 5242880000"
				} else {
					$body = [System.IO.File]::ReadAllBytes((Join-Path $root $path.TrimStart('/')))
					$head = "HTTP/1.1 200 OK`r`nContent-Length: $($body.Length)"
				}
				$bytes = [System.Text.Encoding]::ASCII.GetBytes("$head`r`nConnection: close`r`n`r`n")
				$stream.Write($bytes, 0, $bytes.Length)
				$stream.Write($body, 0, $body.Length)
				$client.Close()
			}
		}).AddArgument($listener).AddArgument($Root).AddArgument($log)
		[void]$server.BeginInvoke()
		@{ Url = "http://127.0.0.1:$($listener.LocalEndpoint.Port)"; Log = $log; Listener = $listener; Server = $server }
	}

	function Stop-StallingServer($s) {
		$s.Listener.Stop()
		$s.Server.Dispose()
	}

	# PowerShell that hides System32's curl.exe, which sends install.ps1 to Invoke-WebRequest.
	$hideCurl = @'
function global:Test-Path {
	if ("$args" -like '*\System32\curl.exe') { return $false }
	Microsoft.PowerShell.Management\Test-Path @args
}
'@

	# Runs install.ps1 in its own powershell.exe; $Setup is PowerShell run there first.
	function Invoke-Installer([string]$Work, [string]$BaseUrl, [string]$Setup = "", [string]$Arguments = "") {
		$wrapper = Join-Path $Work "run.ps1"
		Set-Content -Path $wrapper -Encoding UTF8 -Value @"
`$ErrorActionPreference = 'Stop'
`$env:PRISMALENS_RELEASE_BASE_URL = '$BaseUrl'
`$env:PRISMALENS_VERSION = '$version'
`$env:PRISMALENS_HOME = '$Work\data'
`$env:PRISMALENS_INSTALL_BIN_DIR = '$Work\bin'
`$env:PRISMALENS_NO_MODIFY_PATH = '1'
`$env:PRISMALENS_ALLOW_DOWNGRADE = ''
`$env:http_proxy = ''
`$env:CI = '1'
`$env:PRISMALENS_DESKTOP = ''
`$env:PRISMALENS_SHORTCUT_DIR = '$Work\Programs'
`$env:Path = '$system32'
$Setup
& '$installer' $Arguments
"@
		$err = Join-Path $Work "stderr.txt"
		$p = Start-Process -FilePath (Join-Path $system32 "WindowsPowerShell\v1.0\powershell.exe") `
			-ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$wrapper`"" `
			-RedirectStandardError $err -RedirectStandardOutput (Join-Path $Work "stdout.txt") -NoNewWindow -PassThru
		$null = $p.Handle
		# A size request with no time limit is still waiting here.
		if (-not $p.WaitForExit(60000)) {
			& (Join-Path $system32 "taskkill.exe") /T /F /PID $p.Id | Out-Null
			throw "install.ps1 was still running after 60 s: $(Get-Content $err -Raw)"
		}
		$stderr = [string](Get-Content $err -Raw -Encoding UTF8)
		$pl = Join-Path $Work "bin\pl.cmd"
		@{
			ExitCode = $p.ExitCode
			Stderr = $stderr
			Downloads = @([regex]::Matches($stderr, 'Downloading PrismaLens [^\r\n]*') | ForEach-Object { $_.Value })
			Installed = if (Test-Path $pl) { [string](& $pl --version) } else { $null }
		}
	}

	# Serves the default bases from $Work\mirror and $Work\github, logging each request.
	function Get-FakeWebSetup([string]$Work, [switch]$BreakMirrorArchive) {
		$break = if ($BreakMirrorArchive) { '$true' } else { '$false' }
		@"
$hideCurl
function global:Invoke-WebRequest {
	param(`$Uri, `$OutFile, `$Method, `$TimeoutSec, `$Headers, [switch]`$UseBasicParsing)
	if (`$Method -eq 'Head') { throw 'The operation has timed out.' }
	Add-Content -Path '$Work\requests.log' -Value `$Uri
	if ($break -and `$Uri -like '$mirror/*.zip') { throw 'The connection was closed.' }
	if (`$Uri -like '$mirror/*') { `$from = '$Work\mirror' + `$Uri.Substring($($mirror.Length)) }
	elseif (`$Uri -like '$github/*') { `$from = '$Work\github' + `$Uri.Substring($($github.Length)) }
	else { throw "unexpected request: `$Uri" }
	Copy-Item -Path `$from.Replace('/', '\') -Destination `$OutFile
}
"@
	}
}

Describe "Get-Size with curl.exe" {
	BeforeAll {
		$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$null, [ref]$null)
		$definition = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Get-Size" }, $true)
		. ([scriptblock]::Create($definition.Extent.Text))
		function Get-SizeWhenCurlExits([int]$Code) {
			$curl = Join-Path $TestDrive "curl-$Code.cmd"
			Set-Content -Path $curl -Encoding ASCII -Value "@echo off", "echo HTTP/1.1 302 Found", "echo Content-Length: 5242880000", "exit /b $Code"
			Get-Size "https://mirror.invalid/$archive"
		}
	}

	It "returns 5242880000 from those headers when curl completes" {
		Get-SizeWhenCurlExits 0 | Should -Be 5242880000
	}

	It "returns null from the same headers when curl times out (exit 28)" {
		Get-SizeWhenCurlExits 28 | Should -Be $null
	}
}

Describe "install.ps1 when the size request never finishes" {
	BeforeEach {
		$work = Join-Path $TestDrive ([guid]::NewGuid().ToString("N"))
		New-Release (Join-Path $work "release") "genuine"
		$server = Start-StallingServer (Join-Path $work "release")
	}
	AfterEach { Stop-StallingServer $server }

	It "after a redirect: curl.exe prints no size, then downloads and installs the archive" {
		$run = Invoke-Installer $work $server.Url

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Downloads | Should -BeExactly "Downloading PrismaLens $version for win32-x64 from 127.0.0.1"
		$run.Installed | Should -BeExactly "genuine"
		$server.Log | Should -BeExactly @(
			"GET /v$version/SHA256SUMS",
			"HEAD /v$version/$archive",
			"HEAD /stalled",
			"GET /v$version/$archive"
		)
	}

	It "without curl.exe: Invoke-WebRequest times out, prints no size, then downloads and installs the archive" {
		$run = Invoke-Installer $work $server.Url $hideCurl

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Downloads | Should -BeExactly "Downloading PrismaLens $version for win32-x64 from 127.0.0.1"
		$run.Installed | Should -BeExactly "genuine"
		$server.Log | Should -BeExactly @(
			"GET /v$version/SHA256SUMS",
			"HEAD /v$version/$archive",
			"HEAD /stalled",
			"GET /v$version/$archive"
		)
	}
}

Describe "install.ps1 with the default bases" {
	BeforeEach {
		$work = Join-Path $TestDrive ([guid]::NewGuid().ToString("N"))
		New-Release (Join-Path $work "github") "genuine"
		New-Release (Join-Path $work "mirror") "altered"
		$requests = @(
			"$github/v$version/SHA256SUMS",
			"$mirror/v$version/$archive",
			"$github/v$version/$archive"
		)
	}

	It "refuses the mirror's altered archive by GitHub's SHA256SUMS and installs GitHub's" {
		$run = Invoke-Installer $work "" (Get-FakeWebSetup $work)

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
		Get-Content (Join-Path $work "requests.log") | Should -BeExactly $requests
	}

	It "falls back to GitHub when the mirror's download fails" {
		$run = Invoke-Installer $work "" (Get-FakeWebSetup $work -BreakMirrorArchive)

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Downloads | Should -BeExactly @(
			"Downloading PrismaLens $version for win32-x64 from downloads.prismalens.io",
			"Downloading PrismaLens $version for win32-x64 from github.com"
		)
		$run.Installed | Should -BeExactly "genuine"
		Get-Content (Join-Path $work "requests.log") | Should -BeExactly $requests
	}
}

Describe "install.ps1 and the desktop app" {
	BeforeEach {
		$work = Join-Path $TestDrive ([guid]::NewGuid().ToString("N"))
		New-Release (Join-Path $work "release") "genuine" -App
		$base = "file:///" + (Join-Path $work "release").Replace('\', '/')
		$lnk = Join-Path $work "Programs\PrismaLens.lnk"
		$app = Join-Path $work "data\desktop\$version\PrismaLens.exe"
		$want = "`$env:PRISMALENS_DESKTOP = '1'"
		function Get-Target([string]$Path) { (New-Object -ComObject WScript.Shell).CreateShortcut($Path).TargetPath }
		function Get-Receipt { Get-Content (Join-Path $work "data\receipt") }
	}

	It "installs the app beside the CLI, points a Start menu shortcut with its icon at it, and says where" {
		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
		Test-Path $app | Should -BeTrue
		Get-Target $lnk | Should -BeExactly $app
		(New-Object -ComObject WScript.Shell).CreateShortcut($lnk).IconLocation | Should -BeExactly "$app,0"
		$run.Stderr | Should -Match ([regex]::Escape("Open the desktop app from the Start menu: PrismaLens   ($lnk)"))
		$run.Stderr | Should -Match "If Windows SmartScreen stops it, choose More info, then Run anyway"
		Get-Receipt | Should -Contain "desktop=1"
	}

	It "skips the app by itself in CI, and installs the CLI" {
		$run = Invoke-Installer $work $base

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
		$run.Stderr | Should -Match "Desktop app skipped: this is CI"
		Test-Path $lnk | Should -BeFalse
		Test-Path (Join-Path $work "data\desktop") | Should -BeFalse
	}

	It "-NoDesktop leaves the app out, and a later install keeps it out until PRISMALENS_DESKTOP=1" {
		$run = Invoke-Installer $work $base "" "-NoDesktop"
		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match "Desktop app skipped: you asked for the CLI only"
		Get-Receipt | Should -Contain "desktop=0"

		$again = Invoke-Installer $work $base "`$env:CI = ''"
		$again.Stderr | Should -Match "Desktop app skipped: an earlier install left it out; set PRISMALENS_DESKTOP=1 to add it"
		Test-Path $lnk | Should -BeFalse

		$added = Invoke-Installer $work $base $want
		$added.ExitCode | Should -Be 0 -Because $added.Stderr
		Get-Target $lnk | Should -BeExactly $app
		Get-Receipt | Should -Contain "desktop=1"
	}

	It "repoints another copy's shortcut at this install and names the copy it left" {
		$other = Join-Path $work "Downloads\win-unpacked\PrismaLens.exe"
		New-Item -ItemType Directory -Path (Split-Path $other), (Join-Path $work "Programs") -Force | Out-Null
		Copy-Item (Join-Path $system32 "whoami.exe") $other
		$link = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
		$link.TargetPath = $other
		$link.Save()

		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		Get-Target $lnk | Should -BeExactly $app
		$run.Stderr | Should -Match ([regex]::Escape("The Start menu shortcut opened $other; it now opens this install."))
	}

	It "uninstall removes the shortcut and the app, and leaves another copy's shortcut" {
		(Invoke-Installer $work $base $want).ExitCode | Should -Be 0
		$run = Invoke-Installer $work $base "" "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("Removed the Start menu shortcut $lnk"))
		Test-Path $lnk | Should -BeFalse
		Test-Path (Join-Path $work "data") | Should -BeFalse

		$whoami = Join-Path $system32 "whoami.exe"
		$link = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
		$link.TargetPath = $whoami
		$link.Save()
		(Invoke-Installer $work $base "" "-Uninstall").ExitCode | Should -Be 0
		Get-Target $lnk | Should -Be $whoami
	}

	It "installs the CLI and says so when the release has no app for Windows" {
		$sums = Join-Path $work "release\v$version\SHA256SUMS"
		Set-Content -Path $sums -Encoding ASCII -Value (Get-Content $sums | Where-Object { $_ -notmatch $appArchive })

		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
		$run.Stderr | Should -Match "PrismaLens $version has no desktop app for win32-x64, so only the CLI was installed."
		Test-Path $lnk | Should -BeFalse
	}
}
