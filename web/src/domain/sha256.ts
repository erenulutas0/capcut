/**
 * SHA-256 that can be fed piece by piece (ADR-036).
 *
 * The browser's own `crypto.subtle.digest` wants the whole file in memory at
 * once; the speech model's files are up to 370 MB, and they are stored and
 * read back in parts. This is the plain FIPS 180-4 algorithm over 32-bit
 * words; the unit test compares it with Node's implementation on the same
 * bytes, split at awkward places.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

export class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private filled = 0;
  private bytes = 0;
  private done = false;

  update(data: Uint8Array): this {
    if (this.done) throw new Error('sha256: update after digest');
    this.bytes += data.length;
    let at = 0;
    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, data.length);
      this.block.set(data.subarray(0, take), this.filled);
      this.filled += take;
      at = take;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; at + 64 <= data.length; at += 64) this.compress(data, at);
    if (at < data.length) {
      this.block.set(data.subarray(at), 0);
      this.filled = data.length - at;
    }
    return this;
  }

  /** Lower-case hex, as the model list and Hugging Face write it. */
  digestHex(): string {
    if (!this.done) {
      this.done = true;
      const bits = this.bytes * 8;
      const pad = new Uint8Array(this.filled < 56 ? 64 : 128);
      pad.set(this.block.subarray(0, this.filled), 0);
      pad[this.filled] = 0x80;
      const view = new DataView(pad.buffer);
      // Lengths here stay far below 2^53 bits; the high word is exact.
      view.setUint32(pad.length - 8, Math.floor(bits / 0x1_0000_0000), false);
      view.setUint32(pad.length - 4, bits >>> 0, false);
      for (let at = 0; at < pad.length; at += 64) this.compress(pad, at);
    }
    let hex = '';
    for (const word of this.state) hex += word.toString(16).padStart(8, '0');
    return hex;
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.words;
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] =
        (((data[at] as number) << 24) |
          ((data[at + 1] as number) << 16) |
          ((data[at + 2] as number) << 8) |
          (data[at + 3] as number)) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    const s = this.state;
    let a = s[0] as number;
    let b = s[1] as number;
    let c = s[2] as number;
    let d = s[3] as number;
    let e = s[4] as number;
    let f = s[5] as number;
    let g = s[6] as number;
    let h = s[7] as number;
    for (let i = 0; i < 64; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    s[0] = ((s[0] as number) + a) >>> 0;
    s[1] = ((s[1] as number) + b) >>> 0;
    s[2] = ((s[2] as number) + c) >>> 0;
    s[3] = ((s[3] as number) + d) >>> 0;
    s[4] = ((s[4] as number) + e) >>> 0;
    s[5] = ((s[5] as number) + f) >>> 0;
    s[6] = ((s[6] as number) + g) >>> 0;
    s[7] = ((s[7] as number) + h) >>> 0;
  }
}

export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).digestHex();
}
