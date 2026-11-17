using System;
using System.Runtime.InteropServices;

internal static class MediaKeys
{
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    private static int Main(string[] args)
    {
        if (args.Length < 1) return 2;

        byte key;
        switch (args[0])
        {
            case "playpause": key = 0xB3; break;
            case "next": key = 0xB0; break;
            case "prev": key = 0xB1; break;
            case "volume_up": key = 0xAF; break;
            case "volume_down": key = 0xAE; break;
            case "mute": key = 0xAD; break;
            default: return 2;
        }

        int presses = args[0] == "volume_up" || args[0] == "volume_down" ? 2 : 1;
        for (int i = 0; i < presses; i++)
        {
            keybd_event(key, 0, 0, UIntPtr.Zero);
            keybd_event(key, 0, 2, UIntPtr.Zero);
            System.Threading.Thread.Sleep(40);
        }
        return 0;
    }
}
