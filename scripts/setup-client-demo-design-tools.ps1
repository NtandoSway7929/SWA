#requires -Version 5.1
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot

function Test-Python3 {
    $pyLauncher = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $output = & $pyLauncher.Source -3 --version 2>&1
        if ($LASTEXITCODE -eq 0 -and "$output" -match "Python 3\.") {
            Write-Host "Found Python 3: $output"
            return $true
        }
    }

    foreach ($name in @("python.exe", "python3.exe")) {
        $python = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $python) { continue }
        $output = & $python.Source --version 2>&1
        if ($LASTEXITCODE -eq 0 -and "$output" -match "Python 3\.") {
            Write-Host "Found Python 3: $output"
            return $true
        }
    }

    return $false
}

$npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $npm) {
    throw "Node.js/npm was not found. Install the current Node.js LTS release, reopen PowerShell, then rerun this script."
}

$node = Get-Command "node.exe" -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js was not found on PATH. Install Node.js LTS, reopen PowerShell, then rerun this script."
}

$nodeVersion = & $node.Source --version
if ($LASTEXITCODE -ne 0) {
    throw "Node.js version check failed."
}
Write-Host "Found Node.js $nodeVersion"

if (-not (Test-Python3)) {
    throw "Python 3 is required by UI/UX Pro Max local search scripts. Install Python 3, enable Add Python to PATH, reopen PowerShell, then rerun this script."
}

$uxSkillPath = Join-Path $RepoRoot ".agents\skills\ui-ux-pro-max\SKILL.md"
if (Test-Path -LiteralPath $uxSkillPath) {
    Write-Host "UI/UX Pro Max skill already exists; leaving it unchanged: $uxSkillPath"
}
else {
    Write-Host "Installing UI/UX Pro Max CLI..."
    & $npm.Source install --global "ui-ux-pro-max-cli@latest"
    if ($LASTEXITCODE -ne 0) {
        throw "Installing ui-ux-pro-max-cli failed. No MCP configuration was changed."
    }

    $prefixOutput = & $npm.Source config get prefix
    if ($LASTEXITCODE -ne 0) {
        throw "Could not determine npm's global installation directory."
    }
    $npmPrefix = "$prefixOutput".Trim()
    $uiproPath = Join-Path $npmPrefix "uipro.cmd"

    if (Test-Path -LiteralPath $uiproPath) {
        & $uiproPath init --ai universal
    }
    else {
        $uipro = Get-Command "uipro.cmd" -ErrorAction SilentlyContinue
        if (-not $uipro) {
            throw "The CLI installed, but uipro.cmd was not found in npm's global directory or PATH. Review npm's installation output before retrying."
        }
        & $uipro.Source init --ai universal
    }

    if ($LASTEXITCODE -ne 0) {
        throw "UI/UX Pro Max initialization failed. Review the installer output before retrying."
    }
}

Write-Host ""
Write-Host "UI/UX Pro Max setup step completed."
Write-Host "Next, optionally configure 21st MCP. Obtain an API key from https://21st.dev/mcp."
$secureKey = Read-Host "Enter your 21st.dev API key (leave blank to skip)" -AsSecureString

if ($secureKey.Length -eq 0) {
    Write-Host "Skipped 21st MCP configuration. UI/UX Pro Max setup was not rolled back."
    exit 0
}

$ptr = [IntPtr]::Zero
$apiKey = $null
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
}
finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Host "Skipped 21st MCP configuration because no key was provided."
    exit 0
}

$configDirectory = Join-Path $RepoRoot ".agents"
$configPath = Join-Path $configDirectory "mcp_config.json"
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    }
    catch {
        $apiKey = $null
        throw "Existing $configPath is not valid JSON. It was not overwritten. Back it up and repair it before rerunning."
    }
}
else {
    $config = [pscustomobject]@{
        mcpServers = [pscustomobject]@{}
    }
}

if ($null -eq $config.PSObject.Properties["mcpServers"] -or $null -eq $config.mcpServers) {
    $config | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value ([pscustomobject]@{}) -Force
}

$servers = $config.mcpServers
$existing21st = $servers.PSObject.Properties["21st"]
if ($existing21st) {
    $replace = Read-Host "A 21st MCP entry already exists. Replace only that entry and preserve other servers? Type Y to replace"
    if ($replace -cne "Y") {
        $apiKey = $null
        Write-Host "Kept the existing 21st MCP entry unchanged."
        exit 0
    }
}

$serverConfig = [pscustomobject]@{
    serverUrl = "https://21st.dev/api/mcp"
    headers = [pscustomobject]@{
        "x-api-key" = $apiKey
    }
}

$servers | Add-Member -MemberType NoteProperty -Name "21st" -Value $serverConfig -Force
$json = $config | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText(
    $configPath,
    ($json + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
)

$apiKey = $null
$secureKey.Dispose()

Write-Host ""
Write-Host "Saved the local 21st MCP entry to: $configPath"
Write-Host "That path is excluded by .gitignore. Do not remove the ignore rule or commit the key."
Write-Host "Refresh Antigravity's MCP server list in Settings > Customizations > Installed MCP Servers."
Write-Host "Connection is not verified until Antigravity shows the server as connected."
