import { useState } from "react";

import type { Locale } from "@y7-feedback/domain";

import { accessMessages } from "./i18n/access";

export function AccessMaterial({
  accessProof,
  locale,
  preservationNote,
  reference,
}: {
  readonly accessProof: string;
  readonly locale: Locale;
  readonly preservationNote?: string;
  readonly reference: string;
}) {
  const copy = accessMessages[locale];
  const [proofVisible, setProofVisible] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);

  async function copyProof() {
    try {
      await navigator.clipboard.writeText(accessProof);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="access-material-fields">
      <div className="access-pair">
        <label className="field">
          <span>{copy.reference}</span>
          <input readOnly value={reference} />
        </label>
        <div className="field">
          <label htmlFor="issued-access-proof">{copy.accessProofConfidential}</label>
          <input
            id="issued-access-proof"
            readOnly
            type={proofVisible ? "text" : "password"}
            value={accessProof}
          />
          <button
            className="text-action"
            type="button"
            onClick={() => {
              setProofVisible((current) => !current);
            }}
          >
            {proofVisible ? copy.hideProof : copy.showProof}
          </button>
          <button
            className="text-action"
            type="button"
            onClick={() => void copyProof()}
          >
            {copy.copyProof}
          </button>
        </div>
      </div>
      <p className="preservation-note">{preservationNote ?? copy.preserve}</p>
      {copyStatus === null ? null : (
        <p role="status">
          {copyStatus === "copied" ? copy.copiedProof : copy.copyFailed}
        </p>
      )}
    </div>
  );
}
