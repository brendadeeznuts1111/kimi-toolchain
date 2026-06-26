/**
 * Bun-native compression helpers for gzip, deflate, and zstd.
 *
 * This module is intentionally synchronous-first for small CLI/report payloads. Use the zstd async
 * helpers for large payloads that should not block the event loop.
 */

export type ZlibCompressionOptions = {
  level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  memLevel?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  windowBits?:
    | -9
    | -10
    | -11
    | -12
    | -13
    | -14
    | -15
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15
    | 25
    | 26
    | 27
    | 28
    | 29
    | 30
    | 31;
  strategy?: 0 | 1 | 2 | 3 | 4;
};

export type ZstdCompressionOptions = {
  /** 1 = fastest, 22 = best compression. Bun's default is 3. */
  level?:
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15
    | 16
    | 17
    | 18
    | 19
    | 20
    | 21
    | 22;
};

export type CompressionAlgorithm = "gzip" | "deflate" | "zstd";
export type CompressionPriority = "speed" | "ratio" | "balanced";

export const GzipPresets = {
  STREAM: { level: 1, memLevel: 9, windowBits: 25, strategy: 0 },
  BALANCED: { level: 6, memLevel: 8, windowBits: 25, strategy: 0 },
  ARCHIVE: { level: 9, memLevel: 9, windowBits: 25, strategy: 0 },
  IMAGE: { level: 4, memLevel: 8, windowBits: 25, strategy: 3 },
  STORE: { level: 0, memLevel: 8, windowBits: 25, strategy: 0 },
} as const satisfies Record<string, ZlibCompressionOptions>;

export const DeflatePresets = {
  STREAM: { level: 1, memLevel: 9, windowBits: -15, strategy: 0 },
  BALANCED: { level: 6, memLevel: 8, windowBits: 15, strategy: 0 },
  ARCHIVE: { level: 9, memLevel: 9, windowBits: 15, strategy: 0 },
} as const satisfies Record<string, ZlibCompressionOptions>;

export const ZstdPresets = {
  FAST: { level: 1 },
  BALANCED: { level: 3 },
  DEFAULT: { level: 3 },
  COMPACT: { level: 6 },
  ARCHIVE: { level: 19 },
  MAX: { level: 22 },
} as const satisfies Record<string, ZstdCompressionOptions>;

export type GzipPreset = keyof typeof GzipPresets;
export type DeflatePreset = keyof typeof DeflatePresets;
export type ZstdPreset = keyof typeof ZstdPresets;

const SMALL_INPUT_BYTES = 1024;
const LARGE_INPUT_BYTES = 10 * 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBytes(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof data === "string") return textEncoder.encode(data) as Uint8Array<ArrayBuffer>;
  return Uint8Array.from(data) as Uint8Array<ArrayBuffer>;
}

function ratio(outputBytes: number, inputBytes: number): number {
  return inputBytes === 0 ? 1 : outputBytes / inputBytes;
}

export function compressGzip(
  data: string | Uint8Array,
  preset: GzipPreset = "BALANCED"
): Uint8Array {
  return Bun.gzipSync(toBytes(data), GzipPresets[preset]);
}

export function decompressGzip(data: Uint8Array): Uint8Array {
  return Bun.gunzipSync(toBytes(data));
}

export function compressDeflate(
  data: string | Uint8Array,
  preset: DeflatePreset = "BALANCED"
): Uint8Array {
  return Bun.deflateSync(toBytes(data), DeflatePresets[preset]);
}

export function decompressDeflate(data: Uint8Array): Uint8Array {
  return Bun.inflateSync(toBytes(data));
}

export function compressZstd(
  data: string | Uint8Array,
  preset: ZstdPreset = "BALANCED"
): Uint8Array {
  return Bun.zstdCompressSync(toBytes(data), ZstdPresets[preset]);
}

export function decompressZstd(data: Uint8Array): Uint8Array {
  return Bun.zstdDecompressSync(toBytes(data));
}

export async function compressZstdAsync(
  data: string | Uint8Array,
  preset: ZstdPreset = "BALANCED"
): Promise<Uint8Array> {
  return Bun.zstdCompress(toBytes(data), ZstdPresets[preset]);
}

export async function decompressZstdAsync(data: Uint8Array): Promise<Uint8Array> {
  return Bun.zstdDecompress(toBytes(data));
}

export interface AutoCompressResult {
  algorithm: CompressionAlgorithm;
  preset: string;
  compressed: Uint8Array;
  ratio: number;
  ns: number;
}

function timedCompress(
  bytes: Uint8Array,
  algorithm: CompressionAlgorithm,
  preset: string,
  fn: (data: Uint8Array) => Uint8Array
): AutoCompressResult {
  const start = Bun.nanoseconds();
  const compressed = fn(bytes);
  const ns = Bun.nanoseconds() - start;
  return {
    algorithm,
    preset,
    compressed,
    ratio: ratio(compressed.length, bytes.length),
    ns,
  };
}

export function autoCompress(
  data: string | Uint8Array,
  priority: CompressionPriority = "balanced"
): AutoCompressResult {
  const bytes = toBytes(data);
  const size = bytes.length;

  if (size < SMALL_INPUT_BYTES) {
    return timedCompress(bytes, "gzip", "BALANCED", (input) => compressGzip(input, "BALANCED"));
  }

  if (size > LARGE_INPUT_BYTES) {
    const preset = priority === "speed" ? "FAST" : "COMPACT";
    return timedCompress(bytes, "zstd", preset, (input) => compressZstd(input, preset));
  }

  const candidates = [
    timedCompress(bytes, "gzip", "BALANCED", (input) => compressGzip(input, "BALANCED")),
    timedCompress(bytes, "deflate", "BALANCED", (input) => compressDeflate(input, "BALANCED")),
    timedCompress(bytes, "zstd", "BALANCED", (input) => compressZstd(input, "BALANCED")),
  ];

  const scored = candidates.map((candidate) => ({
    ...candidate,
    score:
      priority === "ratio"
        ? candidate.ratio
        : priority === "speed"
          ? candidate.ns
          : candidate.ratio * 0.6 + (candidate.ns / 1_000_000) * 0.4,
  }));
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) throw new Error("No compression candidates produced");
  return best;
}

export interface CompressionBenchmark {
  algorithm: CompressionAlgorithm;
  preset: string;
  inputBytes: number;
  outputBytes: number;
  ratioPercent: number;
  ns: number;
  ms: number;
  throughputMbps: number;
}

export function benchmarkAlgorithm(
  data: string | Uint8Array,
  algorithm: CompressionAlgorithm,
  preset: string
): CompressionBenchmark {
  const bytes = toBytes(data);
  const start = Bun.nanoseconds();
  let compressed: Uint8Array;

  switch (algorithm) {
    case "gzip":
      compressed = compressGzip(bytes, preset as GzipPreset);
      break;
    case "deflate":
      compressed = compressDeflate(bytes, preset as DeflatePreset);
      break;
    case "zstd":
      compressed = compressZstd(bytes, preset as ZstdPreset);
      break;
  }

  const ns = Bun.nanoseconds() - start;
  const seconds = ns / 1_000_000_000;
  return {
    algorithm,
    preset,
    inputBytes: bytes.length,
    outputBytes: compressed.length,
    ratioPercent: Number((ratio(compressed.length, bytes.length) * 100).toFixed(1)),
    ns,
    ms: Number((ns / 1_000_000).toFixed(3)),
    throughputMbps:
      seconds === 0 ? 0 : Number(((bytes.length / seconds / (1024 * 1024)) * 8).toFixed(1)),
  };
}

export function benchmarkAll(data: string | Uint8Array): CompressionBenchmark[] {
  return [
    benchmarkAlgorithm(data, "gzip", "BALANCED"),
    benchmarkAlgorithm(data, "deflate", "BALANCED"),
    benchmarkAlgorithm(data, "zstd", "BALANCED"),
    benchmarkAlgorithm(data, "zstd", "FAST"),
    benchmarkAlgorithm(data, "gzip", "STREAM"),
  ];
}

export function isValidGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

export function isValidZlib(data: Uint8Array): boolean {
  return (
    data.length >= 2 &&
    data[0] === 0x78 &&
    (data[1] === 0x01 || data[1] === 0x5e || data[1] === 0x9c || data[1] === 0xda)
  );
}

export function isValidZstd(data: Uint8Array): boolean {
  return (
    data.length >= 4 && data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd
  );
}

export function detectFormat(data: Uint8Array): CompressionAlgorithm | "unknown" {
  if (isValidGzip(data)) return "gzip";
  if (isValidZstd(data)) return "zstd";
  if (isValidZlib(data)) return "deflate";
  return "unknown";
}

export interface AuditReportEnvelope {
  findings: unknown[];
  meta: {
    service: string;
    ts: string;
    version: string;
  };
}

export function exportAuditReport(
  findings: unknown[],
  algorithm: CompressionAlgorithm = "zstd"
): Uint8Array {
  const payload = JSON.stringify({
    findings,
    meta: {
      service: String((globalThis as { SERVICE_ID?: unknown }).SERVICE_ID ?? "unknown"),
      ts: new Date().toISOString(),
      version: Bun.env.npm_package_version ?? "dev",
    },
  } satisfies AuditReportEnvelope);

  switch (algorithm) {
    case "gzip":
      return compressGzip(payload, "BALANCED");
    case "deflate":
      return compressDeflate(payload, "BALANCED");
    case "zstd":
      return compressZstd(payload, "BALANCED");
  }
}

export function parseAuditReport(data: Uint8Array): AuditReportEnvelope {
  const format = detectFormat(data);
  let decompressed: Uint8Array;

  switch (format) {
    case "gzip":
      decompressed = decompressGzip(data);
      break;
    case "deflate":
      decompressed = decompressDeflate(data);
      break;
    case "zstd":
      decompressed = decompressZstd(data);
      break;
    default:
      try {
        decompressed = decompressDeflate(data);
      } catch {
        throw new Error(`Unknown compression format: ${format}`);
      }
  }

  return JSON.parse(textDecoder.decode(decompressed)) as AuditReportEnvelope;
}
