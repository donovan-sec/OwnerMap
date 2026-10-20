<#
.SYNOPSIS
    Serve OwnerMap on http://localhost for a one-off check.

.DESCRIPTION
    Serves the OwnerMap folder on this PC only. Windows PowerShell 5.1 can run
    it with no extra install. Microsoft sign-in accepts http for localhost and
    rejects a file:// address.

    Open http://localhost:8080/ownermap.html and register that exact URL as a
    Single-page application redirect. Stop the server with Ctrl+C.

.PARAMETER Port
    Port to listen on. The default is 8080.

.PARAMETER Root
    Folder that contains ownermap.html and the src folder. The default is the
    parent of this script.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Serve-OwnerMap.ps1

.EXAMPLE
    .\scripts\Serve-OwnerMap.ps1 -Port 8080
#>
[CmdletBinding()]
param(
    [Parameter()]
    [int]$Port = 8080,

    [Parameter()]
    [string]$Root
)

$ErrorActionPreference = 'Stop'

if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Port must be between 1 and 65535. Received: $Port"
}

if ([string]::IsNullOrWhiteSpace($Root)) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $Root = Split-Path -Parent $scriptDir
}
if (-not (Test-Path -LiteralPath $Root)) {
    throw "Folder not found: $Root"
}
$Root = (Resolve-Path -LiteralPath $Root).Path
$htmlPath = Join-Path $Root 'ownermap.html'
if (-not (Test-Path -LiteralPath $htmlPath -PathType Leaf)) {
    throw "ownermap.html was not found in $Root. Unzip the download so ownermap.html and the src folder stay side by side, then run this again."
}

function Get-OwnerMapContentType {
    param([string]$Extension)
    switch ($Extension.ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.js' { return 'text/javascript; charset=utf-8' }
        '.css' { return 'text/css; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.png' { return 'image/png' }
        '.svg' { return 'image/svg+xml' }
        '.ico' { return 'image/x-icon' }
        default { return 'application/octet-stream' }
    }
}

$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
}
catch {
    throw "Could not listen on $prefix. Another program may be using port $Port. Close it, or run this script with -Port and a free port. $_"
}

Write-Host "Serving $Root"
Write-Host "Open http://localhost:$Port/ownermap.html"
Write-Host "Single-page application redirect URI: http://localhost:$Port/ownermap.html"
Write-Host 'Press Ctrl+C to stop.'

$rootFull = [System.IO.Path]::GetFullPath($Root)
if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = $rootFull + [System.IO.Path]::DirectorySeparatorChar
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $relative = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($relative)) {
                $relative = 'ownermap.html'
            }
            $relative = $relative -replace '/', [System.IO.Path]::DirectorySeparatorChar
            $full = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))
            $inside = $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
            $isFile = $inside -and (Test-Path -LiteralPath $full -PathType Leaf)
            if (-not $isFile) {
                $context.Response.StatusCode = 404
                $message = [System.Text.Encoding]::UTF8.GetBytes('Not found')
                $context.Response.ContentType = 'text/plain; charset=utf-8'
                $context.Response.ContentLength64 = $message.Length
                $context.Response.OutputStream.Write($message, 0, $message.Length)
            }
            else {
                $bytes = [System.IO.File]::ReadAllBytes($full)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = Get-OwnerMapContentType ([System.IO.Path]::GetExtension($full))
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        catch {
            try { $context.Response.StatusCode = 500 } catch { }
        }
        finally {
            try { $context.Response.Close() } catch { }
        }
    }
}
finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
