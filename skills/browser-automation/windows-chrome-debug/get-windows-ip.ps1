# 获取 Windows 本机主 IPv4 地址（默认路由接口）
$defaultRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
if (-not $defaultRoute) {
    Write-Error 'No default route found'
    exit 1
}

$ip = Get-NetIPAddress -InterfaceIndex $defaultRoute.ifIndex -AddressFamily IPv4 | Select-Object -First 1
if (-not $ip) {
    Write-Error "No IPv4 address found on default route interface $($defaultRoute.ifIndex)"
    exit 1
}

Write-Output $ip.IPAddress
