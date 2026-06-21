using System.Text;
using System.Text.Json;
using Windows.Media.Control;
using Windows.Storage.Streams;

using GSMTCSessionManager = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager;
using GSMTCSession = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;

class Program
{
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

            var outObj = new TrackOut
            {
                title = props?.Title ?? "",
                artist = props?.Artist ?? "",
                album = props?.AlbumTitle ?? "",
                status = status,
                posMs = (long)(timeline?.Position.TotalMilliseconds ?? 0),
                durMs = (long)(timeline?.EndTime.TotalMilliseconds ?? 0),
                thumbB64 = thumb,
                appId = session.SourceAppUserModelId ?? ""
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
                    long ticks = cmd.posMs * 10000; // ms → 100ns ticks
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
    public string appId { get; set; } = "";
}

class CmdIn
{
    public string? cmd { get; set; }
    public long posMs { get; set; }
}
