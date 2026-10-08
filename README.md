## P1 / Workshop Registration Intake
A practice project for building a serverless webhook intake that can survive duplicate, concurrent, and retried callbacks — the kind real registration providers actually send.

### 3 days Implementation Boundary
- Core: signature verification, registration contract, durable receipt, one list route, both adapters.
- Use the local Supabase stack only to develop this function. 
- continue Node/Lambda first, then finish the Deno contract comparison.

###  Areas:
handling Concurrent duplicates of webhook handlers. a fixture with 100 simultaneous signed deliveries.
The response-loss gap (commit succeeds, response never reaches caller) after a provider timeout deliberately handled
The boundary between log and effect — "received" is not "accepted" — applies to systems where replay is unavoidable.
Serverless as an independently deployable unit 


### Summary Criteria 
A runnable vertical slice where 100 concurrent identical requests produce exactly one registration and one canonical receipt — with tests that prove it, and two adapters that survive restart.


###  Client Facts and Boundaries
- 3 tenants · 30 workshops · 10,000 registrations in the historical fixture
- Peak local burst: 30 callback requests/second
- Payload at most 16 KiB
- Out of scope: payments, email sending, waitlist allocation, public signup
- Provider simulator and seeded operator identities created as fixtures


###  Required Behavior
| ID	| Requirement |
| --- | --- |
| Receive | POST /provider/registrations accepts tenant, providerEventId, workshopId, externalParticipantId, occurredAt, schemaVersion. Verify an HMAC over timestamp + raw bytes before parsing. Never trust a provider-supplied tenant without matching the configured credential. |
| Commit	| Persist registration plus its idempotency receipt atomically. Key scope = tenant + providerEventId; store a payload digest. Repeat delivery → same receipt. Different payload for that key → 409. Preserve duplicates for 7 days; reject signed replays older than the 5-minute signature window. |
| Query	| Authorized operator can read a receipt and list registrations by workshop with cursor pagination. Store receivedAt separately from occurredAt. No function-local collection is authoritative. |
| Run twice	| Two adapters to the same observable contract: local Supabase/Deno and AWS Node Lambda. Keep normalization/policy logic portable. Local uses PostgreSQL constraints + transactions; AWS uses DynamoDB conditional/transactional writes. Distinct mechanisms. |


### State and Effect Boundary
Received = log observation. Accepted = durable registration + receipt committed.
Invalid, unauthorized, and conflicting input is never accepted.
Response loss after commit is recovered by the same idempotency key.
Status codes: 201 first commit · 200 repeat · stable 4xx for rejected input.


### Required Failure Fixtures
- Concurrent duplicates
- Invalid HMAC
- Expired signed request
- Mismatched tenant
- Same key with another body
- Database unavailable
- Response lost after commit
- No fire-and-forget background work after the function returns.


### Acceptance Criteria

| ID | Criteria |
| --- | --- |
| 1 | 100 concurrent identical requests yield exactly one registration and one canonical receipt in each adapter. Every success response references that receipt. |
| 2 | Conflicting payload → 409; invalid/expired signatures and credential/tenant mismatch leave zero rows/items. |
| 3 | Inject failure after commit but before HTTP response. Retry returns the committed receipt without another registration. |
| 4 | Local: 30 RPS, p95 < 250 ms, peak app RSS < 256 MiB. 500/503 errors < 1% in the healthy run; no correctness exceptions. |
| 5 | AWS: 5 RPS for 60 seconds, warm client p95 < 1 s. Report cold samples separately — do not hide them in a warm average. |
| 6 | Same contract suite against Deno/PostgreSQL and Node/DynamoDB. Persisted receipts survive restart or execution-environment replacement. |
| 7 | Cancellation tests include duplicate cancellation, cancellation-before-create, and changed payload. State never regresses due to an older event. |


### Late Client Change (Day 3)
The provider adds registration.cancelled callbacks:
- Support cancellation without deleting the original registration
- Add a provider sequence per registration
- Define duplicate and out-of-order behavior; cancellation may arrive before creation
- Tests must preserve the original registration receipt behavior


### AWS Delivery
- SAM/CloudFormation:API Gateway HTTP APILambda nodejs24.x, a DynamoDB table, CloudWatch logs
- Short timeout, 256 MiB starting memory, small concurrency limit; report throttling
- Bundle required SDK modules
- Admin routes: IAM authorization · Webhook routes: signature contract


### Evidence to Deliver
- Two runnable adapters
- Signed provider fixture
- Contract suite
- SAM template
- AWS latency/log evidence
- Dependency ledger
- Runbook: rotating the webhook secret + reconciling an ambiguous receipt
