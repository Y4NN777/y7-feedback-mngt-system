import { describe, expect, it, vi } from "vitest";

import { runAppwriteAntivirusEvidence } from "./appwrite-antivirus-evidence.js";

function missing(): Error & { readonly code: 404 } {
  return Object.assign(new Error("missing"), { code: 404 as const });
}

describe("Appwrite antivirus evidence", () => {
  it("BDD-ATT-AV-001 proves clean acceptance, infected rejection, and zero residue", async () => {
    const files = new Map<string, Uint8Array>();
    const storage = {
      getBucket: vi.fn(() =>
        Promise.resolve({
          $permissions: [],
          fileSecurity: true,
          encryption: true,
          antivirus: true,
          maximumFileSize: 10 * 1024 * 1024,
        }),
      ),
      createFile: vi.fn(
        (input: {
          readonly fileId: string;
          readonly bytes: Uint8Array;
          readonly permissions: readonly string[];
        }) => {
          if (new TextDecoder().decode(input.bytes).includes("EICAR")) {
            return Promise.reject(
              Object.assign(new Error("virus detected"), {
                code: 500,
                type: "storage_file_virus_detected",
              }),
            );
          }
          files.set(input.fileId, input.bytes);
          return Promise.resolve();
        },
      ),
      getFile: vi.fn((input: { readonly fileId: string }) => {
        if (!files.has(input.fileId)) return Promise.reject(missing());
        return Promise.resolve();
      }),
      deleteFile: vi.fn((input: { readonly fileId: string }) => {
        files.delete(input.fileId);
        return Promise.resolve();
      }),
    };

    await expect(
      runAppwriteAntivirusEvidence(storage, {
        bucketId: "private_attachments",
        cleanFileId: "av_clean_probe",
        infectedFileId: "av_infected_probe",
      }),
    ).resolves.toEqual({
      bucketPolicy: "verified",
      cleanUpload: "accepted_and_removed",
      infectedUpload: "rejected_without_residue",
    });
    expect(files.size).toBe(0);
  });

  it("BDD-ATT-AV-002 fails closed when bucket antivirus policy is absent", async () => {
    const storage = {
      getBucket: () =>
        Promise.resolve({
          $permissions: [],
          fileSecurity: true,
          encryption: true,
          antivirus: false,
          maximumFileSize: 10 * 1024 * 1024,
        }),
      createFile: vi.fn(),
      getFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    await expect(
      runAppwriteAntivirusEvidence(storage, {
        bucketId: "private_attachments",
        cleanFileId: "av_clean_probe",
        infectedFileId: "av_infected_probe",
      }),
    ).rejects.toThrow("APPWRITE_ANTIVIRUS_BUCKET_POLICY_INVALID");
    expect(storage.createFile).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {
      $permissions: [],
      fileSecurity: false,
      encryption: true,
      antivirus: true,
      maximumFileSize: 10 * 1024 * 1024,
    },
    {
      $permissions: [],
      fileSecurity: true,
      encryption: false,
      antivirus: true,
      maximumFileSize: 10 * 1024 * 1024,
    },
    {
      $permissions: [],
      fileSecurity: true,
      encryption: true,
      antivirus: true,
      maximumFileSize: 1,
    },
    {
      $permissions: "private",
      fileSecurity: true,
      encryption: true,
      antivirus: true,
      maximumFileSize: 10 * 1024 * 1024,
    },
    {
      $permissions: ["read(any)"],
      fileSecurity: true,
      encryption: true,
      antivirus: true,
      maximumFileSize: 10 * 1024 * 1024,
    },
  ])("rejects each unsafe bucket policy variant %#", async (bucket) => {
    await expect(
      runAppwriteAntivirusEvidence(
        {
          getBucket: () => Promise.resolve(bucket),
          createFile: vi.fn(),
          getFile: vi.fn(),
          deleteFile: vi.fn(),
        },
        {
          bucketId: "private_attachments",
          cleanFileId: "av_clean_probe",
          infectedFileId: "av_infected_probe",
        },
      ),
    ).rejects.toThrow("APPWRITE_ANTIVIRUS_BUCKET_POLICY_INVALID");
  });

  it("BDD-ATT-AV-003 removes a clean probe when readback fails", async () => {
    let present = false;
    const storage = {
      getBucket: () =>
        Promise.resolve({
          $permissions: [],
          fileSecurity: true,
          encryption: true,
          antivirus: true,
          maximumFileSize: 10 * 1024 * 1024,
        }),
      createFile: () => {
        present = true;
        return Promise.resolve();
      },
      getFile: () =>
        present
          ? Promise.reject(new Error("readback failed"))
          : Promise.reject(missing()),
      deleteFile: () => {
        present = false;
        return Promise.resolve();
      },
    };

    await expect(
      runAppwriteAntivirusEvidence(storage, {
        bucketId: "private_attachments",
        cleanFileId: "av_clean_probe",
        infectedFileId: "av_infected_probe",
      }),
    ).rejects.toThrow("readback failed");
    expect(present).toBe(false);
  });

  it("rejects an infected upload accepted by the backing service after cleanup", async () => {
    const files = new Set<string>();
    await expect(
      runAppwriteAntivirusEvidence(
        {
          getBucket: () =>
            Promise.resolve({
              $permissions: [],
              fileSecurity: true,
              encryption: true,
              antivirus: true,
              maximumFileSize: 10 * 1024 * 1024,
            }),
          createFile: ({ fileId }) => {
            files.add(fileId);
            return Promise.resolve();
          },
          getFile: ({ fileId }) =>
            files.has(fileId) ? Promise.resolve() : Promise.reject(missing()),
          deleteFile: ({ fileId }) => {
            files.delete(fileId);
            return Promise.resolve();
          },
        },
        {
          bucketId: "private_attachments",
          cleanFileId: "av_clean_probe",
          infectedFileId: "av_infected_probe",
        },
      ),
    ).rejects.toThrow("APPWRITE_ANTIVIRUS_INFECTED_UPLOAD_ACCEPTED");
    expect(files.size).toBe(0);
  });

  it.each([
    [() => Promise.resolve(), "APPWRITE_ANTIVIRUS_RESIDUE_DETECTED"],
    [() => Promise.reject(new Error("storage unavailable")), "storage unavailable"],
  ] as const)(
    "fails when cleanup absence cannot be proved %#",
    async (absence, error) => {
      let read = 0;
      await expect(
        runAppwriteAntivirusEvidence(
          {
            getBucket: () =>
              Promise.resolve({
                $permissions: [],
                fileSecurity: true,
                encryption: true,
                antivirus: true,
                maximumFileSize: 10 * 1024 * 1024,
              }),
            createFile: () => Promise.resolve(),
            getFile: () => (++read === 1 ? Promise.resolve() : absence()),
            deleteFile: () => Promise.resolve(),
          },
          {
            bucketId: "private_attachments",
            cleanFileId: "av_clean_probe",
            infectedFileId: "av_infected_probe",
          },
        ),
      ).rejects.toThrow(error);
    },
  );

  it("does not run cleanup when clean staging never succeeds", async () => {
    const deleteFile = vi.fn();
    await expect(
      runAppwriteAntivirusEvidence(
        {
          getBucket: () =>
            Promise.resolve({
              $permissions: [],
              fileSecurity: true,
              encryption: true,
              antivirus: true,
              maximumFileSize: 10 * 1024 * 1024,
            }),
          createFile: () => Promise.reject(new Error("staging failed")),
          getFile: vi.fn(),
          deleteFile,
        },
        {
          bucketId: "private_attachments",
          cleanFileId: "av_clean_probe",
          infectedFileId: "av_infected_probe",
        },
      ),
    ).rejects.toThrow("staging failed");
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
