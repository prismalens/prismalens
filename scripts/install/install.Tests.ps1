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

	It "installs the app beside the CLI, points a Start menu shortcut with its icon at it, says where, and records it" {
		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
		Test-Path $app | Should -BeTrue
		Get-Target $lnk | Should -BeExactly $app
		(New-Object -ComObject WScript.Shell).CreateShortcut($lnk).IconLocation | Should -BeExactly "$app,0"
		$run.Stderr | Should -Match ([regex]::Escape("Open the desktop app from the Start menu: PrismaLens   ($lnk)"))
		$run.Stderr | Should -Match "If Windows SmartScreen stops it, choose More info, then Run anyway"
		Get-Receipt | Should -Contain "desktop=1"
		Get-Receipt | Should -Contain "desktop_app=$app"
		Get-Receipt | Should -Contain "desktop_version=$version"
	}

	It "keeps its own shortcut when PRISMALENS_HOME is given as an 8.3 short path" {
		$short = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($work).ShortPath
		if ($short -eq $work) { Set-ItResult -Skipped -Because "8.3 names are off on this volume, so $work has no short form" }
		$null = Invoke-Installer $work $base $want
		$run = Invoke-Installer $work $base "$want`n`$env:PRISMALENS_HOME = '$short\data'"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Not -Match "Desktop app skipped"
		$run.Stderr | Should -Match ([regex]::Escape("Open the desktop app from the Start menu: PrismaLens   ($lnk)"))
		Get-Target $lnk | Should -BeExactly $app
	}

	It "-NoDesktop while the app runs refuses before changing anything" {
		$null = Invoke-Installer $work $base $want
		Copy-Item (Join-Path $system32 "PING.EXE") $app -Force
		$running = Start-Process -FilePath $app -ArgumentList "-n", "60", "127.0.0.1" -WindowStyle Hidden -PassThru
		try {
			$receiptBefore = Get-Content (Join-Path $work "data\receipt") -Raw
			$wrapperBefore = Get-Content (Join-Path $work "bin\pl.cmd") -Raw
			# A rerun of the same version would unpack this runtime again; the marker shows whether it did.
			Set-Content -Path (Join-Path $work "data\runtime\$version\bin\pl.cmd") -Encoding ASCII -Value "@echo before"
			$runtimeBefore = Get-Content (Join-Path $work "data\runtime\$version\bin\pl.cmd") -Raw
			$run = Invoke-Installer $work $base "" "-NoDesktop"

			$run.ExitCode | Should -Not -Be 0
			$run.Stderr | Should -Match "The PrismaLens app is running; quit it \(tray icon, then Quit\) and run this again to leave it out. Nothing was changed."
			$run.Stderr | Should -Not -Match "Downloading"
			Get-Content (Join-Path $work "data\receipt") -Raw | Should -BeExactly $receiptBefore
			Get-Content (Join-Path $work "bin\pl.cmd") -Raw | Should -BeExactly $wrapperBefore
			Get-Content (Join-Path $work "data\runtime\$version\bin\pl.cmd") -Raw | Should -BeExactly $runtimeBefore
			Get-Target $lnk | Should -BeExactly $app
		} finally {
			Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue
		}
	}

	It "a reinstall whose new copy can't be moved into place keeps the working copy and its shortcut" {
		$null = Invoke-Installer $work $base $want
		Set-Content -Path (Join-Path (Split-Path $app) "marker.txt") -Value "the working copy"
		$run = Invoke-Installer $work $base "$want`n`$env:PRISMALENS_TEST_FAIL_DESKTOP_MOVE = '1'"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match "The desktop app wasn't installed: couldn't move it into place: the test made the move fail"
		Get-Content (Join-Path (Split-Path $app) "marker.txt") | Should -BeExactly "the working copy"
		Test-Path $app | Should -BeTrue
		Get-Target $lnk | Should -BeExactly $app
		@(Get-ChildItem (Join-Path $work "data\desktop") -Directory | ForEach-Object Name) | Should -BeExactly @($version)
	}

	It "uninstall that can't remove the app leaves pl and the shortcut as they were" {
		$null = Invoke-Installer $work $base $want
		$held = [System.IO.File]::Open($app, "Open", "Read", "Read")
		try {
			$run = Invoke-Installer $work $base "" "-Uninstall"

			$run.ExitCode | Should -Not -Be 0
			$run.Stderr | Should -Match ([regex]::Escape("Couldn't remove the desktop app in $(Join-Path $work 'data\desktop'): a file in it is open. Nothing was removed."))
			Test-Path (Join-Path $work "bin\pl.cmd") | Should -BeTrue
			Get-Target $lnk | Should -BeExactly $app
		} finally {
			$held.Dispose()
		}
	}

	It "a folder someone else put at desktop\<version>: a reinstall and uninstall leave it where it is, and say so" {
		$null = Invoke-Installer $work $base $want
		$theirs = Split-Path $app
		Remove-Item -LiteralPath (Join-Path $theirs ".prismalens-install-id")
		Set-Content -Path (Join-Path $theirs "marker.txt") -Value "theirs"
		# Without a shortcut to it, so the folder's own check is what stops the install.
		Remove-Item -LiteralPath $lnk
		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("The desktop app wasn't installed: $theirs isn't the app this installer put there; it was left as it is"))
		Get-Content (Join-Path $theirs "marker.txt") | Should -BeExactly "theirs"

		$run = Invoke-Installer $work $base "" "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("$theirs isn't the app this installer put there; it and the folders that hold it were left as they are"))
		$run.Stderr | Should -Match ([regex]::Escape("$(Join-Path $work 'data') stays, holding only what this installer didn't put there"))
		Get-Content (Join-Path $theirs "marker.txt") | Should -BeExactly "theirs"
		Test-Path (Join-Path $work "data\receipt") | Should -BeFalse
		Test-Path (Join-Path $work "data\runtime") | Should -BeFalse
	}

	It "an older version's folder the installer didn't make is left where it is when it prunes" {
		$theirs = Join-Path $work "data\desktop\0.0.1"
		New-Item -ItemType Directory -Path $theirs -Force | Out-Null
		Set-Content -Path (Join-Path $theirs "marker.txt") -Value "theirs"
		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("$theirs isn't the app this installer put there; it and the folders that hold it were left as they are"))
		Get-Content (Join-Path $theirs "marker.txt") | Should -BeExactly "theirs"
		Test-Path $app | Should -BeTrue
	}

	It "a user's shortcut to a folder in desktop\ the installer didn't make: left through install and uninstall" {
		$null = Invoke-Installer $work $base $want
		$mine = Join-Path $work "data\desktop\mine\PrismaLens.exe"
		New-Item -ItemType Directory -Path (Split-Path $mine) -Force | Out-Null
		Copy-Item (Join-Path $system32 "whoami.exe") $mine
		$l = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
		$l.TargetPath = $mine
		$l.Save()
		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("Desktop app skipped: the Start menu's PrismaLens shortcut opens $mine, which isn't this installer's; it was left as it is"))
		Get-Target $lnk | Should -BeExactly $mine

		$run = Invoke-Installer $work $base "" "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		Get-Target $lnk | Should -BeExactly $mine
		$run.Stderr | Should -Not -Match "Removed the Start menu shortcut"
	}

	It "a first install stopped after it unpacked the app: the next run deletes that copy as its own" {
		# Ends the process where the unpacked app moves into place, as a crash or a closed window would.
		$crash = @"
function global:Move-Item {
	if ("`$args" -like '*\desktop\$version*') { [Environment]::Exit(3) }
	Microsoft.PowerShell.Management\Move-Item @args
}
"@
		$run = Invoke-Installer $work $base "$want`n$crash"
		$run.ExitCode | Should -Be 3 -Because $run.Stderr
		@(Get-ChildItem (Join-Path $work "data\desktop") -Directory -Filter ".new-*").Count | Should -Be 1

		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Not -Match "isn't the app this installer put there"
		@(Get-ChildItem (Join-Path $work "data\desktop") -Directory -Force | ForEach-Object Name) | Should -BeExactly @($version)
		Get-Target $lnk | Should -BeExactly $app
	}

	It "a reinstall stopped between its two renames: a rerun with no downloads puts the installed copy back" {
		$null = Invoke-Installer $work $base $want
		$crash = @"
function global:Move-Item {
	if ("`$args" -like '*\desktop\$version*') { [Environment]::Exit(3) }
	Microsoft.PowerShell.Management\Move-Item @args
}
"@
		$run = Invoke-Installer $work $base "$want`n$crash"
		$run.ExitCode | Should -Be 3 -Because $run.Stderr
		Test-Path $app | Should -BeFalse

		$run = Invoke-Installer $work ("file:///" + (Join-Path $work "none").Replace('\', '/')) $want

		$run.Stderr | Should -Match "Put back the desktop app an interrupted install had moved aside"
		Test-Path $app | Should -BeTrue
		Get-Target $lnk | Should -BeExactly $app
	}

	It "a copy of the installer's app elsewhere in desktop\, ID and all, is left by uninstall" {
		$null = Invoke-Installer $work $base $want
		$copy = Join-Path $work "data\desktop\mine"
		Copy-Item -LiteralPath (Split-Path $app) -Destination $copy -Recurse
		$run = Invoke-Installer $work $base "" "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("$copy isn't the app this installer put there; it and the folders that hold it were left as they are"))
		Test-Path (Join-Path $copy "PrismaLens.exe") | Should -BeTrue
		Test-Path $app | Should -BeFalse
	}

	It "keeps a Unicode data root whole in the receipt and the pl wrappers" {
		$jose = Join-Path $work ("Jos" + [char]0xE9)
		$run = Invoke-Installer $work $base "$want`n`$env:PRISMALENS_HOME = '$jose\data'"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
		$text = [IO.File]::ReadAllText((Join-Path $jose "data\receipt"), [Text.Encoding]::UTF8)
		$text | Should -Match ([regex]::Escape("desktop_app=$jose\data\desktop\$version\PrismaLens.exe"))

		# The default bin dir, inside the data root.
		$run = Invoke-Installer $work $base "`$env:PRISMALENS_HOME = '$jose\data'`n`$env:PRISMALENS_INSTALL_BIN_DIR = ''"
		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		[string](& (Join-Path $jose "data\bin\pl.cmd") --version) | Should -BeExactly "genuine"
	}

	It "-NoDesktop that can't remove the app changes nothing, the CLI included, and says so" {
		$null = Invoke-Installer $work $base $want
		Set-Content -Path (Join-Path $work "data\runtime\$version\bin\pl.cmd") -Encoding ASCII -Value "@echo before"
		$runtimeBefore = Get-Content (Join-Path $work "data\runtime\$version\bin\pl.cmd") -Raw
		$receiptBefore = Get-Content (Join-Path $work "data\receipt") -Raw
		$held = [System.IO.File]::Open($app, "Open", "Read", "Read")
		try {
			$run = Invoke-Installer $work $base "" "-NoDesktop"

			$run.ExitCode | Should -Not -Be 0
			$run.Stderr | Should -Match ([regex]::Escape("Couldn't remove the desktop app in $(Join-Path $work 'data\desktop'): a file in it is open. Nothing was removed."))
			Get-Content (Join-Path $work "data\runtime\$version\bin\pl.cmd") -Raw | Should -BeExactly $runtimeBefore
			Get-Content (Join-Path $work "data\receipt") -Raw | Should -BeExactly $receiptBefore
			Get-Target $lnk | Should -BeExactly $app
		} finally {
			$held.Dispose()
		}
	}

	It "uninstall stopped by a <Kind> it can't delete keeps what's left as the installer's, with pl and the shortcut, and a rerun removes it" -ForEach @(@{ Kind = "file" }, @{ Kind = "folder" }) {
		$null = Invoke-Installer $work $base $want
		$stuck = Join-Path (Split-Path $app) "stuck-$Kind"
		if ($Kind -eq "file") { Set-Content -Path $stuck -Value "stuck" } else { New-Item -ItemType Directory -Path $stuck | Out-Null }
		$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
		& (Join-Path $system32 "icacls.exe") $stuck /deny "${me}:(D)" | Out-Null
		try {
			$run = Invoke-Installer $work $base "" "-Uninstall"

			$run.ExitCode | Should -Not -Be 0
			$run.Stderr | Should -Match ([regex]::Escape("Couldn't remove all of the desktop app; what's left is in $(Join-Path $work 'data\desktop'). Nothing else was removed."))
			Test-Path (Join-Path $work "bin\pl.cmd") | Should -BeTrue
			Test-Path $lnk | Should -BeTrue
		} finally {
			Get-ChildItem (Join-Path $work "data") -Recurse -Force -Filter "stuck-*" | ForEach-Object { & (Join-Path $system32 "icacls.exe") $_.FullName /remove:d $me | Out-Null }
		}
		$run = Invoke-Installer $work $base "" "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Not -Match "isn't the app this installer put there"
		Test-Path $lnk | Should -BeFalse
		Test-Path (Join-Path $work "data") | Should -BeFalse
	}

	It "uninstall waits for a file the app's last process holds for a moment after it quits" {
		$null = Invoke-Installer $work $base $want
		$ready = Join-Path $work "held"
		$holder = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command",
			"`$f = [IO.File]::Open('$app', 'Open', 'Read', 'Read'); Set-Content '$ready' x; Start-Sleep -Milliseconds 1500; `$f.Dispose()"
		while (-not (Test-Path $ready) -and -not $holder.HasExited) { Start-Sleep -Milliseconds 50 }
		$run = Invoke-Installer $work $base "" "-Uninstall"
		$holder.WaitForExit()

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		Test-Path (Join-Path $work "data") | Should -BeFalse
		Test-Path $lnk | Should -BeFalse
	}

	It "uninstall leaves a data root without its receipt, and one that holds the workspace" {
		$stuff = Join-Path $work "stuff"
		New-Item -ItemType Directory -Path $stuff -Force | Out-Null
		Set-Content -Path (Join-Path $stuff "notes.txt") -Value "theirs"
		$run = Invoke-Installer $work $base "`$env:PRISMALENS_HOME = '$stuff'" "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("$stuff holds no receipt from this installer, so it was left as it is"))
		Get-Content (Join-Path $stuff "notes.txt") | Should -BeExactly "theirs"

		$ws = Join-Path $work "ws"
		$both = "`$env:PRISMALENS_HOME = '$ws'`n`$env:PRISMALENS_WORKSPACE_DIR = '$ws'"
		$null = Invoke-Installer $work $base $both
		Set-Content -Path (Join-Path $ws "prismalens.db") -Value "db"
		$run = Invoke-Installer $work $base $both "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("Your workspace is inside $ws, so $ws was left as it is"))
		Get-Content (Join-Path $ws "prismalens.db") | Should -BeExactly "db"
	}

	It "a data root given with a trailing backslash: uninstall leaves a folder it didn't make where it is" {
		$slash = "$want`n`$env:PRISMALENS_HOME = '$work\data\'"
		$null = Invoke-Installer $work $base $slash
		$theirs = Split-Path $app
		Remove-Item -LiteralPath (Join-Path $theirs ".prismalens-install-id")
		Set-Content -Path (Join-Path $theirs "marker.txt") -Value "theirs"
		$run = Invoke-Installer $work $base "`$env:PRISMALENS_HOME = '$work\data\'" "-Uninstall"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		Get-Content (Join-Path $theirs "marker.txt") | Should -BeExactly "theirs"
		$run.Stderr | Should -Match ([regex]::Escape("$theirs isn't the app this installer put there; it and the folders that hold it were left as they are"))
		Test-Path (Join-Path $work "data\receipt") | Should -BeFalse
	}

	It "a folder that appears where the new copy goes: nothing nested in it, and the old copy kept" {
		$null = Invoke-Installer $work $base $want
		$dest = Split-Path $app
		$appear = @"
function global:Move-Item {
	if (("`$args" -like '*\desktop\.new-*') -and ("`$args" -like '*\desktop\$version *')) { New-Item -ItemType Directory -Path '$dest' -Force | Out-Null }
	Microsoft.PowerShell.Management\Move-Item @args
}
"@
		$run = Invoke-Installer $work $base "$want`n$appear"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("The desktop app wasn't installed: couldn't move it into place (something else appeared at $dest during the install), nor put the old copy back; it is in $dest.old-"))
		@(Get-ChildItem -LiteralPath $dest -Force).Count | Should -Be 0
		@(Get-ChildItem (Join-Path $work "data\desktop") -Directory -Filter "$version.old-*" | Where-Object { Test-Path (Join-Path $_.FullName "PrismaLens.exe") }).Count | Should -Be 1
	}

	It "a pl.cmd in the bin dir the installer didn't write is left byte for byte, and nothing is installed" {
		New-Item -ItemType Directory -Path (Join-Path $work "bin") -Force | Out-Null
		Set-Content -Path (Join-Path $work "bin\pl.cmd") -Encoding ASCII -Value "@echo users own"
		$before = Get-Content (Join-Path $work "bin\pl.cmd") -Raw
		$run = Invoke-Installer $work $base ""

		$run.ExitCode | Should -Not -Be 0
		$run.Stderr | Should -Match ([regex]::Escape("$(Join-Path $work 'bin\pl.cmd') isn't a wrapper this installer wrote, so nothing was installed; it was left as it is."))
		Get-Content (Join-Path $work "bin\pl.cmd") -Raw | Should -BeExactly $before
		Test-Path (Join-Path $work "data\runtime\$version") | Should -BeFalse
	}

	It "an install while another installer holds the lock changes nothing" {
		$held = [System.IO.File]::Open("$work\data.install-lock", "OpenOrCreate", "ReadWrite", "None")
		try {
			$run = Invoke-Installer $work $base ""

			$run.ExitCode | Should -Not -Be 0
			$run.Stderr | Should -Match ([regex]::Escape("Another PrismaLens installer is running, or $work\data.install-lock can't be opened; run this again once it finishes. Nothing was changed."))
			Test-Path (Join-Path $work "data\runtime") | Should -BeFalse
			Test-Path (Join-Path $work "bin\pl.cmd") | Should -BeFalse
		} finally {
			$held.Dispose()
		}
		$run = Invoke-Installer $work $base ""
		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
	}

	It "a run that finished or failed lets go of the lock, so another in the same PowerShell session, as irm | iex runs it, goes ahead" {
		$none = "file:///" + (Join-Path $work "none").Replace('\', '/')
		$failedFirst = "`$env:PRISMALENS_RELEASE_BASE_URL = '$none'; try { & '$installer' } catch {}; `$env:PRISMALENS_RELEASE_BASE_URL = '$base'"
		$run = Invoke-Installer $work $base $failedFirst
		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"

		$run = Invoke-Installer $work $base "& '$installer'" "-Uninstall"
		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		Test-Path (Join-Path $work "data") | Should -BeFalse
		Test-Path "$work\data.install-lock" | Should -BeFalse
	}

	It "an app download that throws still records the CLI it installed" {
		$zip = Join-Path $work "release\v$version\PrismaLens-Windows-X64-unsigned.zip"
		$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
		& (Join-Path $system32 "icacls.exe") $zip /deny "${me}:(R)" | Out-Null
		try {
			$run = Invoke-Installer $work $base $want

			$run.ExitCode | Should -Be 0 -Because $run.Stderr
			$run.Stderr | Should -Match "The desktop app wasn't installed: "
			Get-Receipt | Should -Contain "version=$version"
			Get-Receipt | Should -Contain "desktop_app="
			Test-Path (Join-Path $work "bin\pl.cmd") | Should -BeTrue
		} finally {
			& (Join-Path $system32 "icacls.exe") $zip /remove:d $me | Out-Null
		}
	}

	It "a shortcut another copy saves while the app downloads: left when its app exists, replaced when it doesn't" {
		$other = Join-Path $system32 "whoami.exe"
		# The installer fetches a file:// release with Copy-Item; this one saves the shortcut first.
		$during = {
			param([string]$Target)
			@"
function global:Copy-Item {
	if ("`$args" -like '*PrismaLens-Windows-X64-unsigned.zip*') {
		New-Item -ItemType Directory -Path '$work\Programs' -Force | Out-Null
		`$l = (New-Object -ComObject WScript.Shell).CreateShortcut('$lnk')
		`$l.TargetPath = '$Target'
		`$l.Save()
	}
	Microsoft.PowerShell.Management\Copy-Item @args
}
"@
		}
		$run = Invoke-Installer $work $base "$want`n$(& $during $other)"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("The desktop app wasn't installed: the Start menu's PrismaLens shortcut now opens $other, which isn't this installer's; it was left as it is"))
		Get-Target $lnk | Should -Be $other

		Remove-Item $lnk
		$gone = Join-Path $work "gone\PrismaLens.exe"
		$run = Invoke-Installer $work $base "$want`n$(& $during $gone)"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match ([regex]::Escape("Replaced the Start menu shortcut to $gone, which no longer exists."))
		Get-Target $lnk | Should -BeExactly $app
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

	It "leaves a Start menu shortcut to another working copy alone, and installs the CLI" {
		$other = Join-Path $work "Downloads\win-unpacked\PrismaLens.exe"
		New-Item -ItemType Directory -Path (Split-Path $other), (Join-Path $work "Programs") -Force | Out-Null
		Copy-Item (Join-Path $system32 "whoami.exe") $other
		$link = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
		$link.TargetPath = $other
		$link.Save()

		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Installed | Should -BeExactly "genuine"
		Get-Target $lnk | Should -Be $other
		$run.Stderr | Should -Match ([regex]::Escape("Desktop app skipped: the Start menu's PrismaLens shortcut opens $other, which isn't this installer's; it was left as it is"))
		Test-Path (Join-Path $work "data\desktop") | Should -BeFalse
	}

	It "replaces a shortcut whose app no longer exists, and says which" {
		$gone = Join-Path $work "Downloads\gone\PrismaLens.exe"
		New-Item -ItemType Directory -Path (Join-Path $work "Programs") -Force | Out-Null
		$link = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
		$link.TargetPath = $gone
		$link.Save()

		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		Get-Target $lnk | Should -BeExactly $app
		$run.Stderr | Should -Match ([regex]::Escape("Replaced the Start menu shortcut to $gone, which no longer exists."))
	}

	It "leaves the app to Scoop when Scoop's prismalens-app is installed" {
		$scoopApp = Join-Path $work "scoop\apps\prismalens-app\current\PrismaLens.exe"
		New-Item -ItemType Directory -Path (Split-Path $scoopApp), (Join-Path $work "Programs\Scoop Apps") -Force | Out-Null
		Copy-Item (Join-Path $system32 "whoami.exe") $scoopApp
		$link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $work "Programs\Scoop Apps\PrismaLens.lnk"))
		$link.TargetPath = $scoopApp
		$link.Save()

		$run = Invoke-Installer $work $base $want

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match "Desktop app skipped: Scoop's prismalens-app is installed; it upgrades with scoop update"
		Test-Path $lnk | Should -BeFalse
		Test-Path (Join-Path $work "data\desktop") | Should -BeFalse
	}

	It "-NoDesktop after an install removes the app and its shortcut, even with PRISMALENS_DESKTOP=1 set" {
		(Invoke-Installer $work $base $want).ExitCode | Should -Be 0
		Test-Path $lnk | Should -BeTrue

		$run = Invoke-Installer $work $base $want "-NoDesktop"

		$run.ExitCode | Should -Be 0 -Because $run.Stderr
		$run.Stderr | Should -Match "Desktop app skipped: you asked for the CLI only"
		Test-Path $lnk | Should -BeFalse
		Test-Path (Join-Path $work "data\desktop") | Should -BeFalse
		Get-Receipt | Should -Contain "desktop=0"
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
