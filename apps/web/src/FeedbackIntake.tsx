import { useState, type SyntheticEvent } from "react";

import {
  validateFeedbackDraft,
  type FeedbackSource,
  type FeedbackType,
  type Locale,
  type ReporterAttribution,
  type ValidatedFeedbackDraft,
} from "@y7-feedback/domain";

import { intakeMessages } from "./i18n/intake";
import type { IntakeGateway, IntakeGatewayOutcome } from "./IntakeGateway";

interface FeedbackIntakeProps {
  readonly createOperationId: () => string;
  readonly gateway: IntakeGateway;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
}

interface DraftFields {
  readonly appreciation: string;
  readonly contact: string;
  readonly expected: string;
  readonly experience: string;
  readonly observed: string;
  readonly problem: string;
  readonly proposal: string;
  readonly rationale: string;
  readonly reproduction: string;
  readonly type: FeedbackType;
  readonly usageContext: string;
  readonly version: string;
}

const initialDraft: DraftFields = {
  appreciation: "",
  contact: "",
  expected: "",
  experience: "",
  observed: "",
  problem: "",
  proposal: "",
  rationale: "",
  reproduction: "",
  type: "bug",
  usageContext: "",
  version: "",
};

function optional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function sourceFrom(draft: DraftFields): FeedbackSource {
  if (draft.type === "bug") {
    const expectedBehavior = optional(draft.expected);
    const observedBehavior = optional(draft.observed);
    const reproductionSteps = optional(draft.reproduction);
    return {
      type: "bug",
      problem: draft.problem,
      ...(expectedBehavior ? { expectedBehavior } : {}),
      ...(observedBehavior ? { observedBehavior } : {}),
      ...(reproductionSteps ? { reproductionSteps } : {}),
    };
  }
  if (draft.type === "suggestion") {
    const usageContext = optional(draft.usageContext);
    return {
      type: "suggestion",
      proposal: draft.proposal,
      rationale: draft.rationale,
      ...(usageContext ? { usageContext } : {}),
    };
  }
  return {
    type: "review",
    experience: draft.experience,
    appreciation: draft.appreciation,
  };
}

function requiredError(draft: DraftFields, locale: Locale): string | null {
  const copy = intakeMessages[locale];
  if (draft.type === "bug" && !draft.problem.trim()) return copy.bugError;
  if (
    draft.type === "suggestion" &&
    (!draft.proposal.trim() || !draft.rationale.trim())
  ) {
    return copy.suggestionError;
  }
  if (
    draft.type === "review" &&
    (!draft.experience.trim() || !draft.appreciation.trim())
  ) {
    return copy.reviewError;
  }
  return null;
}

function SourceFields({
  draft,
  locale,
  update,
}: {
  readonly draft: DraftFields;
  readonly locale: Locale;
  readonly update: (field: keyof DraftFields, value: string) => void;
}) {
  const copy = intakeMessages[locale];
  if (draft.type === "bug") {
    return (
      <>
        <TextArea
          label={copy.problem}
          value={draft.problem}
          onChange={(value) => {
            update("problem", value);
          }}
        />
        <TextArea
          label={copy.expected}
          value={draft.expected}
          onChange={(value) => {
            update("expected", value);
          }}
        />
        <TextArea
          label={copy.observed}
          value={draft.observed}
          onChange={(value) => {
            update("observed", value);
          }}
        />
        <TextArea
          label={copy.reproduction}
          value={draft.reproduction}
          onChange={(value) => {
            update("reproduction", value);
          }}
        />
      </>
    );
  }
  if (draft.type === "suggestion") {
    return (
      <>
        <TextArea
          label={copy.proposal}
          value={draft.proposal}
          onChange={(value) => {
            update("proposal", value);
          }}
        />
        <TextArea
          label={copy.rationale}
          value={draft.rationale}
          onChange={(value) => {
            update("rationale", value);
          }}
        />
        <TextArea
          label={copy.usageContext}
          value={draft.usageContext}
          onChange={(value) => {
            update("usageContext", value);
          }}
        />
      </>
    );
  }
  return (
    <>
      <TextArea
        label={copy.experience}
        value={draft.experience}
        onChange={(value) => {
          update("experience", value);
        }}
      />
      <TextArea
        label={copy.appreciation}
        value={draft.appreciation}
        onChange={(value) => {
          update("appreciation", value);
        }}
      />
    </>
  );
}

function TextArea({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea
        maxLength={5_000}
        rows={4}
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
    </label>
  );
}

function sourceValues(source: FeedbackSource): readonly string[] {
  if (source.type === "bug") {
    return [
      source.problem,
      source.expectedBehavior,
      source.observedBehavior,
      source.reproductionSteps,
    ].filter((value): value is string => value !== undefined);
  }
  if (source.type === "suggestion") {
    return [source.proposal, source.rationale, source.usageContext].filter(
      (value): value is string => value !== undefined,
    );
  }
  return [source.experience, source.appreciation];
}

function Review({
  data,
  locale,
  onEdit,
  onSend,
  outcome,
  pending,
}: {
  readonly data: ValidatedFeedbackDraft;
  readonly locale: Locale;
  readonly onEdit: () => void;
  readonly onSend: () => void;
  readonly outcome: IntakeGatewayOutcome | null;
  readonly pending: boolean;
}) {
  const copy = intakeMessages[locale];
  const contact =
    data.reporter.kind === "contact" ? data.reporter.value : copy.contactNone;
  return (
    <section className="review-panel" aria-labelledby="review-title">
      <p className="eyebrow">WiseMoney · {copy.review}</p>
      <h1 id="review-title">{copy.reviewTitle}</h1>
      <p className="review-hint">{copy.reviewHint}</p>

      <div className="review-band review-band-source">
        <h2>{copy.source}</h2>
        <dl className="review-facts">
          <div>
            <dt>{copy.project}</dt>
            <dd>WiseMoney</dd>
          </div>
          <div>
            <dt>{copy.type}</dt>
            <dd>{copy.typeLabels[data.type]}</dd>
          </div>
        </dl>
        <ul className="review-values">
          {sourceValues(data.originalSource).map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      </div>

      <div className="review-band review-band-identity">
        <h2>{copy.contact}</h2>
        <p>{contact}</p>
        <p className="disclosure">{copy.contactDisclosure}</p>
      </div>

      <div className="review-band review-band-context">
        <h2>{copy.context}</h2>
        <p>{data.context[0]?.value ?? copy.contextNone}</p>
        <h3>{copy.attachments}</h3>
        <p>{copy.attachmentsNone}</p>
      </div>

      {outcome && outcome.status !== "accepted" ? (
        <p className="form-error" role="alert">
          {outcome.status === "conflict"
            ? copy.conflictError
            : outcome.status === "invalid"
              ? copy.invalidError
              : copy.retryableError}
        </p>
      ) : null}
      <div className="review-actions">
        <button type="button" onClick={onEdit} disabled={pending}>
          {copy.edit}
        </button>
        <button
          className="primary-action"
          type="button"
          onClick={onSend}
          disabled={pending}
        >
          {pending ? copy.sending : copy.send}
        </button>
      </div>
    </section>
  );
}

function Confirmation({
  locale,
  outcome,
}: {
  readonly locale: Locale;
  readonly outcome: Extract<IntakeGatewayOutcome, { readonly status: "accepted" }>;
}) {
  const copy = intakeMessages[locale];
  return (
    <section className="review-panel" aria-labelledby="confirmation-title">
      <p className="eyebrow">WiseMoney · Y7 Feedback</p>
      <h1 id="confirmation-title">{copy.confirmationTitle}</h1>
      <p>{copy.confirmationHint}</p>
      <dl className="review-facts">
        <div>
          <dt>{copy.reference}</dt>
          <dd>{outcome.reference}</dd>
        </div>
        <div>
          <dt>{copy.accessProof}</dt>
          <dd className="access-material">{outcome.accessProof}</dd>
        </div>
      </dl>
      <p className="disclosure">{copy.accessProofWarning}</p>
    </section>
  );
}

export function FeedbackIntake({
  createOperationId,
  gateway,
  locale,
  onLocaleChange,
}: FeedbackIntakeProps) {
  const copy = intakeMessages[locale];
  const [draft, setDraft] = useState<DraftFields>(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ValidatedFeedbackDraft | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<IntakeGatewayOutcome | null>(null);
  const [pending, setPending] = useState(false);

  function update(field: keyof DraftFields, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function selectType(type: FeedbackType) {
    setDraft((current) => ({ ...current, type }));
    setError(null);
  }

  function prepareReview(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const semanticError = requiredError(draft, locale);
    if (semanticError) {
      setError(semanticError);
      return;
    }
    const contact = optional(draft.contact);
    const reporter: ReporterAttribution = contact
      ? { kind: "contact", value: contact, purpose: copy.contactPurpose }
      : { kind: "unidentified" };
    try {
      const validated = validateFeedbackDraft(
        {
          projectId: "wisemoney",
          workspaceId: "personal",
          active: true,
          enabledTypes: ["bug", "suggestion", "review"],
          contextDeclarations: [
            {
              name: "applicationVersion",
              type: "string",
              purpose: copy.contextPurpose,
            },
          ],
        },
        {
          type: draft.type,
          source: sourceFrom(draft),
          reporter,
          context: draft.version.trim()
            ? [
                {
                  name: "applicationVersion",
                  value: draft.version.trim(),
                  source: "public",
                },
              ]
            : [],
          attachmentNames: [],
        },
      );
      setReview(validated);
      setOperationId(createOperationId());
      setOutcome(null);
      setError(null);
    } catch {
      setError(copy.reviewError);
    }
  }

  async function send() {
    if (!review || !operationId || pending) return;
    setPending(true);
    try {
      setOutcome(
        await gateway.accept({
          projectSlug: "wisemoney",
          clientOperationId: operationId,
          locale,
          draft: review,
        }),
      );
    } catch {
      setOutcome({ status: "retryable" });
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="intake-page">
      <header className="masthead intake-header">
        <a className="brand" href="/" aria-label={copy.brandLabel}>
          Y7
        </a>
        <a className="back-link" href="/">
          {copy.back}
        </a>
        <fieldset className="language-switcher">
          <legend>{copy.languageLabel}</legend>
          <button
            type="button"
            aria-pressed={locale === "fr"}
            onClick={() => {
              onLocaleChange("fr");
            }}
          >
            Français
          </button>
          <button
            type="button"
            aria-pressed={locale === "en"}
            onClick={() => {
              onLocaleChange("en");
            }}
          >
            English
          </button>
        </fieldset>
      </header>

      {outcome?.status === "accepted" ? (
        <Confirmation locale={locale} outcome={outcome} />
      ) : review ? (
        <Review
          data={review}
          locale={locale}
          onEdit={() => {
            setReview(null);
            setOperationId(null);
            setOutcome(null);
          }}
          onSend={() => {
            void send();
          }}
          outcome={outcome}
          pending={pending}
        />
      ) : (
        <>
          <section className="intake-introduction" aria-labelledby="intake-title">
            <p className="eyebrow">WiseMoney · Y7 Feedback</p>
            <h1 id="intake-title">{copy.title}</h1>
            <p className="lede">{copy.intro}</p>
          </section>
          <form className="intake-form" noValidate onSubmit={prepareReview}>
            <fieldset className="type-picker">
              <legend>{copy.typeLegend}</legend>
              {(["bug", "suggestion", "review"] as const).map((type) => (
                <label key={type}>
                  <input
                    type="radio"
                    name="feedback-type"
                    checked={draft.type === type}
                    onChange={() => {
                      selectType(type);
                    }}
                  />
                  <span>{copy.typeLabels[type]}</span>
                </label>
              ))}
            </fieldset>

            <section className="form-card" aria-label={copy.source}>
              <SourceFields draft={draft} locale={locale} update={update} />
            </section>

            <section
              className="form-card supporting-fields"
              aria-label={`${copy.contact} — ${copy.context}`}
            >
              <div className="field">
                <label htmlFor="reporter-contact">{copy.contact}</label>
                <input
                  id="reporter-contact"
                  aria-describedby="contact-disclosure"
                  type="text"
                  maxLength={320}
                  value={draft.contact}
                  onChange={(event) => {
                    update("contact", event.currentTarget.value);
                  }}
                />
                <small id="contact-disclosure">{copy.contactDisclosure}</small>
              </div>
              <div className="field">
                <label htmlFor="application-version">{copy.version}</label>
                <input
                  id="application-version"
                  aria-describedby="version-purpose"
                  type="text"
                  maxLength={500}
                  value={draft.version}
                  onChange={(event) => {
                    update("version", event.currentTarget.value);
                  }}
                />
                <small id="version-purpose">{copy.contextPurpose}</small>
              </div>
            </section>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="primary-action" type="submit">
              {copy.review}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
