using System.Security.Cryptography;
using System.Text;
using System.Web;
using Npgsql;
using NpgsqlTypes;

namespace ChurchKeyGen;

/// <summary>
/// Saves setup keys to the website database. The server only accepts a key whose keyed hash is in setup_keys, so a key must never be shown
/// before it is saved here. Credentials come from the environment, then the Git-ignored KeyStore.Secrets.cs, and are never shown in a message.
/// </summary>
public sealed partial class KeyStore
{
    public const string Connected = "Ready. Keys are saved to the website database.";
    public const string NotConnected = "Not connected. Set DATABASE_URL and TOKEN_SECRET, then reopen this app.";
    public const string NotSaved = "The key could not be saved, so it was not shown. Try again.";
    public const string MissingColumn = "The database is missing license_days. Run its migration first.";

    private const int MinSecretLength = 32; // The server refuses anything shorter.
    private const int TimeoutSeconds = 20; // A sleeping Neon database can take several seconds to wake.
    private const string UndefinedColumn = "42703";

    private static readonly (string DatabaseUrl, string TokenSecret) LocalSecrets = ReadLocalSecrets();

    private readonly string _databaseUrl;
    private readonly string _tokenSecret;

    private KeyStore(string databaseUrl, string tokenSecret)
    {
        _databaseUrl = databaseUrl;
        _tokenSecret = tokenSecret;
    }

    /// <summary>
    /// Implemented only in KeyStore.Secrets.cs, which the project compiles when the file exists. Without it the call is removed,
    /// the values stay empty, and the app reports as not connected unless the environment variables are set.
    /// To build a working exe, add that file with this method in a partial KeyStore class, assigning both parameters.
    /// </summary>
    static partial void ApplyLocalSecrets(ref string databaseUrl, ref string tokenSecret);

    private static (string DatabaseUrl, string TokenSecret) ReadLocalSecrets()
    {
        var databaseUrl = string.Empty;
        var tokenSecret = string.Empty;
        ApplyLocalSecrets(ref databaseUrl, ref tokenSecret);
        return (databaseUrl, tokenSecret);
    }

    public static string GetDatabaseUrl()
    {
        var envUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
        return !string.IsNullOrWhiteSpace(envUrl) ? envUrl : LocalSecrets.DatabaseUrl;
    }

    public static string GetTokenSecret()
    {
        var envSecret = Environment.GetEnvironmentVariable("TOKEN_SECRET");
        return !string.IsNullOrWhiteSpace(envSecret) ? envSecret : LocalSecrets.TokenSecret;
    }

    public static bool IsConfigured() => Create() is not null;

    /// <summary>The store for the resolved credentials, or null when they are unusable, which includes unfilled placeholders.</summary>
    public static KeyStore? Create()
    {
        var url = GetDatabaseUrl();
        var secret = GetTokenSecret();
        return IsPostgresUrl(url) && secret.Length >= MinSecretLength ? new KeyStore(url, secret) : null;
    }

    private static bool IsPostgresUrl(string url) =>
        Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri) && uri.Scheme is "postgres" or "postgresql";

    /// <summary>Null when the key is saved, otherwise a message for the screen. Driver errors are not shown because they can quote the connection details.</summary>
    public async Task<string?> SaveAsync(GeneratedKey key)
    {
        string connectionString;
        try
        {
            connectionString = ToConnectionString(_databaseUrl);
        }
        catch (Exception e) when (e is FormatException or ArgumentException)
        {
            return NotConnected;
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand("INSERT INTO setup_keys (key_hash, expires_at, license_days) VALUES ($1, now() + interval '7 days', $2)", connection);
            command.Parameters.Add(new NpgsqlParameter { Value = HashKey(key.Key, _tokenSecret) });
            command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Integer, Value = (object?)key.LicenseDays ?? DBNull.Value });
            await command.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException e) when (e.SqlState == UndefinedColumn)
        {
            return MissingColumn;
        }
        catch (Exception)
        {
            return NotSaved;
        }
    }

    /// <summary>Must match hashToken in server/lib/auth.js. The key is hashed in its dashed uppercase form, as normaliseSetupKey produces it.</summary>
    internal static string HashKey(string key, string secret) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    /// <summary>Npgsql does not read postgresql:// URLs, which is the form Neon and Vercel use.</summary>
    internal static string ToConnectionString(string url)
    {
        var uri = new Uri(url.Trim());
        if (uri.Scheme is not ("postgres" or "postgresql"))
        {
            throw new FormatException("Not a Postgres URL.");
        }

        var credentials = uri.UserInfo.Split(':', 2);
        var query = HttpUtility.ParseQueryString(uri.Query);
        return new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : null,
            SslMode = query["sslmode"] switch
            {
                "disable" => SslMode.Disable,
                "verify-ca" => SslMode.VerifyCA,
                "verify-full" => SslMode.VerifyFull,
                _ => SslMode.Require,
            },
            ChannelBinding = query["channel_binding"] == "require" ? ChannelBinding.Require : ChannelBinding.Prefer,
            Timeout = TimeoutSeconds,
            CommandTimeout = TimeoutSeconds,
            Pooling = false,
        }.ConnectionString;
    }
}
