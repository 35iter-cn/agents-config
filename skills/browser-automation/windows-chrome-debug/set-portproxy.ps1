#Requires -Version 5.1
#Requires -RunAsAdministrator

$PublicPort = 9222
$DebugPort = 9221

netsh interface portproxy delete v4tov4 listenport=$PublicPort listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy delete v4tov6 listenport=$PublicPort listenaddress=0.0.0.0 | Out-Null

netsh interface portproxy add v4tov4 `
    listenaddress=0.0.0.0 `
    listenport=$PublicPort `
    connectaddress=127.0.0.1 `
    connectport=$DebugPort

Restart-Service IpHlpsvc -Force

Write-Host "Port proxy configured: 0.0.0.0:$PublicPort -> 127.0.0.1:$DebugPort"
netsh interface portproxy show all
