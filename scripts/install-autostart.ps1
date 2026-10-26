# Start the CV Risk Calculator server (http://localhost:4009) automatically when this user logs in to Windows.
# Puts a hidden launcher (CV-Risk-Server.vbs) in the user's Startup folder — no administrator rights needed.
#   install:    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#   uninstall:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall
# Note: the server uses port 4009, the same as "npm run dev" — stop one before starting the other.
param([switch]$Uninstall)

$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'CV-Risk-Server.vbs'

if ($Uninstall) {
    if (Test-Path $launcher) { Remove-Item $launcher -Confirm:$false }
    Write-Output "Removed $launcher"
    return
}

$cmd = Join-Path $PSScriptRoot 'start-server.cmd'
if (-not (Test-Path $cmd)) { throw "Not found: $cmd" }

# window style 0 = hidden; False = do not wait
$vbs = @"
' CV Risk Calculator server - http://localhost:4009 (created by scripts\install-autostart.ps1)
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c """"$cmd""""", 0, False
"@
# UTF-16 so the Thai folder name in the path survives
Set-Content -Path $launcher -Value $vbs -Encoding Unicode
Write-Output "Installed $launcher"
