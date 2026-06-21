# Emits one JSON line with wifi + volume status. Called periodically by main.
$ErrorActionPreference = 'SilentlyContinue'

# ---- Volume (CoreAudio IAudioEndpointVolume) ----
if (-not ([System.Management.Automation.PSTypeName]'AudioCtl').Type) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, Guid g);
  int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l);
  int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint i, float l, Guid g);
  int SetChannelVolumeLevelScalar(uint i, float l, Guid g);
  int GetChannelVolumeLevel(uint i, out float l);
  int GetChannelVolumeLevelScalar(uint i, out float l);
  int SetMute(bool m, Guid g);
  int GetMute(out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ep); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public class AudioCtl {
  public static void Get(out int vol, out bool mute) {
    vol = -1; mute = false;
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o; dev.Activate(ref iid, 1, IntPtr.Zero, out o);
    var ep = (IAudioEndpointVolume)o;
    float lvl; ep.GetMasterVolumeLevelScalar(out lvl);
    bool m; ep.GetMute(out m);
    vol = (int)Math.Round(lvl * 100); mute = m;
  }
}
'@
}

$vol = 100; $mute = $false
try { [AudioCtl]::Get([ref]$vol, [ref]$mute) } catch { $vol = 100; $mute = $false }

# ---- WiFi (netsh) ----
$wifiState = 'disconnected'; $ssid = ''; $signal = 0
$netsh = netsh wlan show interfaces 2>$null
if ($netsh) {
  $ssidLine = ($netsh | Select-String -Pattern '^\s*SSID\s*:\s*(.+)$' | Select-Object -First 1)
  if ($ssidLine) { $ssid = $ssidLine.Matches[0].Groups[1].Value.Trim() }
  $sigLine = ($netsh | Select-String -Pattern '^\s*Signal\s*:\s*(\d+)%')
  if ($sigLine) { $signal = [int]$sigLine.Matches[0].Groups[1].Value }
  if ($ssid -ne '' -or $signal -gt 0) { $wifiState = 'connected' }
}

$obj = [ordered]@{ vol = $vol; mute = $mute; wifi = $wifiState; ssid = $ssid; signal = $signal }
$obj | ConvertTo-Json -Compress
