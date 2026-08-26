import type { ClamAvVerdict } from "./gateway.js";

export type ClamdExchange = (frames: readonly Uint8Array[]) => Promise<Uint8Array>;

function frames(bytes: Uint8Array): readonly Uint8Array[] {
  const output: Uint8Array[] = [new TextEncoder().encode("zINSTREAM\0")];
  const chunkSize = 64 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, chunk.byteLength);
    output.push(length, chunk);
  }
  output.push(new Uint8Array(4));
  return output;
}

export function createClamdScanner(
  exchange: ClamdExchange,
): (bytes: Uint8Array) => Promise<ClamAvVerdict> {
  return async (bytes) => {
    try {
      const response = new TextDecoder().decode(await exchange(frames(bytes)));
      if (response === "stream: OK\0") return "clean";
      if (/^stream: .+ FOUND\0$/u.test(response)) return "infected";
    } catch {
      // Transport and protocol details stay inside the scanner boundary.
    }
    return "unavailable";
  };
}
