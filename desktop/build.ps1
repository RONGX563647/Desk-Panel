param(
  [switch]$SkipWebBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $PSScriptRoot 'release'
$out = Join-Path $releaseRoot 'DeskPanel'
$zip = Join-Path $releaseRoot 'DeskPanel-win64.zip'

Write-Host '==> Build web assets'
if (-not $SkipWebBuild) {
  Push-Location $root
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
  } finally {
    Pop-Location
  }
}

Write-Host '==> Prepare release folder'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null

Copy-Item (Join-Path $root 'server') $out -Recurse
Copy-Item (Join-Path $root 'dist') $out -Recurse
Copy-Item (Join-Path $root 'package.json') $out

$dataOut = Join-Path $out 'data'
New-Item -ItemType Directory -Path $dataOut | Out-Null
$configFile = Join-Path $root 'data\config.json'
if (Test-Path $configFile) {
  Copy-Item $configFile (Join-Path $dataOut 'config.json')
}

Write-Host '==> Copy Node runtime'
$nodePath = (Get-Command node -ErrorAction Stop).Source
Copy-Item $nodePath (Join-Path $out 'node.exe')

Write-Host '==> Copy production dependencies'
Push-Location $root
try {
  $modules = & npm ls --omit=dev --all --parseable 2>$null |
    Where-Object { $_ -like '*node_modules*' }
} finally {
  Pop-Location
}

foreach ($source in $modules) {
  if (-not (Test-Path $source)) { continue }
  $relative = $source.Substring($root.Length).TrimStart('\')
  $target = Join-Path $out $relative
  if (Test-Path $target) { continue }
  $parent = Split-Path $target -Parent
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Copy-Item $source $target -Recurse -Force
}

Write-Host '==> Compile launcher'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }

$ico = Join-Path $PSScriptRoot 'DeskPanel.ico'
& (Join-Path $PSScriptRoot 'make-icon.ps1') -Output $ico
$manifest = Join-Path $PSScriptRoot 'app.manifest'

$source = Join-Path $PSScriptRoot 'DeskPanelTray.cs'
$exe = Join-Path $out 'DeskPanel.exe'
& $csc /nologo /target:winexe /platform:anycpu /codepage:65001 `
  "/out:$exe" `
  "/win32icon:$ico" `
  "/win32manifest:$manifest" `
  /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  $source
if ($LASTEXITCODE -ne 0) { throw 'launcher compile failed' }

Write-Host '==> Create zip archive'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip

$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ''
Write-Host "Done: $exe"
Write-Host "Zip:  $zip ($size MB)"
