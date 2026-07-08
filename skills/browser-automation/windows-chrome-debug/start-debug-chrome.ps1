#Requires -Version 5.1

$DebugPort = 9221
$PublicPort = 9222
$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$ProfileDir = "$env:LOCALAPPDATA\DebugChrome"

function Test-DebugChromeRunning {
    $listeners = Get-NetTCPConnection -LocalPort $DebugPort -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) { return $false }

    $ipv4Loopback = $listeners | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
    if (-not $ipv4Loopback) { return $false }

    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$DebugPort/json/version" -TimeoutSec 2 -UseBasicParsing
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-DebugChromeRunning) {
    Write-Host "Debug Chrome already running at http://127.0.0.1:$DebugPort/json/version"
    exit 0
}

Get-NetTCPConnection -LocalPort $DebugPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -eq 'chrome') {
        Stop-Process -Id $proc.Id -Force
        Write-Host "Stopped stale Chrome process $($proc.Id) on port $DebugPort"
    }
}
Start-Sleep -Seconds 1

# Ensure profile directory exists (don't remove, keep the profile)
New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null

# Compile a tiny launcher that uses CreateProcess with SW_SHOWMINNOACTIVE.
# This starts Chrome minimized without flashing to foreground.
# The launcher reads Chrome path, profile dir, and port from args.
$launcherCs = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

class Launcher {
    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize;
        public uint dwXCountChars, dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(
        string lpApplicationName, StringBuilder lpCommandLine,
        ref SECURITY_ATTRIBUTES pa, ref SECURITY_ATTRIBUTES ta,
        bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    const uint STARTF_USESHOWWINDOW = 0x00000001;
    const ushort SW_SHOWMINNOACTIVE = 7;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;

    static int Main(string[] args) {
        if (args.Length < 3) {
            Console.Error.WriteLine("Usage: Launcher.exe <chromePath> <profileDir> <port>");
            return 1;
        }
        string chromePath = args[0];
        string profileDir = args[1];
        string port = args[2];

        var cmd = new StringBuilder();
        cmd.Append('"').Append(chromePath).Append('"');
        cmd.Append(" --user-data-dir=\"").Append(profileDir).Append('"');
        cmd.Append(" --remote-debugging-port=").Append(port);
        cmd.Append(" --remote-debugging-address=127.0.0.1");
        cmd.Append(" --no-first-run");
        cmd.Append(" --no-default-browser-check");

        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_SHOWMINNOACTIVE;
        var pa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)) };
        var ta = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)) };
        PROCESS_INFORMATION pi;
        if (!CreateProcess(null, cmd, ref pa, ref ta, false, CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, null, ref si, out pi)) {
            Console.Error.WriteLine("CreateProcess failed: {0}", Marshal.GetLastWin32Error());
            return 2;
        }
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return 0;
    }
}
'@

$launcherExe = Join-Path $env:TEMP 'debug-chrome-launcher.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $launcherExe) -or (Get-Item $launcherExe).LastWriteTime -lt (Get-Date).AddDays(-7)) {
    $csFile = Join-Path $env:TEMP 'debug-chrome-launcher.cs'
    Set-Content -Path $csFile -Value $launcherCs -Encoding UTF8
    & $compiler /nologo /out:$launcherExe $csFile 2>&1 | Out-Null
    if (-not (Test-Path $launcherExe)) {
        Write-Host "ERROR: Failed to compile launcher"
        exit 1
    }
}

Write-Host "Launching: $ChromePath | $ProfileDir | $DebugPort"
& $launcherExe $ChromePath $ProfileDir $DebugPort
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Launcher failed (exit code $LASTEXITCODE)"
    exit 1
}

Write-Host "Started debug Chrome (minimized) at http://127.0.0.1:$DebugPort/json/version"
Write-Host "WSL should connect via http://<windows-host-ip>:$PublicPort/json/version"
