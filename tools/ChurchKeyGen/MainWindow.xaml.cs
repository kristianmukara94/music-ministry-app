using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;

namespace ChurchKeyGen;

public partial class MainWindow : Window
{
    private readonly DispatcherTimer _copiedTimer = new() { Interval = TimeSpan.FromSeconds(2) };

    public MainWindow()
    {
        InitializeComponent();
        ChurchCodeBox.MaxLength = KeyEngine.MaxCodeLength;
        _copiedTimer.Tick += (_, _) => ResetCopyLabel();
        Loaded += (_, _) =>
        {
            ChurchCodeBox.Focus();
            ShowConnectionStatus();
        };
    }

    private async void Generate_Click(object sender, RoutedEventArgs e)
    {
        var code = KeyEngine.NormalizeCode(ChurchCodeBox.Text);
        if (!KeyEngine.IsValidCode(code))
        {
            ClearResult();
            ShowStatus("Enter a code using letters, numbers and single hyphens.", "ErrorBrush");
            ChurchCodeBox.Focus();
            return;
        }

        // Setting the text clears any earlier result through Input_Changed, so it comes before the new key is shown.
        ChurchCodeBox.Text = code;
        var store = KeyStore.Create();
        if (store is null)
        {
            ShowStatus(KeyStore.NotConnected, "ErrorBrush");
            return;
        }

        var result = KeyEngine.Generate((Validity)DurationBox.SelectedIndex);
        SetBusy(true);
        var problem = await store.SaveAsync(result);
        SetBusy(false);
        if (problem is not null)
        {
            ShowStatus(problem, "ErrorBrush");
            return;
        }

        KeyBox.Text = result.Key;
        CopyButton.IsEnabled = true;
        var license = result.LicenseDays is int days ? $"{days}-day license" : "Perpetual license";
        ShowStatus($"Saved. {license}. Activate within 7 days.", "MutedBrush");
    }

    // The inputs are locked during a save, so the key shown always belongs to them.
    private void SetBusy(bool busy)
    {
        ChurchCodeBox.IsEnabled = !busy;
        DurationBox.IsEnabled = !busy;
        GenerateButton.IsEnabled = !busy;
        GenerateButton.Content = busy ? "Saving..." : "Generate Key";
    }

    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetDataObject(KeyBox.Text, copy: true);
        }
        catch (ExternalException)
        {
            ShowStatus("Another app is using the clipboard. Try again.", "ErrorBrush");
            return;
        }

        CopyButton.Content = "Copied!";
        _copiedTimer.Stop();
        _copiedTimer.Start();
    }

    // A key on screen must always belong to the inputs on screen.
    private void Input_Changed(object sender, RoutedEventArgs e)
    {
        if (IsInitialized)
        {
            ClearResult();
        }
    }

    private void ClearResult()
    {
        KeyBox.Clear();
        CopyButton.IsEnabled = false;
        ResetCopyLabel();
        ShowConnectionStatus();
    }

    private void ShowConnectionStatus()
    {
        if (KeyStore.IsConfigured())
        {
            ShowStatus(KeyStore.Connected, "MutedBrush");
        }
        else
        {
            ShowStatus(KeyStore.NotConnected, "ErrorBrush");
        }
    }

    private void ResetCopyLabel()
    {
        _copiedTimer.Stop();
        CopyButton.Content = "Copy";
    }

    private void ShowStatus(string message, string brushKey)
    {
        StatusText.Foreground = (Brush)FindResource(brushKey);
        StatusText.Text = message;
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
