# Build CVD_Risk_Calculator-Setup-Full.exe (offline installer) from the GitHub repository.
#   powershell -ExecutionPolicy Bypass -File installer\build-setup.ps1 [-Repo <git url>] [-OutDir <folder>]
# Needs on the build PC: git, Node.js + npm, Inno Setup 6, internet (to clone, npm ci and download Node.js once).
# The setup itself contains everything and installs without internet.
param(
    [string]$Repo = 'https://github.com/tannamnaja-ui/CVD_RISK.git',
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist'),
    [string]$NodeVersion = '22.11.0'
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$work = Join-Path $here '.work'
$cache = Join-Path $here 'cache'
$src = Join-Path $work 'src'
$stage = Join-Path $work 'stage'

function Step($text) { Write-Output "==> $text" }
function Run($exe, [string[]]$argList) {
    & $exe @argList
    if ($LASTEXITCODE -ne 0) { throw "$exe $($argList -join ' ') failed ($LASTEXITCODE)" }
}

$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) not found' }

Step "clone $Repo"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force $work, $cache, $stage | Out-Null
Run git @('clone', '--depth', '1', $Repo, $src)

Step 'npm ci + build web app'
Push-Location $src
try {
    Run npm.cmd @('ci', '--no-audit', '--no-fund')
    Run npx.cmd @('vite', 'build', '--outDir', (Join-Path $stage 'web'), '--emptyOutDir')
    Step 'bundle server into one file'
    Run npx.cmd @('esbuild', 'server/index.ts', '--bundle', '--platform=node', "--target=node$($NodeVersion.Split('.')[0])", '--format=cjs',
        "--outfile=$(Join-Path $stage 'server.cjs')", '--external:pg-native', '--external:pg-cloudflare', '--external:cloudflare:sockets', '--log-level=warning')
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
} finally {
    Pop-Location
}

Step "Node.js $NodeVersion runtime (private copy, renamed so it can be stopped safely)"
$zipName = "node-v$NodeVersion-win-x64.zip"
$zip = Join-Path $cache $zipName
if (-not (Test-Path $zip)) {
    Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$zipName" -OutFile $zip -UseBasicParsing
}
$sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
$expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) }) -replace '\s.*$', ''
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected.Trim().ToLower()) { Remove-Item $zip; throw "checksum mismatch for $zipName" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    $runtime = New-Item -ItemType Directory -Force (Join-Path $stage 'runtime')
    foreach ($entry in $archive.Entries) {
        if ($entry.Name -eq 'node.exe') { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $runtime 'cvdrisk-server.exe'), $true) }
        if ($entry.Name -eq 'LICENSE' -and $entry.FullName.Split('/').Count -eq 2) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $runtime 'NODE-LICENSE.txt'), $true) }
    }
} finally {
    $archive.Dispose()
}

Step 'launcher + icon'
# VBScript reads UTF-16 (for the Thai message); the repo keeps it as UTF-8
$vbs = [IO.File]::ReadAllText((Join-Path $src 'installer\launcher.vbs'), [Text.Encoding]::UTF8)
[IO.File]::WriteAllText((Join-Path $stage 'launcher.vbs'), $vbs, [Text.Encoding]::Unicode)
Copy-Item (Join-Path $src 'installer\cvd.ico') $stage

Step "Inno Setup -> $OutDir"
New-Item -ItemType Directory -Force $OutDir | Out-Null
Run $iscc @('/Q', "/DStage=$stage", "/DOutDir=$OutDir", "/DAppVersion=$version", (Join-Path $src 'installer\cvd-risk.iss'))
$setup = Join-Path $OutDir 'CVD_Risk_Calculator-Setup-Full.exe'
Step ("done: {0} ({1:N1} MB)" -f $setup, ((Get-Item $setup).Length / 1MB))
