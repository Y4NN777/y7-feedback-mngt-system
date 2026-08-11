import { describe, expect, it, vi } from "vitest";

import {
  validateAttachment,
  type AttachmentCandidate,
  type MalwareScanner,
} from "./attachment-validation";

const cleanScanner: MalwareScanner = {
  scan: () => Promise.resolve("clean"),
};

function candidate(
  bytes: Uint8Array,
  clientName = "evidence.bin",
  clientMediaType = "application/octet-stream",
): AttachmentCandidate {
  return { bytes, clientName, clientMediaType };
}

const text = (value: string) => new TextEncoder().encode(value);
const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));
const webpFixture = (() => {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  return new Uint8Array(bytes);
})();

function rewritePngCrc(bytes: Uint8Array, chunkOffset: number): void {
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset + chunkOffset,
    4,
  ).getUint32(0, false);
  const start = chunkOffset + 4;
  const end = start + 4 + length;
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= Number(bytes[offset]);
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  new DataView(bytes.buffer, bytes.byteOffset + end, 4).setUint32(
    0,
    (crc ^ 0xffffffff) >>> 0,
    false,
  );
}

const fixtures = {
  jpeg: new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]),
  png: fromBase64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  webp: webpFixture,
  gif: fromBase64("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="),
  pdf: text(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R >>\nstartxref\n45\n%%EOF",
  ),
  txt: text("Retour utilisateur lisible.\nDeuxième ligne."),
  csv: text('name,value\n"budget, mensuel",42\nsolde,18\n'),
} as const;

describe("trusted Attachment content validation", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
    ["gif", "image/gif"],
    ["pdf", "application/pdf"],
    ["txt", "text/plain; charset=utf-8"],
    ["csv", "text/csv; charset=utf-8"],
  ] as const)(
    "BDD-ATT-001 derives %s from bytes, not client declarations",
    async (format, mediaType) => {
      const bytes = fixtures[format];

      const result = await validateAttachment(
        candidate(bytes, `misleading-${format}.zip`, "application/x-msdownload"),
        { malwareScanner: cleanScanner },
      );

      expect(result.status).toBe("accepted");
      if (result.status !== "accepted") throw new Error("expected accepted fixture");
      expect(result.metadata).toEqual({
        format,
        mediaType,
        size: bytes.length,
        sha256: result.metadata.sha256,
        displayName: `misleading-${format}.zip`,
      });
      expect(result.metadata.sha256).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    },
  );

  it("accepts exactly 10 MiB and rejects a larger file", async () => {
    const exact = new Uint8Array(10 * 1024 * 1024);
    exact.fill(0x61);
    const oversized = new Uint8Array(exact.length + 1);
    oversized.fill(0x61);

    const accepted = await validateAttachment(candidate(exact, "boundary.txt"), {
      malwareScanner: cleanScanner,
    });
    const rejected = await validateAttachment(candidate(oversized, "oversized.txt"), {
      malwareScanner: cleanScanner,
    });

    expect(accepted.status).toBe("accepted");
    if (accepted.status !== "accepted") throw new Error("expected boundary acceptance");
    expect(accepted.metadata.size).toBe(exact.length);
    expect(accepted.metadata.format).toBe("txt");
    expect(rejected).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
  });

  it.each([
    ["spoof", new Uint8Array([0x01, 0x02, 0xff, 0x03]), "photo.png", "image/png"],
    [
      "archive",
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
      "notes.txt",
      "text/plain",
    ],
    [
      "windows executable",
      new Uint8Array([0x4d, 0x5a, 1, 2, 3]),
      "photo.jpg",
      "image/jpeg",
    ],
    [
      "ELF executable",
      new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1]),
      "report.pdf",
      "application/pdf",
    ],
    ["invalid UTF-8", new Uint8Array([0xc3, 0x28]), "notes.txt", "text/plain"],
    ["binary text", new Uint8Array([0x61, 0x00, 0x62]), "notes.txt", "text/plain"],
    ["executable text", text("#!/bin/sh\necho unsafe"), "notes.txt", "text/plain"],
    ["HTML script", text("<script>alert(1)</script>"), "notes.txt", "text/plain"],
    ["empty", new Uint8Array(), "empty.txt", "text/plain"],
  ] as const)(
    "BDD-ATT-002 rejects %s with one safe outcome",
    async (_name, bytes, fileName, mediaType) => {
      expect(
        await validateAttachment(candidate(bytes, fileName, mediaType), {
          malwareScanner: cleanScanner,
        }),
      ).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    },
  );

  it("rejects malformed binary structures and a JPEG/archive polyglot", async () => {
    const malformed = [
      fixtures.jpeg.slice(0, -2),
      fixtures.png.slice(0, -3),
      fixtures.webp.slice(0, -2),
      fixtures.gif.slice(0, -1),
      text("%PDF-1.4\nmissing eof"),
      text('one,"unclosed\n'),
    ];
    const polyglot = new Uint8Array([
      ...fixtures.jpeg.slice(0, -2),
      0x50,
      0x4b,
      0x03,
      0x04,
      0xff,
      0xd9,
    ]);

    for (const bytes of [...malformed, polyglot]) {
      expect(
        await validateAttachment(candidate(bytes), { malwareScanner: cleanScanner }),
      ).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    }
  });

  it("covers alternate valid headers and rejects parser-level corruption", async () => {
    const exifJpeg = fixtures.jpeg.slice();
    exifJpeg.set(text("Exif\0"), 6);
    expect(
      (
        await validateAttachment(candidate(exifJpeg), {
          malwareScanner: cleanScanner,
        })
      ).status,
    ).toBe("accepted");

    const overflowPng = fixtures.png.slice();
    new DataView(overflowPng.buffer, overflowPng.byteOffset + 8, 4).setUint32(
      0,
      0xffffffff,
      false,
    );
    const corruptCrcPng = fixtures.png.slice();
    corruptCrcPng[29] = (corruptCrcPng[29] ?? 0) ^ 1;
    const wrongHeaderPng = fixtures.png.slice();
    wrongHeaderPng[12] = 0x58;
    rewritePngCrc(wrongHeaderPng, 8);
    const wrongChunkWebp = fixtures.webp.slice();
    wrongChunkWebp.set(text("BAD!"), 12);
    const allowedPolyglot = new Uint8Array([
      ...fixtures.jpeg.slice(0, -2),
      ...fixtures.gif,
      0xff,
      0xd9,
    ]);

    for (const bytes of [
      overflowPng,
      corruptCrcPng,
      wrongHeaderPng,
      wrongChunkWebp,
      allowedPolyglot,
    ]) {
      expect(
        await validateAttachment(candidate(bytes), { malwareScanner: cleanScanner }),
      ).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    }
  });

  it("parses escaped CSV without a terminal newline and treats prose commas as text", async () => {
    const escaped = await validateAttachment(
      candidate(text('name,value\nmessage,"say ""hello"""'), "escaped.csv"),
      { malwareScanner: cleanScanner },
    );
    const prose = await validateAttachment(
      candidate(text("Readable prose, but not a table."), "note.txt"),
      { malwareScanner: cleanScanner },
    );
    const midFieldQuote = await validateAttachment(
      candidate(text('name,value\nbad"quote,1'), "invalid.csv"),
      { malwareScanner: cleanScanner },
    );

    expect(escaped.status === "accepted" ? escaped.metadata.format : null).toBe("csv");
    expect(prose.status === "accepted" ? prose.metadata.format : null).toBe("txt");
    expect(midFieldQuote).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
  });

  it("rejects malware and treats scanner failure as retryable without metadata", async () => {
    const infected: MalwareScanner = { scan: () => Promise.resolve("infected") };
    const unavailable: MalwareScanner = { scan: () => Promise.resolve("unavailable") };
    const throwing: MalwareScanner = {
      scan: () => Promise.reject(new Error("scanner unavailable")),
    };

    expect(
      await validateAttachment(candidate(fixtures.png), { malwareScanner: infected }),
    ).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    expect(
      await validateAttachment(candidate(fixtures.png), {
        malwareScanner: unavailable,
      }),
    ).toEqual({ status: "retryable", code: "VALIDATION_UNAVAILABLE" });
    expect(
      await validateAttachment(candidate(fixtures.png), { malwareScanner: throwing }),
    ).toEqual({ status: "retryable", code: "VALIDATION_UNAVAILABLE" });
  });

  it("passes exact bytes to antivirus and rejects unsafe presentation names", async () => {
    const scan = vi.fn<MalwareScanner["scan"]>(() => Promise.resolve("clean"));
    const result = await validateAttachment(candidate(fixtures.gif, "../secret.gif"), {
      malwareScanner: { scan },
    });

    expect(result).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    expect(scan).not.toHaveBeenCalled();

    await validateAttachment(candidate(fixtures.gif, "evidence.gif"), {
      malwareScanner: { scan },
    });
    expect(scan).toHaveBeenCalledWith(fixtures.gif);
  });
});
