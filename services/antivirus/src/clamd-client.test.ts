import { describe, expect, it, vi } from "vitest";

import { createClamdScanner } from "./clamd-client.js";

const bytes = new TextEncoder().encode("probe");

describe("ClamAV INSTREAM client", () => {
  it.each([
    ["stream: OK\0", "clean"],
    ["stream: Win.Test.EICAR_HDB-1 FOUND\0", "infected"],
    ["stream: size limit exceeded ERROR\0", "unavailable"],
  ] as const)("maps daemon response %s", async (response, expected) => {
    const exchange = vi.fn<(frames: readonly Uint8Array[]) => Promise<Uint8Array>>(() =>
      Promise.resolve(new TextEncoder().encode(response)),
    );
    const scan = createClamdScanner(exchange);
    await expect(scan(bytes)).resolves.toBe(expected);
    const frames = exchange.mock.calls[0]?.[0];
    expect(new TextDecoder().decode(frames?.[0])).toBe("zINSTREAM\0");
    expect(frames?.at(-1)).toEqual(new Uint8Array(4));
    expect(new DataView(frames?.[1]?.buffer as ArrayBuffer).getUint32(0)).toBe(
      bytes.byteLength,
    );
  });

  it("maps daemon transport failure to unavailable", async () => {
    const scan = createClamdScanner(() => Promise.reject(new Error("offline")));
    await expect(scan(bytes)).resolves.toBe("unavailable");
  });
});
