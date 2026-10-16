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
| ID	        | Requirement                                                                                                                                                                                                                                                                                       |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Receive   | POST /provider/registrations accepts tenant, providerEventId, workshopId, externalParticipantId, occurredAt, schemaVersion. Verify an HMAC over timestamp + raw bytes before parsing. Never trust a provider-supplied tenant without matching the configured credential.                          |
| Commit	    | Persist registration plus its idempotency receipt atomically. Key scope = tenant + providerEventId; store a payload digest. Repeat delivery → same receipt. Different payload for that key → 409. Preserve duplicates for 7 days; reject signed replays older than the 5-minute signature window. |
| Query	     | Authorized operator can read a receipt and list registrations by workshop with cursor pagination. Store receivedAt separately from occurredAt. No function-local collection is authoritative.                                                                                                     |
| Run twice	 | Two adapters to the same observable contract: local Supabase/Deno and AWS Node Lambda. Keep normalization/policy logic portable. Local uses PostgreSQL constraints + transactions; AWS uses DynamoDB conditional/transactional writes. Distinct mechanisms.                                       |

### Provider Callback Contract

Both provider endpoints accept `POST` requests with a maximum body size of 16 KiB:

| Callback     | Path                                |
|--------------|-------------------------------------|
| Registration | `/provider/registrations`           |
| Cancellation | `/provider/registrations/cancelled` |

On AWS these are API Gateway routes. With Supabase Edge Functions, deploy the
`provider` function and append the same routes to the platform prefix, for
example `/functions/v1/provider/registrations` and
`/functions/v1/provider/registrations/cancelled`.

The request body must be UTF-8 JSON. Required headers are:

| Header                     | Meaning                                      |
|----------------------------|----------------------------------------------|
| `x-provider-credential-id` | ID of a configured provider credential       |
| `x-provider-timestamp`     | Unix timestamp in whole seconds              |
| `x-provider-signature`     | `v1=<64 hexadecimal characters>` HMAC-SHA256 |

The signature is computed over the exact bytes sent, without parsing or
re-serializing the body:

```text
HMAC-SHA256(secret, UTF8(x-provider-timestamp + ".") || rawBody)
```

The timestamp may differ from the server clock by at most 300 seconds in either
direction. Signature validation runs before JSON parsing. Credentials resolve
to a configured tenant and secret; the `tenantId` in the signed body must match
that tenant. In AWS, `WebhookSecretArn` points to a Secrets Manager JSON object
whose keys are credential IDs and whose values have `tenantId` and `secret`
string fields. Warm Lambda instances refresh this configuration once per
minute; rotate credentials by accepting both the old and new IDs/secrets during
that overlap, then remove the old credential after the refresh window and
provider cutover. Supabase functions read the same JSON shape from
`WEBHOOK_CREDENTIALS` and use `SUPABASE_URL` plus
`SUPABASE_SERVICE_ROLE_KEY` for atomic RPC persistence.

Registration bodies use `schemaVersion: 1` and contain non-empty string values
for `tenantId`, `providerEventId`, `providerRegistrationId`, `workshopId`, and
`externalParticipantId`, plus an ISO-8601 UTC `occurredAt` timestamp. A
cancellation body contains `schemaVersion: 1`, `tenantId`, `providerEventId`,
`providerRegistrationId`, a positive integer `sequence`, and ISO-8601 UTC
`occurredAt`. `providerEventId` is unique across callback event types within a
tenant; `providerRegistrationId` links a cancellation to its registration.

Idempotency is scoped to `(tenantId, providerEventId)`. The receipt stores a
SHA-256 digest of the untouched request body and expires after seven days. A
repeated event with the same digest returns the original receipt; reusing its
key with different body bytes returns `409`. A first durably recorded event
returns `201`, and an identical retry returns `200`, including a retry after a
successful commit whose first response was lost.

Cancellation events are retained independently of the registration. The
highest sequence wins; an event with a lower or equal sequence is durably
recorded as stale and cannot revert newer state. A cancellation received before
its registration is retained as pending and is applied when that registration
arrives.

Successful responses have the same envelope on both runtimes:

```json
{
  "receipt": {
    "receiptId": "uuid",
    "tenantId": "tenant-1",
    "providerEventId": "evt-123",
    "eventType": "registration",
    "payloadDigest": "sha256-hex",
    "receivedAt": "2026-10-08T12:00:00.000Z",
    "expiresAt": "2026-10-15T12:00:00.000Z"
  }
}
```

The `eventType` is `registration` or `cancellation`. Error responses use
`{"error":{"code":"...","message":"..."}}`. Status mapping is `400` for
malformed JSON or fields, `401` for missing/invalid/expired signatures or
unknown credentials, `403` for tenant mismatch, `405` for non-POST methods,
`409` for a changed payload using an existing event key, `413` for bodies over
16 KiB, and `503` when durable persistence is unavailable.


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

| ID | Criteria                                                                                                                                                    |
|----|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | 100 concurrent identical requests yield exactly one registration and one canonical receipt in each adapter. Every success response references that receipt. |
| 2  | Conflicting payload → 409; invalid/expired signatures and credential/tenant mismatch leave zero rows/items.                                                 |
| 3  | Inject failure after commit but before HTTP response. Retry returns the committed receipt without another registration.                                     |
| 4  | Local: 30 RPS, p95 < 250 ms, peak app RSS < 256 MiB. 500/503 errors < 1% in the healthy run; no correctness exceptions.                                     |
| 5  | AWS: 5 RPS for 60 seconds, warm client p95 < 1 s. Report cold samples separately — do not hide them in a warm average.                                      |
| 6  | Same contract suite against Deno/PostgreSQL and Node/DynamoDB. Persisted receipts survive restart or execution-environment replacement.                     |
| 7  | Cancellation tests include duplicate cancellation, cancellation-before-create, and changed payload. State never regresses due to an older event.            |


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

### Automated real-service environment

The devcontainer uses Docker Compose to start PostgreSQL, PostgREST, Supabase
Edge Runtime, and DynamoDB Local. The shared Dockerfile installs development
tools through `.devcontainer/install-tools.sh`. Database services use persistent
named volumes, private network ports, and local-only fixture credentials.
This minimal Supabase stack excludes Studio, Auth, and Storage.

Build the services, install locked dependencies, and run compilation, contracts,
architecture checks, and real database integration tests:

```sh
pnpm build:environment
```

The Apple Container CI pipeline uses the same Dockerfile and test suite:

```sh
pnpm build:environment --runtime apple
```

This Mac's local network restrictions are a separate opt-in extension:

```sh
pnpm build:environment --runtime apple --patch
```

`--patch` verifies the existing `192.168.64.0/24` default network, the host DNS
listener on `127.0.0.1:5300`, and the privileged PF redirect before any build.
It sets container DNS to `192.168.64.1`, relying on that verified redirect.
It stops if verification fails, and never changes PF or uses alternate DNS.
Run with an already authorized sudo session so PF can be inspected. This patch
is specific to Apple Container; it does not reconfigure Docker/Colima networking.
Normal setup and production builds carry none of these local restrictions.

`.github/workflows/apple-container.yml` runs on a dedicated self-hosted Apple
Silicon macOS 26+ runner with Node/npm and Apple Container installed. Manual
runs expose a `patch` input, defaulting to false. Do not run untrusted PRs on a
personal Mac. Pipeline containers are recreated; their data volumes persist.

The tests verify 100 concurrent duplicates and real persistence. Cloud AWS,
performance targets, actual service restarts, and the full cancellation/failure
acceptance matrix remain separate gates. The architecture checker currently
warns that TypeScript 7 support is incomplete.

### WebStorm data sources

The P1 Compose database services stay private to Docker except for loopback-only
upstreams on `127.0.0.1:15432` (PostgreSQL) and `127.0.0.1:18000` (DynamoDB
Local). Run the local IDE proxy in a separate terminal after starting the
Compose stack:

```sh
pnpm ide:proxy
```

Use the `P1 Local PostgreSQL` WebStorm data source at
`jdbc:postgresql://127.0.0.1:5432/postgres?sslmode=disable`, with user
`postgres` and password `postgres`, saved by WebStorm in Password Safe. The
proxy keeps the public loopback ports available if Compose services stop:
PostgreSQL clients receive SQLSTATE `57P03`, while DynamoDB clients at
`http://127.0.0.1:8000` receive an HTTP 503 `ServiceUnavailableException`.
DynamoDB Local has no native data source driver in this WebStorm installation;
configure its endpoint with region `us-east-1`, access key `local`, and secret
key `local` in SDK-backed run configurations.
