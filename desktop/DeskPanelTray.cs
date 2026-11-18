using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace DeskPanel
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            bool created;
            using (Mutex mutex = new Mutex(true, "DeskPanelTrayLauncher", out created))
            {
                if (!created)
                {
                    MessageBox.Show("Desk Panel 启动器已经在运行。", "Desk Panel",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new LauncherForm());
            }
        }
    }

    public class LauncherForm : Form
    {
        private const string BaseUrl = "http://127.0.0.1:8787";

        private static readonly Color Good = Color.FromArgb(22, 163, 74);
        private static readonly Color Bad = Color.FromArgb(220, 38, 38);
        private static readonly Color Warn = Color.FromArgb(217, 119, 6);
        private static readonly Color Muted = Color.FromArgb(107, 114, 128);

        private readonly string baseDir;
        private Process serverProcess;
        private bool startedServer;
        private bool exiting;
        private bool hideTipShown;

        private NotifyIcon tray;
        private Icon appIcon;
        private Thread statusThread;
        private volatile bool serverUp;
        private volatile bool fanRunning;
        private volatile string lastServerError;

        private Label statusLabel;
        private Label fanLabel;
        private Button serverButton;
        private Button openButton;

        public LauncherForm()
        {
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            BuildWindow();
            BuildTray();

            StartServer();
            serverUp = IsServerUp();
            fanRunning = IsFanRunning();
            ApplyStatus(serverUp, fanRunning);

            statusThread = new Thread(StatusLoop);
            statusThread.IsBackground = true;
            statusThread.Start();
        }

        private void BuildWindow()
        {
            Text = "Desk Panel 启动器";
            ClientSize = new Size(460, 272);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F);
            AutoScaleMode = AutoScaleMode.Dpi;
            appIcon = LoadIcon();
            Icon = appIcon;

            Label title = new Label();
            title.Text = "Desk Panel";
            title.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
            title.Location = new Point(18, 16);
            title.Size = new Size(300, 30);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "本机桌面面板与关联服务";
            subtitle.ForeColor = Muted;
            subtitle.Location = new Point(20, 48);
            subtitle.Size = new Size(380, 20);
            Controls.Add(subtitle);

            statusLabel = new Label();
            statusLabel.Text = "服务：检测中";
            statusLabel.Location = new Point(20, 86);
            statusLabel.Size = new Size(410, 20);
            Controls.Add(statusLabel);

            Label address = new Label();
            address.Text = "地址：" + BaseUrl;
            address.ForeColor = Muted;
            address.Location = new Point(20, 110);
            address.Size = new Size(410, 20);
            Controls.Add(address);

            fanLabel = new Label();
            fanLabel.Text = "风扇工具：检测中";
            fanLabel.Location = new Point(20, 134);
            fanLabel.Size = new Size(410, 20);
            Controls.Add(fanLabel);

            openButton = new Button();
            openButton.Text = "打开面板";            openButton.Location = new Point(20, 172);
            openButton.Size = new Size(124, 34);
            openButton.Click += delegate { OpenPanel("/"); };
            Controls.Add(openButton);

            serverButton = new Button();
            serverButton.Text = "启动服务";
            serverButton.Location = new Point(156, 172);
            serverButton.Size = new Size(124, 34);
            serverButton.Click += delegate { RestartServer(); };
            Controls.Add(serverButton);

            Button fanButton = new Button();
            fanButton.Text = "风扇工具";
            fanButton.Location = new Point(292, 172);
            fanButton.Size = new Size(148, 34);
            fanButton.Click += delegate { StartFanTool(); };
            Controls.Add(fanButton);

            Button hideButton = new Button();
            hideButton.Text = "最小化到托盘";
            hideButton.Location = new Point(20, 222);
            hideButton.Size = new Size(160, 30);
            hideButton.Click += delegate { HideToTray(); };
            Controls.Add(hideButton);

            Button exitButton = new Button();
            exitButton.Text = "退出";
            exitButton.Location = new Point(292, 222);
            exitButton.Size = new Size(148, 30);
            exitButton.Click += delegate { ExitApp(); };
            Controls.Add(exitButton);

            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized) HideToTray();
            };
            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (!exiting && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    HideToTray();
                }
            };
        }

        private void BuildTray()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开桌面面板", null, delegate { OpenPanel("/"); });
            menu.Items.Add("打开本机设置", null, delegate { OpenPanel("/admin"); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("启动风扇工具", null, delegate { StartFanTool(); });
            menu.Items.Add("重启服务", null, delegate { RestartServer(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("显示窗口", null, delegate { ShowWindow(); });
            menu.Items.Add("退出", null, delegate { ExitApp(); });

            tray = new NotifyIcon();
            tray.Icon = appIcon;
            tray.Text = "Desk Panel";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { ShowWindow(); };
        }

        private void StartServer()
        {
            if (IsServerUp())
            {
                startedServer = false;
                return;
            }
            if (serverProcess != null && !serverProcess.HasExited) return;

            string node = Path.Combine(baseDir, "node.exe");
            if (!File.Exists(node)) node = "node.exe";

            ProcessStartInfo info = new ProcessStartInfo(node, "server\\index.js");
            info.WorkingDirectory = baseDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;

            try
            {
                lastServerError = null;
                Process process = new Process();
                process.StartInfo = info;
                process.OutputDataReceived += delegate { };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null && e.Data.Trim().Length > 0) lastServerError = e.Data;
                };
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                serverProcess = process;
                startedServer = true;
            }
            catch (Exception ex)
            {
                startedServer = false;
                MessageBox.Show("服务启动失败：" + ex.Message, "Desk Panel",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopServer()
        {
            if (!startedServer || serverProcess == null) return;
            try
            {
                if (!serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    serverProcess.WaitForExit(3000);
                }
            }
            catch
            {
                /* 进程可能已经退出 */
            }
            serverProcess = null;
            startedServer = false;
        }

        private void RestartServer()
        {
            if (!startedServer && IsServerUp())
            {
                MessageBox.Show("当前服务不是由启动器启动的，请先关闭原服务进程。", "Desk Panel",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            StopServer();
            Thread.Sleep(400);
            StartServer();
            serverUp = false;
            ApplyStatus(serverUp, fanRunning);
        }

        private bool IsServerUp()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(BaseUrl + "/");
                request.Method = "GET";
                request.Timeout = 900;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return true;
                }
            }
            catch (WebException ex)
            {
                // 有 HTTP 响应就说明端口已在监听（例如设置了访问口令返回 401）
                return ex.Response != null;
            }
            catch
            {
                return false;
            }
        }

        private void OpenPanel(string path)
        {
            if (!serverUp)
            {
                MessageBox.Show("服务尚未启动，请稍候或点击“启动服务”。", "Desk Panel",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(BaseUrl + path);
                info.UseShellExecute = true;
                Process.Start(info);
            }
            catch (Exception ex)
            {
                MessageBox.Show("无法打开浏览器：" + ex.Message, "Desk Panel",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private bool IsFanRunning()
        {
            Process[] list = Process.GetProcessesByName("LibreHardwareMonitor");
            bool running = list.Length > 0;
            foreach (Process item in list) item.Dispose();
            return running;
        }

        private string FindFanTool()
        {
            string[] candidates = new string[]
            {
                @"C:\Tools\LibreHardwareMonitor\LibreHardwareMonitor.exe",
                Path.Combine(baseDir, @"LibreHardwareMonitor\LibreHardwareMonitor.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    @"LibreHardwareMonitor\LibreHardwareMonitor.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                    @"LibreHardwareMonitor\LibreHardwareMonitor.exe")
            };
            foreach (string path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        private void StartFanTool()
        {
            if (IsFanRunning())
            {
                MessageBox.Show("风扇工具已经在运行。", "Desk Panel",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string path = FindFanTool();
            if (path == null)
            {
                MessageBox.Show("未找到 LibreHardwareMonitor.exe。\n\n" +
                    "请把它放到 C:\\Tools\\LibreHardwareMonitor，或放到启动器目录下的 LibreHardwareMonitor 文件夹。",
                    "Desk Panel", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(path);
                info.WorkingDirectory = Path.GetDirectoryName(path);
                info.UseShellExecute = true;
                // 风扇与 EC 访问需要管理员权限
                info.Verb = "runas";
                Process.Start(info);
                fanRunning = IsFanRunning();
                ApplyStatus(serverUp, fanRunning);
            }
            catch (Exception ex)
            {
                MessageBox.Show("风扇工具启动失败：" + ex.Message, "Desk Panel",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StatusLoop()
        {
            while (!exiting)
            {
                bool up = IsServerUp();
                bool fan = IsFanRunning();
                serverUp = up;
                fanRunning = fan;
                try
                {
                    if (!IsDisposed && IsHandleCreated)
                    {
                        BeginInvoke(new Action(delegate { ApplyStatus(up, fan); }));
                    }
                }
                catch
                {
                    /* 窗口关闭过程中忽略 */
                }
                for (int i = 0; i < 30 && !exiting; i++) Thread.Sleep(100);
            }
        }

        private void ApplyStatus(bool up, bool fan)
        {
            if (up)
            {
                statusLabel.Text = "服务：运行中";
                statusLabel.ForeColor = Good;
                serverButton.Text = "重启服务";
            }
            else if (serverProcess != null && !serverProcess.HasExited)
            {
                statusLabel.Text = "服务：启动中…";
                statusLabel.ForeColor = Warn;
                serverButton.Text = "重启服务";
            }
            else
            {
                statusLabel.Text = "服务：未运行";
                statusLabel.ForeColor = Bad;
                serverButton.Text = "启动服务";
            }

            fanLabel.Text = fan ? "风扇工具：运行中" : "风扇工具：未运行";
            fanLabel.ForeColor = fan ? Good : Muted;
            openButton.Enabled = up;

            if (!up && lastServerError != null && serverProcess != null && serverProcess.HasExited)
            {
                statusLabel.Text = "服务：启动失败，请查看日志";
                statusLabel.ForeColor = Bad;
            }

            if (tray != null)
            {
                tray.Text = up ? "Desk Panel · 服务运行中" : "Desk Panel · 服务未运行";
            }
        }

        private void HideToTray()
        {
            Hide();
            WindowState = FormWindowState.Normal;
            if (!hideTipShown)
            {
                hideTipShown = true;
                tray.ShowBalloonTip(2000, "Desk Panel", "已最小化到托盘，双击图标可恢复窗口。",
                    ToolTipIcon.Info);
            }
        }

        private void ShowWindow()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void ExitApp()
        {
            exiting = true;
            StopServer();
            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
                tray = null;
            }
            Close();
            Application.Exit();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (tray != null) tray.Dispose();
            }
            base.Dispose(disposing);
        }

        private static Icon LoadIcon()
        {
            try
            {
                Icon icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (icon != null) return icon;
            }
            catch
            {
                /* 回退到系统图标 */
            }
            return SystemIcons.Application;
        }
    }
}
