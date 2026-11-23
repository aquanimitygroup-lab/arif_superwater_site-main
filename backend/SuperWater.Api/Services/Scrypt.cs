using System.Buffers.Binary;
using System.Security.Cryptography;

namespace SuperWater.Api.Services;

/// <summary>
/// scrypt (RFC 7914) with the same defaults as Node's crypto.scryptSync
/// (N = 16384, r = 8, p = 1), so password hashes are interchangeable with the
/// original site: "scrypt$&lt;salt base64&gt;$&lt;hash base64&gt;".
/// </summary>
public static class Scrypt
{
    public static byte[] Derive(byte[] password, byte[] salt, int dkLen, int N = 16384, int r = 8, int p = 1)
    {
        var blockSize = 128 * r;
        var B = Rfc2898DeriveBytes.Pbkdf2(password, salt, 1, HashAlgorithmName.SHA256, p * blockSize);
        var X = new uint[32 * r];
        var V = new uint[32 * r * N];
        var Y = new uint[32 * r];
        for (var i = 0; i < p; i++)
        {
            var off = i * blockSize;
            for (var k = 0; k < 32 * r; k++) X[k] = BinaryPrimitives.ReadUInt32LittleEndian(B.AsSpan(off + k * 4));
            RoMix(X, V, Y, N, r);
            for (var k = 0; k < 32 * r; k++) BinaryPrimitives.WriteUInt32LittleEndian(B.AsSpan(off + k * 4), X[k]);
        }
        return Rfc2898DeriveBytes.Pbkdf2(password, B, 1, HashAlgorithmName.SHA256, dkLen);
    }

    private static void RoMix(uint[] X, uint[] V, uint[] Y, int N, int r)
    {
        var len = 32 * r;
        for (var i = 0; i < N; i++)
        {
            Array.Copy(X, 0, V, i * len, len);
            BlockMix(X, Y, r);
        }
        for (var i = 0; i < N; i++)
        {
            var j = (int)(X[(2 * r - 1) * 16] & (uint)(N - 1));
            var vOff = j * len;
            for (var k = 0; k < len; k++) X[k] ^= V[vOff + k];
            BlockMix(X, Y, r);
        }
    }

    private static void BlockMix(uint[] B, uint[] Y, int r)
    {
        Span<uint> x = stackalloc uint[16];
        B.AsSpan((2 * r - 1) * 16, 16).CopyTo(x);
        for (var i = 0; i < 2 * r; i++)
        {
            for (var k = 0; k < 16; k++) x[k] ^= B[i * 16 + k];
            Salsa208(x);
            // even blocks go to the first half, odd blocks to the second half
            var dest = (i / 2 + (i % 2) * r) * 16;
            x.CopyTo(Y.AsSpan(dest, 16));
        }
        Array.Copy(Y, B, 32 * r);
    }

    private static uint R(uint a, int b) => (a << b) | (a >> (32 - b));

    private static void Salsa208(Span<uint> B)
    {
        uint x0 = B[0], x1 = B[1], x2 = B[2], x3 = B[3], x4 = B[4], x5 = B[5], x6 = B[6], x7 = B[7],
             x8 = B[8], x9 = B[9], x10 = B[10], x11 = B[11], x12 = B[12], x13 = B[13], x14 = B[14], x15 = B[15];
        for (var i = 0; i < 8; i += 2)
        {
            x4 ^= R(x0 + x12, 7); x8 ^= R(x4 + x0, 9); x12 ^= R(x8 + x4, 13); x0 ^= R(x12 + x8, 18);
            x9 ^= R(x5 + x1, 7); x13 ^= R(x9 + x5, 9); x1 ^= R(x13 + x9, 13); x5 ^= R(x1 + x13, 18);
            x14 ^= R(x10 + x6, 7); x2 ^= R(x14 + x10, 9); x6 ^= R(x2 + x14, 13); x10 ^= R(x6 + x2, 18);
            x3 ^= R(x15 + x11, 7); x7 ^= R(x3 + x15, 9); x11 ^= R(x7 + x3, 13); x15 ^= R(x11 + x7, 18);
            x1 ^= R(x0 + x3, 7); x2 ^= R(x1 + x0, 9); x3 ^= R(x2 + x1, 13); x0 ^= R(x3 + x2, 18);
            x6 ^= R(x5 + x4, 7); x7 ^= R(x6 + x5, 9); x4 ^= R(x7 + x6, 13); x5 ^= R(x4 + x7, 18);
            x11 ^= R(x10 + x9, 7); x8 ^= R(x11 + x10, 9); x9 ^= R(x8 + x11, 13); x10 ^= R(x9 + x8, 18);
            x12 ^= R(x15 + x14, 7); x13 ^= R(x12 + x15, 9); x14 ^= R(x13 + x12, 13); x15 ^= R(x14 + x13, 18);
        }
        B[0] += x0; B[1] += x1; B[2] += x2; B[3] += x3; B[4] += x4; B[5] += x5; B[6] += x6; B[7] += x7;
        B[8] += x8; B[9] += x9; B[10] += x10; B[11] += x11; B[12] += x12; B[13] += x13; B[14] += x14; B[15] += x15;
    }
}
