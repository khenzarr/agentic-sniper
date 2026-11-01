# Manually start and keep running in this terminal. Stop with Ctrl+C.
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
node .\src\sniper.mjs --loop
