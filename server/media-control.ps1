param([string]$Command)

$ErrorActionPreference = 'Stop'

$map = @{
  playpause = 0xB3
  next      = 0xB0
  prev      = 0xB1
  volume_up = 0xAF
  volume_down = 0xAE
  mute      = 0xAD
}

if (-not $map.ContainsKey($Command)) {
  Write-Error "unknown media command: $Command"
  exit 2
}

Add-Type -Namespace Win32 -Name MediaKeys -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
'@

$vk = [byte]$map[$Command]
$presses = 1
if ($Command -eq 'volume_up' -or $Command -eq 'volume_down') { $presses = 2 }

for ($i = 0; $i -lt $presses; $i++) {
  [Win32.MediaKeys]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
  [Win32.MediaKeys]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
}
