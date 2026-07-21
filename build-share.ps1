# ─────────────────────────────────────────────────────────────────────
# TOOLFLUX Machining Log - Standalone Builder
#
# Usage:
#   .\build-share.ps1
#
# Creates: machlog-share.html  (single file, ~90KB)
# Share the SAME file with every customer via USB, WhatsApp, or email.
# Customer sets their company name on first launch — that becomes their ID.
# Data silently syncs to your Google Sheet whenever internet is available.
# ─────────────────────────────────────────────────────────────────────

$htmlFile = Join-Path $PSScriptRoot "machlog.html"
$jsFile   = Join-Path $PSScriptRoot "machlog.js"
$outFile  = Join-Path $PSScriptRoot "machlog-share.html"

if (-not (Test-Path $htmlFile)) { Write-Error "machlog.html not found"; exit 1 }
if (-not (Test-Path $jsFile))   { Write-Error "machlog.js not found";   exit 1 }

$html = [System.IO.File]::ReadAllText($htmlFile, [System.Text.Encoding]::UTF8)
$js   = [System.IO.File]::ReadAllText($jsFile,   [System.Text.Encoding]::UTF8)

# Escape $ signs so PowerShell -replace does not treat them as backreferences
$jsSafe = $js -replace '\$', '$$$$'

# Inline JS into HTML
$inlined = $html -replace '<script src="machlog\.js"></script>', "<script>`r`n$jsSafe`r`n</script>"

[System.IO.File]::WriteAllText($outFile, $inlined, [System.Text.Encoding]::UTF8)

$size = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Host ""
Write-Host "  DONE: $outFile" -ForegroundColor Green
Write-Host "  File size : $size KB"
Write-Host ""
Write-Host "  Send machlog-share.html to any customer."
Write-Host "  They set their company name on first launch."
Write-Host "  Data syncs silently to your Google Sheet."
Write-Host ""
