# This script ONLY scans and writes a local report. It cannot send mint transactions.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
npm run scan
