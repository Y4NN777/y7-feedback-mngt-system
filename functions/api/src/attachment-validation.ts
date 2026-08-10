import { createHash } from "node:crypto";

export type AttachmentFormat = "jpeg" | "png" | "webp" | "gif" | "pdf" | "txt" | "csv";

export interface AttachmentCandidate {
  readonly bytes: Uint8Array;
  readonly clientName: string;
  readonly clientMediaType: string;
}

export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<"clean" | "infected" | "unavailable">;
}

export interface ValidatedAttachmentMetadata {
  readonly format: AttachmentFormat;
  readonly mediaType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif"
    | "application/pdf"
    | "text/plain; charset=utf-8"
    | "text/csv; charset=utf-8";
  readonly size: number;
  readonly sha256: string;
  readonly displayName: string;
}

export type AttachmentValidationOutcome =
  | { readonly status: "accepted"; readonly metadata: ValidatedAttachmentMetadata }
  | { readonly status: "rejected"; readonly code: "ATTACHMENT_REJECTED" }
  | { readonly status: "retryable"; readonly code: "VALIDATION_UNAVAILABLE" };

const maximumBytes = 10 * 1024 * 1024;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const jpegSignature = [0xff, 0xd8, 0xff] as const;
const gif87 = new TextEncoder().encode("GIF87a");
const gif89 = new TextEncoder().encode("GIF89a");
const pdfSignature = new TextEncoder().encode("%PDF-");
const riffSignature = new TextEncoder().encode("RIFF");
const webpSignature = new TextEncoder().encode("WEBP");

const prohibitedSignatures: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
  [0x1f, 0x8b],
  [0x52, 0x61, 0x72, 0x21],
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xfe, 0xed, 0xfa, 0xcf],
];

const executableText =
  /(?:^#!\s*\/|<\s*script\b|javascript\s*:|\b(?:eval|function)\s*\()/iu;

function hasUnsafeControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
      return true;
    }
  }
  return false;
}

function startsWith(
  bytes: Uint8Array,
  signature: ArrayLike<number>,
  offset = 0,
): boolean {
  if (offset + signature.length > bytes.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function indexOf(bytes: Uint8Array, signature: ArrayLike<number>, from = 0): number {
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return haystack.indexOf(Buffer.from(Array.from(signature)), from);
}

function hasProhibitedSignature(bytes: Uint8Array): boolean {
  return prohibitedSignatures.some((signature) => indexOf(bytes, signature) >= 0);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= Number(bytes[offset]);
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 22 ||
    !startsWith(bytes, jpegSignature) ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return false;
  }
  const header = new TextDecoder("latin1").decode(bytes.slice(3, 20));
  return header.includes("JFIF\0") || header.includes("Exif\0");
}

function parsePng(bytes: Uint8Array): boolean {
  let offset = pngSignature.length;
  let chunkIndex = 0;
  let foundEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BigEndian(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (dataEnd + 4 > bytes.length) return false;
    const type = new TextDecoder("ascii").decode(bytes.slice(typeStart, dataStart));
    const storedCrc = readUint32BigEndian(bytes, crcOffset);
    if (crc32(bytes, typeStart, dataEnd) !== storedCrc) return false;
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) return false;
    offset = crcOffset + 4;
    chunkIndex += 1;
    if (type === "IEND") {
      foundEnd = length === 0 && offset === bytes.length;
      break;
    }
  }
  return foundEnd;
}

function parseWebp(bytes: Uint8Array): boolean {
  if (
    bytes.length < 20 ||
    !startsWith(bytes, riffSignature) ||
    !startsWith(bytes, webpSignature, 8) ||
    readUint32LittleEndian(bytes, 4) + 8 !== bytes.length
  ) {
    return false;
  }
  let offset = 12;
  let chunks = 0;
  while (offset + 8 <= bytes.length) {
    const type = new TextDecoder("ascii").decode(bytes.slice(offset, offset + 4));
    const length = readUint32LittleEndian(bytes, offset + 4);
    const next = offset + 8 + length + (length % 2);
    if (next > bytes.length || !["VP8 ", "VP8L", "VP8X"].includes(type)) return false;
    chunks += 1;
    offset = next;
  }
  return chunks > 0 && offset === bytes.length;
}

function parseGif(bytes: Uint8Array): boolean {
  if (
    bytes.length < 14 ||
    (!startsWith(bytes, gif87) && !startsWith(bytes, gif89)) ||
    bytes.at(-1) !== 0x3b
  ) {
    return false;
  }
  const dimensions = new DataView(bytes.buffer, bytes.byteOffset + 6, 4);
  const width = dimensions.getUint16(0, true);
  const height = dimensions.getUint16(2, true);
  return width > 0 && height > 0;
}

function parsePdf(bytes: Uint8Array): boolean {
  const content = new TextDecoder("latin1").decode(bytes);
  return (
    /^%PDF-1\.[0-7]/u.test(content) &&
    /\bobj\b/u.test(content) &&
    /\bendobj\b/u.test(content) &&
    /\bxref\b/u.test(content) &&
    /\btrailer\b/u.test(content) &&
    /\bstartxref\b/u.test(content) &&
    /%%EOF\s*$/u.test(content) &&
    !/(?:\/JavaScript|\/JS\b|\/Launch\b|\/EmbeddedFiles\b)/iu.test(content)
  );
}

function parseCsv(content: string): boolean {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content.charAt(index);
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (fieldStarted) throw new Error("CSV_INVALID");
      quoted = true;
      fieldStarted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
    } else {
      field += character;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error("CSV_INVALID");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const columns = rows.reduce((_prior, item) => item.length, 0);
  return (
    rows.length >= 2 && columns >= 2 && rows.every((item) => item.length === columns)
  );
}

function parseText(bytes: Uint8Array): "txt" | "csv" | null {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (!content || hasUnsafeControl(content)) {
    return null;
  }
  if (executableText.test(content)) return null;
  if (content.includes(",") || content.includes('"')) {
    return parseCsv(content) ? "csv" : "txt";
  }
  return "txt";
}

function hasAllowedPolyglot(bytes: Uint8Array, format: AttachmentFormat): boolean {
  const signatures: readonly [AttachmentFormat, ArrayLike<number>, number][] = [
    ["jpeg", jpegSignature, 0],
    ["png", pngSignature, 0],
    ["gif", gif87, 0],
    ["gif", gif89, 0],
    ["pdf", pdfSignature, 0],
    ["webp", riffSignature, 0],
  ];
  return signatures.some(
    ([candidateFormat, signature, offset]) =>
      candidateFormat !== format && indexOf(bytes, signature, offset) >= 0,
  );
}

function detectFormat(bytes: Uint8Array): AttachmentFormat | null {
  if (startsWith(bytes, jpegSignature)) return parseJpeg(bytes) ? "jpeg" : null;
  if (startsWith(bytes, pngSignature)) return parsePng(bytes) ? "png" : null;
  if (startsWith(bytes, riffSignature)) return parseWebp(bytes) ? "webp" : null;
  if (startsWith(bytes, gif87) || startsWith(bytes, gif89)) {
    return parseGif(bytes) ? "gif" : null;
  }
  if (startsWith(bytes, pdfSignature)) return parsePdf(bytes) ? "pdf" : null;
  return parseText(bytes);
}

const mediaTypes: Readonly<
  Record<AttachmentFormat, ValidatedAttachmentMetadata["mediaType"]>
> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

export async function validateAttachment(
  candidate: AttachmentCandidate,
  dependencies: { readonly malwareScanner: MalwareScanner },
): Promise<AttachmentValidationOutcome> {
  const displayName = candidate.clientName.trim();
  if (
    candidate.bytes.length === 0 ||
    candidate.bytes.length > maximumBytes ||
    !displayName ||
    displayName.length > 255 ||
    /[\\/]/u.test(displayName) ||
    hasUnsafeControl(displayName) ||
    hasProhibitedSignature(candidate.bytes)
  ) {
    return { status: "rejected", code: "ATTACHMENT_REJECTED" };
  }

  let format: AttachmentFormat | null;
  try {
    format = detectFormat(candidate.bytes);
  } catch {
    format = null;
  }
  if (!format || hasAllowedPolyglot(candidate.bytes, format)) {
    return { status: "rejected", code: "ATTACHMENT_REJECTED" };
  }

  let scan: "clean" | "infected" | "unavailable";
  try {
    scan = await dependencies.malwareScanner.scan(candidate.bytes);
  } catch {
    return { status: "retryable", code: "VALIDATION_UNAVAILABLE" };
  }
  if (scan === "unavailable") {
    return { status: "retryable", code: "VALIDATION_UNAVAILABLE" };
  }
  if (scan !== "clean") {
    return { status: "rejected", code: "ATTACHMENT_REJECTED" };
  }

  return {
    status: "accepted",
    metadata: {
      format,
      mediaType: mediaTypes[format],
      size: candidate.bytes.length,
      sha256: createHash("sha256").update(candidate.bytes).digest("base64url"),
      displayName,
    },
  };
}
