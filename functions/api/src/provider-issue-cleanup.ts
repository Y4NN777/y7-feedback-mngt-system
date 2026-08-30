import type { TablesDB } from "node-appwrite";

import { createAppwriteProviderGrantVault } from "./appwrite-provider-grant-vault.js";

export async function closeProviderIssue(input: {
  readonly tables: TablesDB;
  readonly databaseId: string;
  readonly providerGrantsTableId: string;
  readonly providerGrantEnvelopeKey: string;
  readonly provider: "github" | "gitlab";
  readonly providerGrantRef: string;
  readonly repository: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
  };
  readonly issueUrl: string;
  readonly gitlabOrigin: string;
}): Promise<void> {
  const material = await createAppwriteProviderGrantVault(
    {
      createRow: (request) =>
        input.tables.createRow({ ...request, permissions: [...request.permissions] }),
      getRow: (request) => input.tables.getRow(request),
      deleteRow: (request) => input.tables.deleteRow(request),
    },
    {
      databaseId: input.databaseId,
      providerGrantsTableId: input.providerGrantsTableId,
    },
    Buffer.from(input.providerGrantEnvelopeKey, "base64url"),
  ).open(input.provider, input.providerGrantRef);
  let issueUrl: URL;
  try {
    issueUrl = new URL(input.issueUrl);
  } catch {
    throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
  }
  if (input.provider === "github") {
    const parts = issueUrl.pathname.split("/").filter(Boolean);
    const issueNumber = parts[3];
    if (
      issueUrl.protocol !== "https:" ||
      issueUrl.hostname !== "github.com" ||
      parts.length !== 4 ||
      parts[0] !== input.repository.owner ||
      parts[1] !== input.repository.name ||
      parts[2] !== "issues" ||
      !issueNumber ||
      !/^\d+$/u.test(issueNumber)
    ) {
      throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
    }
    const closed = await fetch(
      new URL(
        `https://api.github.com/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}/issues/${issueNumber}`,
      ),
      {
        method: "PATCH",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${material.accessToken}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (closed.status !== 200) {
      throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
    }
    return;
  }
  const origin = new URL(input.gitlabOrigin.replace(/\/?$/u, "/"));
  const issuePath = `api/v4/projects/${encodeURIComponent(input.repository.id)}/issues`;
  const issueNumber = issueUrl.pathname.split("/").filter(Boolean).at(-1);
  if (
    issueUrl.protocol !== origin.protocol ||
    issueUrl.host !== origin.host ||
    !issueNumber ||
    !/^\d+$/u.test(issueNumber)
  ) {
    throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
  }
  const closed = await fetch(new URL(`${issuePath}/${issueNumber}`, origin), {
    method: "PUT",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${material.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ state_event: "close" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (closed.status !== 200) {
    throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
  }
}
