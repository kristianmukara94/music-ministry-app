using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace ChurchKeyGen;

/// <summary>Order matches the items in the duration dropdown in MainWindow.xaml.</summary>
public enum Validity
{
    Days30,
    Days90,
    OneYear,
    Lifetime,
}

/// <summary>A null LicenseDays means a perpetual licence.</summary>
public sealed record GeneratedKey(string Key, int? LicenseDays);

/// <summary>
/// Setup keys in the same form as generateSetupKey in shared/church-key-generator.js: eleven random characters and a check character.
/// The charset, salt and calculation must stay identical to that file, or the desktop app refuses these keys.
/// </summary>
public static class KeyEngine
{
    public const int MaxCodeLength = 64;

    // No 0, O, 1, I or L.
    private const string Charset = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    private const int KeyChars = 12;

    // Public by design: the desktop app holds it too, and the check character only catches typing mistakes. A key is proven by its hash in setup_keys.
    private const string PublicSalt = "apccmma-sanctuary-master-salt-2026";

    private static readonly Regex CodePattern = new(@"\A[A-Z0-9]+(?:-[A-Z0-9]+)*\z", RegexOptions.CultureInvariant);

    public static string NormalizeCode(string input) => input.Trim().ToUpperInvariant();

    /// <summary>Expects a code already passed through <see cref="NormalizeCode"/>.</summary>
    public static bool IsValidCode(string code) => code.Length <= MaxCodeLength && CodePattern.IsMatch(code);

    /// <summary>The value for setup_keys.license_days.</summary>
    public static int? LicenseDays(Validity validity) => validity switch
    {
        Validity.Days30 => 30,
        Validity.Days90 => 90,
        Validity.OneYear => 365,
        Validity.Lifetime => null,
        _ => throw new ArgumentOutOfRangeException(nameof(validity)),
    };

    public static GeneratedKey Generate(Validity validity)
    {
        var payload = RandomNumberGenerator.GetString(Charset, KeyChars - 1);
        var key = payload + CheckChar(payload);
        return new GeneratedKey($"{key[..4]}-{key[4..8]}-{key[8..]}", LicenseDays(validity));
    }

    /// <summary>HMAC-SHA256 of the payload, the first four bytes read as a big-endian number, modulo the charset size.</summary>
    private static char CheckChar(string payload)
    {
        var digest = HMACSHA256.HashData(Encoding.UTF8.GetBytes(PublicSalt), Encoding.UTF8.GetBytes(payload));
        return Charset[(int)(BinaryPrimitives.ReadUInt32BigEndian(digest) % (uint)Charset.Length)];
    }
}
