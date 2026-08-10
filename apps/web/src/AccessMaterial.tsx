import { useState } from "react";

import type { Locale } from "@y7-feedback/domain";

import { accessMessages } from "./i18n/access";

export function AccessMaterial({
  accessProof,
  locale,
  reference,
}: {
  readonly accessProof: string;
  readonly locale: Locale;
  readonly reference: string;
}) {
  const copy = accessMessages[locale];
  const [proofVisible, setProofVisible] = useState(false);

  return (
    <section className="access-material" aria-labelledby="accepted-title">
      <p className="eyebrow">Y7 Feedback</p>
      <h1 id="accepted-title">{copy.acceptedTitle}</h1>
      <p>{copy.acceptedHint}</p>
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
        </div>
      </div>
      <p className="preservation-note">{copy.preserve}</p>
    </section>
  );
}
