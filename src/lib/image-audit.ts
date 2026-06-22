/**
 * image-audit.ts — Bun.Image security checks for doctor gates.
 */
import { bunImageSupported, imageMetadata } from "./bun-image.ts";

const DEFAULT_MAX_DIMENSION = 4096;
const DEFAULT_MAX_PIXELS = 16_777_216;
const ENTROPY_THRESHOLD = 7.5;

export interface ImageAuditFinding {
  file: string;
  taxonomyId: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ImageAuditOptions {
  maxDimension?: number;
  maxPixels?: number;
  entropyCheck?: boolean;
  entropyThreshold?: number;
}

export interface AuditFileResult {
  file: string;
  findings: ImageAuditFinding[];
  meta?: { width: number; height: number; format: string } | null;
}

export function shannonEntropy(bytes: Uint8Array): number {
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]!]!++;
  let entropy = 0;
  const n = bytes.length;
  for (let i = 0; i < 256; i++) {
    if (counts[i] === 0) continue;
    const p = counts[i]! / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function decodeLatin1(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return text;
}

export function scanHeaderForSecrets(bytes: Uint8Array): string[] {
  const text = decodeLatin1(bytes.slice(0, 4096));
  const patterns = [/password/i, /secret/i, /api[_-]?key/i, /token/i];
  const hits: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) hits.push(`"${match[0].slice(0, 80)}"`);
  }
  return [...new Set(hits)];
}

export async function auditImageFile(
  filePath: string,
  options: ImageAuditOptions = {}
): Promise<AuditFileResult> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  const entropyThreshold = options.entropyThreshold ?? ENTROPY_THRESHOLD;
  const findings: ImageAuditFinding[] = [];

  if (!bunImageSupported()) {
    return { file: filePath, findings, meta: null };
  }

  const meta = await imageMetadata(filePath);
  if (!meta || meta.width <= 0 || meta.height <= 0) {
    findings.push({
      file: filePath,
      taxonomyId: "image_corrupt",
      message: `Corrupt or unparseable image: ${filePath}`,
    });
    return { file: filePath, findings, meta: meta ?? null };
  }

  if (meta.width > maxDimension || meta.height > maxDimension) {
    findings.push({
      file: filePath,
      taxonomyId: "image_oversized",
      message: `Image exceeds max dimension ${maxDimension}px: ${meta.width}×${meta.height}`,
    });
  }
  if (meta.width * meta.height > maxPixels) {
    findings.push({
      file: filePath,
      taxonomyId: "image_oversized",
      message: `Image exceeds max pixels ${maxPixels}: ${meta.width * meta.height} px`,
    });
  }

  if (options.entropyCheck) {
    try {
      const pixels = await new Bun.Image(filePath, { maxPixels })
        .resize(64, 64, { fit: "inside" })
        .bytes();
      const entropy = shannonEntropy(pixels);
      if (entropy > entropyThreshold) {
        findings.push({
          file: filePath,
          taxonomyId: "image_high_entropy",
          message: `High entropy (${entropy.toFixed(2)} bits/byte)`,
        });
      }
    } catch {
      // skip entropy on decode failure
    }
  }

  const fileBytes = await Bun.file(filePath).bytes();
  const headerHits = scanHeaderForSecrets(fileBytes);
  if (headerHits.length > 0) {
    findings.push({
      file: filePath,
      taxonomyId: "image_header_secrets",
      message: `Suspicious strings in file header: ${headerHits.join(", ")}`,
    });
  }

  return { file: filePath, findings, meta };
}

export async function auditImageAssets(
  options: {
    projectRoot?: string;
    files?: string[];
    entropyCheck?: boolean;
  } = {}
): Promise<{ findings: ImageAuditFinding[]; filesScanned: number }> {
  const files = options.files ?? [];
  const findings: ImageAuditFinding[] = [];
  for (const file of files) {
    const result = await auditImageFile(file, { entropyCheck: options.entropyCheck });
    findings.push(...result.findings);
  }
  return { findings, filesScanned: files.length };
}
