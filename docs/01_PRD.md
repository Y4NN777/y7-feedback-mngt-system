# Product Requirements Document - Y7 Feedback

## 1. Problem

Users of Y7 Labs applications currently lack one consistent place to submit a
review, propose an improvement, or describe a reproducible defect. Feedback is
therefore fragmented across informal conversations and product-specific
channels. Reports arrive without enough context, attachments are difficult to
associate with the right product, and product teams cannot reliably distinguish
an opinion from a feature request or a defect.

As the number of applications grows, creating an unrelated feedback form for
each product would repeat the same work and produce inconsistent user
experiences, data rules, and moderation practices.

## 2. Target Users

- A product user who wants to leave a review.
- A product user who wants to suggest an improvement.
- A product user who encountered a defect and wants to report it.
- A product maintainer who needs complete, attributable, product-scoped input.
- A platform operator who registers products and governs feedback policy.

No marketing persona is required for the MVP. A submitter may remain anonymous.

## 3. Main Use Cases

### UC-P-01 - Find a product

A visitor can identify a product from the feedback service root or open its
known feedback URL directly.

### UC-P-02 - Leave a review

A submitter can rate their experience and provide an optional written review.

### UC-P-03 - Suggest an improvement

A submitter can explain a current problem and the outcome they would prefer.

### UC-P-04 - Report a defect

A submitter can describe a defect, its reproduction steps, expected behavior,
observed behavior, impact, and relevant page.

### UC-P-05 - Attach evidence

A submitter can add supported screenshots or documents to a submission.

### UC-P-06 - Receive acknowledgement

A submitter receives a stable, non-secret reference after successful submission.

### UC-P-07 - Operate multiple products

A platform operator can register multiple products without creating a separate
feedback application for each one.

## 4. MVP Scope

- Public service home at `feedback.y7labs.studio`.
- Product context selected by a stable slug such as `/wisemoney`.
- Review, suggestion, and defect-report workflows.
- Contextual guidance and validation for each workflow.
- Optional contact information.
- Optional private attachments.
- English and French user interfaces.
- Submission acknowledgement and reference.
- Product registration and feedback review through managed operator tooling.
- Abuse resistance and explicit privacy notice.

## 5. Out of Scope

- Public display of submitted reviews.
- Public comments, voting, or community discussion.
- A custom operator dashboard.
- Real-time conversation between submitter and maintainer.
- Product roadmap publication.
- Automatic issue creation in third-party trackers.
- Authentication as a prerequisite for submission.
- Access to private data held by the product being reviewed.
- Product analytics unrelated to the feedback submission flow.

## 6. Success Criteria

- A user can submit each feedback type from a supported mobile viewport without
  creating an account.
- Every accepted submission is associated with exactly one registered product
  and one feedback type.
- Maintainers can identify reproduction details for accepted defect reports.
- Attachments cannot be read by another public visitor.
- Invalid product slugs and invalid submissions are rejected without creating
  orphan records or files.
- The first additional product can be registered without deploying a fork of
  the service.
- At least 95 percent of valid submissions complete without a client or server
  error during a measured 30-day pilot.
- Median valid text-only submission time remains below two minutes in usability
  testing with five first-time participants.

## 7. Product Risks

- Anonymous forms attract automated abuse and harmful uploads.
- Excessive required fields reduce completion rates.
- Product-specific customization can fragment the shared experience.
- Collecting browser, contact, or attachment data creates privacy obligations.
- A reference may be mistaken for a public tracking capability if its meaning is
  not clearly stated.

## 8. Product Principles

- Ask only for information that helps understand or act on feedback.
- Never request passwords, financial records, API keys, or other secrets.
- Keep the product context visible throughout the submission flow.
- Treat uploaded evidence as private by default.
- Prefer guided questions over one undifferentiated text box.
