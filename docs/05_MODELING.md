# UML and C4 Modeling - Y7 Feedback

## 1. C4 Context

```mermaid
C4Context
  title Y7 Feedback - System Context

  Person(submitter, "Submitter", "Leaves a review, suggestion, or bug report")
  Person(operator, "Platform operator", "Registers apps and reviews feedback")
  System(feedback, "Y7 Feedback", "Collects private, product-scoped feedback")
  System_Ext(product, "Registered Y7 application", "Links users to its feedback page")
  System_Ext(antibot, "Anti-abuse service", "Verifies public submission evidence")
  System_Ext(data, "Managed data service", "Stores records and private attachments")

  Rel(submitter, feedback, "Submits feedback", "HTTPS")
  Rel(product, feedback, "Links using registered slug", "HTTPS")
  Rel(operator, feedback, "Configures and reviews")
  Rel(feedback, antibot, "Verifies evidence", "HTTPS")
  Rel(feedback, data, "Persists private records/files", "HTTPS")
```

## 2. UML Use Cases

```mermaid
flowchart LR
  submitter([Submitter])
  operator([Platform operator])

  subgraph feedback[Y7 Feedback]
    discover[Discover active application]
    review[Leave review]
    suggest[Suggest improvement]
    bug[Report bug]
    attach[Attach evidence]
    ack[Receive acknowledgement]
    register[Register application]
    inspect[Review submissions]
  end

  submitter --> discover
  submitter --> review
  submitter --> suggest
  submitter --> bug
  review -. optional .-> attach
  suggest -. optional .-> attach
  bug -. optional .-> attach
  review --> ack
  suggest --> ack
  bug --> ack
  operator --> register
  operator --> inspect
```

## 3. Submission Activity

```mermaid
flowchart TD
  start([Open /:appSlug]) --> resolve{Active app and allowed origin?}
  resolve -- No --> notFound[Show unavailable state]
  resolve -- Yes --> form[Show app-scoped form]
  form --> validateClient{Client input valid?}
  validateClient -- No --> fieldErrors[Show field errors]
  fieldErrors --> form
  validateClient -- Yes --> send[Send payload, files, proof, idempotency key]
  send --> gate{Server admission valid?}
  gate -- No --> reject[Return safe rejection]
  gate -- Yes --> files[Validate and stage attachments]
  files --> fileOk{All files accepted?}
  fileOk -- No --> cleanup[Delete request-owned files]
  cleanup --> reject
  fileOk -- Yes --> persist[Persist submission and attachment links]
  persist --> stored{Durable?}
  stored -- No --> cleanup
  stored -- Yes --> success[Return acknowledgement reference]
  success --> done([Complete])
```

## 4. Submission Sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as Submitter
  participant W as Public Web App
  participant G as Submission Gateway
  participant R as Application Registry
  participant T as Anti-abuse Service
  participant F as Attachment Coordinator
  participant S as Submission Repository

  U->>W: Open /wisemoney
  W->>G: Resolve slug
  G->>R: Find active app + policy
  R-->>G: Public app configuration
  G-->>W: Safe branding and form policy
  U->>W: Complete form and select files
  W->>G: Submit with proof and idempotency key
  G->>R: Resolve slug and allowed origin again
  G->>T: Verify anti-abuse proof
  T-->>G: Verification result
  G->>G: Validate request policy
  G->>F: Validate and stage accepted files for app
  F-->>G: Private file references
  G->>S: Persist submission and file links atomically/idempotently
  alt persistence succeeds
    S-->>G: Submission ID and reference
    G-->>W: Acknowledgement
    W-->>U: Show reference
  else persistence fails
    S-->>G: Failure
    G->>F: Delete request-owned files
    G-->>W: Safe retryable error
    W-->>U: Preserve form and offer retry
  end
```

## 5. C4 Container View

```mermaid
C4Container
  title Y7 Feedback - Container View

  Person(submitter, "Submitter")
  Person(operator, "Platform operator")

  System_Boundary(system, "Y7 Feedback") {
    Container(web, "Public Web Application", "React, TypeScript, Vite", "Localized app discovery and guided forms")
    Container(api, "Submission API", "Vercel Functions", "Admission, validation, orchestration, and safe responses")
    ContainerDb(db, "Feedback Database", "Appwrite", "Applications, submissions, attachment metadata, events")
    ContainerDb(files, "Private App Buckets", "Appwrite Storage", "One configured private bucket per application")
  }

  System_Ext(turnstile, "Cloudflare Turnstile", "Anti-abuse verification")

  Rel(submitter, web, "Uses", "HTTPS")
  Rel(web, api, "Resolves apps and submits feedback", "HTTPS/JSON + multipart")
  Rel(api, turnstile, "Verifies proof", "HTTPS")
  Rel(api, db, "Reads registry and persists records", "Server credentials")
  Rel(api, files, "Stores/deletes private evidence", "Server credentials")
  Rel(operator, db, "Configures/reviews for MVP", "Appwrite Console")
  Rel(operator, files, "Reviews evidence for MVP", "Appwrite Console")
```

## 6. Conceptual Data Model

```mermaid
erDiagram
  APPLICATION ||--o{ SUBMISSION : receives
  APPLICATION ||--|| STORAGE_PARTITION : owns
  SUBMISSION ||--o{ ATTACHMENT : includes
  SUBMISSION ||--o{ SUBMISSION_EVENT : records

  APPLICATION {
    string id PK
    string slug UK
    string display_name
    string status
    json allowed_origins
    json enabled_types
    json branding
    string storage_partition_id
  }

  SUBMISSION {
    string id PK
    string reference UK
    string application_id FK
    string idempotency_hash UK
    string type
    string status
    string title
    json payload
    string contact_email
    datetime created_at
  }

  ATTACHMENT {
    string id PK
    string submission_id FK
    string application_id FK
    string private_file_id UK
    string media_type
    int byte_size
    datetime created_at
  }

  SUBMISSION_EVENT {
    string id PK
    string submission_id FK
    string event_type
    string actor_id
    datetime created_at
  }

  STORAGE_PARTITION {
    string id PK
    string application_id FK
    string provider_bucket_id UK
  }
```

## 7. Model Review Questions

- Can the chosen persistence boundary provide the required submission/file
  consistency, or must the coordinator implement compensating cleanup?
- Should type-specific fields remain a validated payload or become dedicated
  columns for operator queries?
- Does contact data require a separate retention boundary from submission text?
- How is the idempotency hash expired without allowing delayed duplicates?
- Does one bucket per application remain operationally acceptable at the expected
  number of registered products?
