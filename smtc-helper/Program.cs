using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Windows.Devices.Geolocation;
using Windows.Media.Control;
using Windows.Storage.Streams;

using GSMTCSessionManager = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager;
using GSMTCSession = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;

class Program
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr hdc, int x, int y);

    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength, dwMemoryLoad;
        public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile,
                     ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
    }

    static readonly Dictionary<string, string?> _iconCache = new();
    static volatile int _bx = 0, _by = 0, _bw = 460, _bh = 60; // island screen bounds for brightness

    static GSMTCSessionManager? _manager;
    static GSMTCSession? _current;
    static readonly object _outLock = new();
    static readonly JsonSerializerOptions _json = new() { };

    static async Task Main()
    {
        Console.OutputEncoding = Encoding.UTF8;

        _manager = await GSMTCSessionManager.RequestAsync();
        _manager.CurrentSessionChanged += (s, e) => _ = OnSessionChanged();

        // start reading stdin commands on background thread
        _ = Task.Run(ReadStdinLoop);
        // emit accurate location via Windows Location Services (WiFi/GPS, not IP)
        _ = Task.Run(EmitLocation);
        // poll foreground window, emit on change
        _ = Task.Run(EmitForegroundLoop);
        // poll CPU/GPU/RAM stats
        _ = Task.Run(EmitStatsLoop);
        // sample pixels under island for adaptive brightness
        _ = Task.Run(EmitBrightnessLoop);

        await OnSessionChanged();
        await EmitCurrent();

        // keep alive forever
        await Task.Delay(Timeout.Infinite);
    }

    static async Task OnSessionChanged()
    {
        try
        {
            if (_current != null)
            {
                _current.MediaPropertiesChanged -= OnAnyChanged;
                _current.PlaybackInfoChanged -= OnAnyChanged;
                _current.TimelinePropertiesChanged -= OnAnyChanged;
            }

            _current = _manager?.GetCurrentSession();

            if (_current != null)
            {
                _current.MediaPropertiesChanged += OnAnyChanged;
                _current.PlaybackInfoChanged += OnAnyChanged;
                _current.TimelinePropertiesChanged += OnAnyChanged;
            }

            await EmitCurrent();
        }
        catch { /* ignore */ }
    }

    static void OnAnyChanged(GSMTCSession sender, object args) => _ = EmitCurrent();

    static async Task EmitCurrent()
    {
        try
        {
            var session = _current;
            if (session == null)
            {
                Write(new TrackOut { status = "none" });
                return;
            }

            var props = await session.TryGetMediaPropertiesAsync();
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();

            string status = playback?.PlaybackStatus switch
            {
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => "playing",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => "paused",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Stopped => "stopped",
                _ => "stopped"
            };

            string? thumb = null;
            if (props?.Thumbnail != null)
                thumb = await ThumbToBase64(props.Thumbnail);

            var sourceAppId = session.SourceAppUserModelId ?? "";
            var outObj = new TrackOut
            {
                title = props?.Title ?? "",
                artist = props?.Artist ?? "",
                album = props?.AlbumTitle ?? "",
                status = status,
                posMs = (long)(timeline?.Position.TotalMilliseconds ?? 0),
                durMs = (long)(timeline?.EndTime.TotalMilliseconds ?? 0),
                thumbB64 = thumb,
                appId = sourceAppId,
                appIconB64 = GetAppIconB64(sourceAppId)
            };
            Write(outObj);
        }
        catch { /* ignore */ }
    }

    static async Task<string?> ThumbToBase64(IRandomAccessStreamReference reference)
    {
        try
        {
            using var stream = await reference.OpenReadAsync();
            uint size = (uint)stream.Size;
            if (size == 0) return null;
            var buffer = new Windows.Storage.Streams.Buffer(size);
            await stream.ReadAsync(buffer, size, InputStreamOptions.None);
            var reader = DataReader.FromBuffer(buffer);
            var bytes = new byte[buffer.Length];
            reader.ReadBytes(bytes);
            return Convert.ToBase64String(bytes);
        }
        catch { return null; }
    }

    static void Write(TrackOut obj)
    {
        var line = JsonSerializer.Serialize(obj, _json);
        lock (_outLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    static async Task EmitLocation()
    {
        try
        {
            var access = await Geolocator.RequestAccessAsync();
            if (access != GeolocationAccessStatus.Allowed) return;
            var locator = new Geolocator { DesiredAccuracyInMeters = 500u };
            var pos = await locator.GetGeopositionAsync(
                TimeSpan.FromMinutes(1),
                TimeSpan.FromSeconds(15)
            );
            var coord = pos.Coordinate.Point.Position;
            var line = JsonSerializer.Serialize(new
            {
                type = "location",
                lat = coord.Latitude,
                lon = coord.Longitude
            });
            lock (_outLock)
            {
                Console.Out.WriteLine(line);
                Console.Out.Flush();
            }
        }
        catch { /* location unavailable or denied */ }
    }

    static string? GetAppIconB64(string appId)
    {
        if (string.IsNullOrEmpty(appId)) return null;
        if (_iconCache.TryGetValue(appId, out var cached)) return cached;
        try
        {
            string processName;
            if (appId.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                processName = Path.GetFileNameWithoutExtension(appId);
            else
            {
                // UWP: "SpotifyAB.SpotifyMusic_xyz!Spotify" → try part after !
                var bang = appId.IndexOf('!');
                processName = bang >= 0 ? appId[(bang + 1)..] : appId.Split('_')[0].Split('.').Last();
            }
            var procs = Process.GetProcessesByName(processName);
            var exePath = procs.Length > 0 ? procs[0].MainModule?.FileName : null;
            var result = exePath != null ? ExeIconBase64(exePath) : null;
            _iconCache[appId] = result;
            return result;
        }
        catch { _iconCache[appId] = null; return null; }
    }

    static string? ExeIconBase64(string exePath)
    {
        try
        {
            var icon = Icon.ExtractAssociatedIcon(exePath);
            if (icon == null) return null;
            using var bmp = icon.ToBitmap();
            // scale to 20x20 for overlay display
            using var scaled = new Bitmap(bmp, new System.Drawing.Size(20, 20));
            using var ms = new MemoryStream();
            scaled.Save(ms, ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch { return null; }
    }

    // GPU counter cache — keyed by instance name, grouped by LUID for multi-GPU
    static readonly Dictionary<string, PerformanceCounter> _gpuCache = new();
    static DateTime _gpuCacheAt = DateTime.MinValue;

    static async Task EmitBrightnessLoop()
    {
        while (true)
        {
            await Task.Delay(2500);
            try
            {
                var hdc = GetDC(IntPtr.Zero);
                int x0 = _bx, y0 = _by, w = Math.Max(1, _bw), h = Math.Max(1, _bh);
                float total = 0; int count = 0;
                int stepX = Math.Max(1, w / 20), stepY = Math.Max(1, h / 4);
                for (int y = y0; y < y0 + h; y += stepY)
                    for (int x = x0; x < x0 + w; x += stepX)
                    {
                        uint c = GetPixel(hdc, x, y);
                        if (c == 0xFFFFFFFF) continue; // off-screen sentinel
                        byte r = (byte)(c & 0xFF), g = (byte)((c >> 8) & 0xFF), b = (byte)((c >> 16) & 0xFF);
                        total += 0.299f * r + 0.587f * g + 0.114f * b;
                        count++;
                    }
                ReleaseDC(IntPtr.Zero, hdc);
                if (count > 0)
                {
                    var brightness = total / count / 255f;
                    var line = JsonSerializer.Serialize(new { type = "brightness", value = brightness });
                    lock (_outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
                }
            }
            catch { }
        }
    }

    static int GetGpuPercent()
    {
        try
        {
            // Rebuild cache every 30s (handles new/closed processes)
            if ((DateTime.Now - _gpuCacheAt).TotalSeconds > 30)
            {
                foreach (var c in _gpuCache.Values) c.Dispose();
                _gpuCache.Clear();
                var cat = new PerformanceCounterCategory("GPU Engine");
                foreach (var inst in cat.GetInstanceNames())
                {
                    var pc = new PerformanceCounter("GPU Engine", "Utilization Percentage", inst);
                    pc.NextValue(); // warm up — first read always 0
                    _gpuCache[inst] = pc;
                }
                _gpuCacheAt = DateTime.Now;
                return 0; // return 0 this cycle; real values on next poll
            }

            // Sum utilization per physical GPU (LUID), return max across GPUs
            var byLuid = new Dictionary<string, float>();
            foreach (var (inst, counter) in _gpuCache)
            {
                var m = System.Text.RegularExpressions.Regex.Match(inst, @"luid_0x\w+_0x\w+");
                var luid = m.Success ? m.Value : "gpu0";
                byLuid.TryGetValue(luid, out float prev);
                byLuid[luid] = prev + counter.NextValue();
            }
            var maxGpu = byLuid.Values.DefaultIfEmpty(0f).Max();
            return Math.Min(100, (int)Math.Round(maxGpu));
        }
        catch { return 0; }
    }

    static async Task EmitStatsLoop()
    {
        using var cpuCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total");
        cpuCounter.NextValue(); // first read always 0 — discard
        await Task.Delay(1000);

        while (true)
        {
            try
            {
                var cpu = (int)Math.Round(cpuCounter.NextValue());
                var mem = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
                GlobalMemoryStatusEx(ref mem);
                var ram = (int)mem.dwMemoryLoad;
                var gpu = GetGpuPercent();
                var line = JsonSerializer.Serialize(new { type = "stats", cpu, gpu, ram });
                lock (_outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
            }
            catch { }
            await Task.Delay(2000);
        }
    }

    static async Task EmitForegroundLoop()
    {
        string lastApp = "";
        while (true)
        {
            try
            {
                var hwnd = GetForegroundWindow();
                if (hwnd != IntPtr.Zero)
                {
                    GetWindowThreadProcessId(hwnd, out uint pid);
                    var proc = Process.GetProcessById((int)pid);
                    var name = proc.ProcessName;
                    if (!name.Equals("SmtcHelper", StringComparison.OrdinalIgnoreCase) &&
                        !name.Equals("electron", StringComparison.OrdinalIgnoreCase) &&
                        name != lastApp)
                    {
                        lastApp = name;
                        var exePath = proc.MainModule?.FileName;
                        var iconB64 = exePath != null ? ExeIconBase64(exePath) : null;
                        var line = JsonSerializer.Serialize(new { type = "foreground", app = name, iconB64 });
                        lock (_outLock)
                        {
                            Console.Out.WriteLine(line);
                            Console.Out.Flush();
                        }
                    }
                }
            }
            catch { }
            await Task.Delay(1200);
        }
    }

    static void ReadStdinLoop()
    {
        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var cmd = JsonSerializer.Deserialize<CmdIn>(line);
                if (cmd?.cmd == null) continue;
                _ = HandleCommand(cmd);
            }
            catch { /* ignore bad line */ }
        }
    }

    static async Task HandleCommand(CmdIn cmd)
    {
        // setbounds works without a media session
        if (cmd.cmd == "setbounds") { _bx = cmd.x; _by = cmd.y; _bw = cmd.w; _bh = cmd.h; return; }

        var session = _current;
        if (session == null) return;
        try
        {
            switch (cmd.cmd)
            {
                case "play": await session.TryPlayAsync(); break;
                case "pause": await session.TryPauseAsync(); break;
                case "toggle": await session.TryTogglePlayPauseAsync(); break;
                case "next": await session.TrySkipNextAsync(); break;
                case "prev": await session.TrySkipPreviousAsync(); break;
                case "seek":
                    long ticks = cmd.posMs * 10000;
                    await session.TryChangePlaybackPositionAsync(ticks);
                    break;
            }
        }
        catch { /* ignore */ }
    }
}

class TrackOut
{
    public string title { get; set; } = "";
    public string artist { get; set; } = "";
    public string album { get; set; } = "";
    public string status { get; set; } = "none";
    public long posMs { get; set; }
    public long durMs { get; set; }
    public string? thumbB64 { get; set; }
    public string? appIconB64 { get; set; }
    public string appId { get; set; } = "";
}

class CmdIn
{
    public string? cmd { get; set; }
    public long posMs { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int w { get; set; }
    public int h { get; set; }
}
