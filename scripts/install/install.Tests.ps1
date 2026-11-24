# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel

# Runs install.ps1 under Windows PowerShell 5.1: Invoke-Pester scripts/install (Pester 5, #1224).

BeforeAll {
	if ($PSVersionTable.PSEdition -ne "Desktop") { throw "needs Windows PowerShell 5.1, not $($PSVersionTable.PSEdition)" }
	$installer = Join-Path $PSScriptRoot "install.ps1"
	$system32 = Join-Path $env:SystemRoot "System32"
	$version = "0.5.6"
	$archive = "prismalens-$version-win32-x64.zip"
	$mirror = "https://downloads.prismalens.io"
	$github = "https://github.com/prismalens/prismalens/releases/download"

	# <Root>\v<version>\ holding an archive whose pl prints $Says, and its SHA256SUMS.
	function New-Release([string]$Root, [string]$Says) {
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
		Set-Content -Path (Join-Path $dir "SHA256SUMS") -Encoding ASCII -Value "$digest  $archive"
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
	function Invoke-Installer([string]$Work, [string]$BaseUrl, [string]$Setup = "") {
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
`$env:Path = '$system32'
$Setup
& '$installer'
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
