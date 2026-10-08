import { describe, expect, it } from 'vitest';
import type { CancellationApplyResult, CancellationStorePort } from '../../src/application/ports/outbound/cancellation-store.port.js';
import type { RegistrationCommitResult, RegistrationStorePort } from '../../src/application/ports/outbound/registration-store.port.js';
import type { RegistrationCancellation } from '../../src/domain/entities/registration-cancellation.entity.js';
import type { Registration } from '../../src/domain/entities/registration.entity.js';
import type { RegistrationReceipt } from '../../src/domain/entities/registration-receipt.entity.js';
import { CancelRegistrationUseCase } from '../../src/application/use-cases/cancel-registration.usecase.js';
import { ReceiveRegistrationUseCase } from '../../src/application/use-cases/receive-registration.usecase.js';
import {
  DynamoRegistrationStoreAdapter,
} from '../../src/infrastructure/adapters/database/dynamo-registration-store.adapter.js';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { HmacSignatureVerifier } from '../../src/infrastructure/adapters/security/hmac-signature-verifier.js';
import { WebCryptoPayloadDigest } from '../../src/infrastructure/adapters/security/web-crypto-payload-digest.js';
import { adminGetReceiptHandler } from '../../src/infrastructure/handlers/api-gateway/admin-get-receipt.js';
import { adminListRegistrationsHandler } from '../../src/infrastructure/handlers/api-gateway/admin-list-registrations.js';
import { providerRegistrationCancellationsHandler } from '../../src/infrastructure/handlers/api-gateway/provider-registrations-cancellations.js';
import { providerRegistrationsHandler } from '../../src/infrastructure/handlers/api-gateway/provider-registrations.js';
import {
  fixtureSecret,
  signedCancellationDelivery,
  signedRegistrationDelivery,
  signPayload,
  type SignedProviderDelivery,
} from '../fixtures/signed-provider-deliveries.js';

describe('provider registration callback contract', () => {
  it('verifies the raw-body HMAC and rejects modified bytes and expired timestamps', async () => {
    const now = new Date();
    const delivery = await signedRegistrationDelivery(now);
    const verifier = new HmacSignatureVerifier();
    const base = {
      rawBody: delivery.rawBody,
      signedAt: delivery.signedAt,
      signature: delivery.signature,
      secret: fixtureSecret(),
      now,
    };

    await expect(verifier.verify(base)).resolves.toBe(true);
    await expect(verifier.verify({ ...base, rawBody: new TextEncoder().encode(`${delivery.body} `) })).resolves.toBe(false);
    await expect(verifier.verify({
      ...base,
      now: new Date(now.getTime() + 301_000),
    })).resolves.toBe(false);
  });

  it('returns 201 once and 200 with the canonical receipt for an identical retry', async () => {
    const now = fixedNow();
    const delivery = await signedRegistrationDelivery(now);
    const setup = createHarness(now);

    const first = await providerRegistrationsHandler(requestFor(delivery), setup.registration);
    const retry = await providerRegistrationsHandler(requestFor(delivery), setup.registration);
    const firstJson = await first.json() as { receipt: RegistrationReceipt };
    const retryJson = await retry.json() as { receipt: RegistrationReceipt };

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retryJson.receipt).toEqual(firstJson.receipt);
    expect(setup.store.registrations.size).toBe(1);
    expect(setup.store.receipts.size).toBe(1);
  });

  it('collapses 100 simultaneous identical deliveries into one canonical receipt', async () => {
    const now = fixedNow();
    const delivery = await signedRegistrationDelivery(now);
    const setup = createHarness(now);
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => providerRegistrationsHandler(requestFor(delivery), setup.registration)),
    );
    const receipts = await Promise.all(responses.map(async (response) => {
      const body = await response.json() as { receipt: RegistrationReceipt };
      return body.receipt;
    }));

    expect(countStatuses(responses)).toEqual({ 200: 99, 201: 1 });
    expect(new Set(receipts.map((receipt) => receipt.receiptId))).toHaveLength(1);
    expect(setup.store.registrations.size).toBe(1);
    expect(setup.store.receipts.size).toBe(1);
  });

  it('preserves the same 100-delivery behavior through DynamoDB conditional transactions', async () => {
    const now = fixedNow();
    const delivery = await signedRegistrationDelivery(now);
    const dynamo = new FakeDynamoDocumentClient();
    const store = new DynamoRegistrationStoreAdapter(
      dynamo as unknown as ConstructorParameters<typeof DynamoRegistrationStoreAdapter>[0],
      'registrations',
    );
    const setup = createHarness(now, store);
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => providerRegistrationsHandler(requestFor(delivery), setup.registration)),
    );
    const receipts = await Promise.all(responses.map(async (response) => {
      const body = await response.json() as { receipt: RegistrationReceipt };
      return body.receipt;
    }));

    expect(countStatuses(responses)).toEqual({ 200: 99, 201: 1 });
    expect(new Set(receipts.map((receipt) => receipt.receiptId))).toHaveLength(1);
    expect(dynamo.items.size).toBe(2);
  });

  it('rejects a changed payload on an existing idempotency key without another registration', async () => {
    const now = fixedNow();
    const initial = await signedRegistrationDelivery(now);
    const changed = await signPayload({
      ...JSON.parse(initial.body) as Record<string, unknown>,
      externalParticipantId: 'participant-changed',
    }, now);
    const setup = createHarness(now);

    expect((await providerRegistrationsHandler(requestFor(initial), setup.registration)).status).toBe(201);
    const response = await providerRegistrationsHandler(requestFor(changed), setup.registration);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'event_conflict',
        message: 'This provider event ID was already used with a different payload.',
      },
    });
    expect(setup.store.registrations.size).toBe(1);
    expect(setup.store.receipts.size).toBe(1);
  });

  it('rejects tenant mismatch and malformed signed data without persistence', async () => {
    const now = fixedNow();
    const tenantMismatch = await signPayload({
      ...JSON.parse((await signedRegistrationDelivery(now)).body) as Record<string, unknown>,
      tenantId: 'another-tenant',
    }, now);
    const invalidJson = await signPayload({ not: 'a registration' }, now);
    const setup = createHarness(now);

    expect((await providerRegistrationsHandler(requestFor(tenantMismatch), setup.registration)).status).toBe(403);
    const malformedResponse = await providerRegistrationsHandler(requestFor(invalidJson), setup.registration);
    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(setup.store.registrations.size).toBe(0);
    expect(setup.store.receipts.size).toBe(0);
  });

  it('returns the same error envelope for missing signatures and enforces the body limit', async () => {
    const now = fixedNow();
    const delivery = await signedRegistrationDelivery(now);
    const setup = createHarness(now);
    const missingSignature = requestFor(delivery, false);
    const oversized = new Request('https://unit.test/provider/registrations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provider-credential-id': delivery.credentialId,
        'x-provider-timestamp': delivery.signedAt,
        'x-provider-signature': delivery.signature,
      },
      body: 'x'.repeat(16 * 1024 + 1),
    });

    const invalid = await providerRegistrationsHandler(missingSignature, setup.registration);
    const tooLarge = await providerRegistrationsHandler(oversized, setup.registration);
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_signature' } });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('records duplicate, cancellation-before-create, and stale cancellation events safely', async () => {
    const now = fixedNow();
    const setup = createHarness(now);
    const cancellation = await signedCancellationDelivery({}, now);

    const first = await providerRegistrationCancellationsHandler(requestFor(cancellation), setup.cancellation);
    const duplicate = await providerRegistrationCancellationsHandler(requestFor(cancellation), setup.cancellation);
    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(200);
    expect((await first.json() as { receipt: RegistrationReceipt }).receipt)
      .toEqual((await duplicate.json() as { receipt: RegistrationReceipt }).receipt);

    const registration = await signedRegistrationDelivery(now);
    expect((await providerRegistrationsHandler(requestFor(registration), setup.registration)).status).toBe(201);

    const stale = await signedCancellationDelivery({
      providerEventId: 'evt-cancellation-older',
      sequence: 1,
    }, now);
    expect((await providerRegistrationCancellationsHandler(requestFor(stale), setup.cancellation)).status).toBe(201);

    const changedRetry = await signedCancellationDelivery({ sequence: 3 }, now);
    const conflictingRetry = await providerRegistrationCancellationsHandler(requestFor(changedRetry), setup.cancellation);
    expect(conflictingRetry.status).toBe(409);
    expect(setup.store.registrations.size).toBe(1);
    expect(setup.store.receipts.size).toBe(3);
  });

  it('atomically writes the canonical receipt and registration with a cancellation-state check', async () => {
    let transaction: TransactWriteCommand | undefined;
    const client = {
      send: async (command: unknown) => {
        if (command instanceof GetCommand) return {};
        if (command instanceof TransactWriteCommand) {
          transaction = command;
          return {};
        }
        throw new Error('Unexpected DynamoDB command.');
      },
    } as unknown as ConstructorParameters<typeof DynamoRegistrationStoreAdapter>[0];
    const adapter = new DynamoRegistrationStoreAdapter(client, 'registrations');
    const now = fixedNow();
    const result = await adapter.commitRegistration({
      tenantId: 'tenant-1',
      providerEventId: 'event-1',
      providerRegistrationId: 'registration-1',
      workshopId: 'workshop-1',
      externalParticipantId: 'participant-1',
      occurredAt: now,
      receivedAt: now,
      schemaVersion: 1,
    }, {
      receiptId: 'receipt-1',
      tenantId: 'tenant-1',
      providerEventId: 'event-1',
      eventType: 'registration',
      payloadDigest: 'd'.repeat(64),
      receivedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(result.kind).toBe('created');
    expect(transaction?.input.TransactItems).toHaveLength(3);
    expect(transaction?.input.TransactItems?.[0]?.Put?.Item).toMatchObject({
      SK: 'EVENT#event-1',
      receiptId: 'receipt-1',
      payloadDigest: 'd'.repeat(64),
    });
    expect(transaction?.input.TransactItems?.[1]?.Put?.Item).toMatchObject({
      SK: 'REG#registration-1',
      workshopPK: 'TENANT#tenant-1#WORKSHOP#workshop-1',
    });
    expect(transaction?.input.TransactItems?.[2]?.ConditionCheck?.ConditionExpression)
      .toBe('attribute_not_exists(PK)');
  });

  it('serves IAM-protected admin receipt and workshop query requests with tenant scope', async () => {
    const now = fixedNow();
    const receipt = {
      receiptId: 'receipt-1',
      tenantId: 'tenant-1',
      providerEventId: 'event-1',
      eventType: 'registration' as const,
      payloadDigest: 'd'.repeat(64),
      receivedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
    const registration = {
      tenantId: 'tenant-1',
      providerEventId: 'event-1',
      providerRegistrationId: 'registration-1',
      workshopId: 'workshop-1',
      externalParticipantId: 'participant-1',
      occurredAt: now,
      receivedAt: now,
      schemaVersion: 1,
    };
    const receiptResponse = await adminGetReceiptHandler(
      new Request('https://admin.test/admin/receipts/receipt-1?tenantId=tenant-1'),
      { execute: async (query) => query.tenantId === 'tenant-1' ? receipt : null },
    );
    const registrationsResponse = await adminListRegistrationsHandler(
      new Request('https://admin.test/admin/workshops/workshop-1/registrations?tenantId=tenant-1&limit=20'),
      { execute: async (query) => ({
        registrations: query.tenantId === 'tenant-1' ? [registration] : [],
      }) },
    );

    expect(receiptResponse.status).toBe(200);
    expect(await receiptResponse.json()).toMatchObject({ receiptId: 'receipt-1' });
    expect(registrationsResponse.status).toBe(200);
    expect(await registrationsResponse.json()).toMatchObject({
      registrations: [{ providerRegistrationId: 'registration-1' }],
    });
  });
});

type CallbackHarness<T extends RegistrationStorePort & CancellationStorePort> = {
  readonly store: T;
  readonly registration: ReceiveRegistrationUseCase;
  readonly cancellation: CancelRegistrationUseCase;
};

function createHarness(now: Date): CallbackHarness<MemoryCallbackStore>;
function createHarness(now: Date, store: DynamoRegistrationStoreAdapter): CallbackHarness<DynamoRegistrationStoreAdapter>;
function createHarness(
  now: Date,
  store?: MemoryCallbackStore | DynamoRegistrationStoreAdapter,
): CallbackHarness<MemoryCallbackStore | DynamoRegistrationStoreAdapter> {
  const callbackStore = store ?? new MemoryCallbackStore();
  let nextId = 0;
  const ids = { nextId: () => `receipt-${++nextId}` };
  const clock = { now: () => new Date(now) };
  const credentials = {
    resolve: async (credentialId: string) => credentialId === 'provider-1'
      ? { tenantId: 'tenant-1', secret: fixtureSecret() }
      : null,
  };
  const digest = new WebCryptoPayloadDigest();
  const verifier = new HmacSignatureVerifier();
  return {
    store: callbackStore,
    registration: new ReceiveRegistrationUseCase(credentials, verifier, callbackStore, digest, ids, clock),
    cancellation: new CancelRegistrationUseCase(credentials, verifier, callbackStore, digest, ids, clock),
  };
}

function requestFor(delivery: SignedProviderDelivery, includeSignature = true): Request {
  return new Request('https://unit.test/provider/registrations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-provider-credential-id': delivery.credentialId,
      'x-provider-timestamp': delivery.signedAt,
      ...(includeSignature ? { 'x-provider-signature': delivery.signature } : {}),
    },
    body: delivery.body,
  });
}

function fixedNow(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

function countStatuses(responses: readonly Response[]): Record<number, number> {
  return responses.reduce<Record<number, number>>((counts, response) => {
    counts[response.status] = (counts[response.status] ?? 0) + 1;
    return counts;
  }, {});
}

class MemoryCallbackStore implements RegistrationStorePort, CancellationStorePort {
  readonly receipts = new Map<string, RegistrationReceipt>();
  readonly registrations = new Map<string, Registration>();
  readonly cancellationSequences = new Map<string, number>();

  async commitRegistration(
    registration: Registration,
    receipt: RegistrationReceipt,
  ): Promise<RegistrationCommitResult> {
    const eventKey = `${receipt.tenantId}:${receipt.providerEventId}`;
    const previous = this.receipts.get(eventKey);
    if (previous) {
      return previous.payloadDigest === receipt.payloadDigest && previous.eventType === receipt.eventType
        ? { kind: 'duplicate', receipt: previous }
        : { kind: 'conflict' };
    }

    const registrationKey = `${registration.tenantId}:${registration.providerRegistrationId}`;
    if (this.registrations.has(registrationKey)) {
      return { kind: 'conflict' };
    }
    this.receipts.set(eventKey, receipt);
    this.registrations.set(registrationKey, registration);
    return { kind: 'created', receipt };
  }

  async applyCancellationAtomically(
    cancellation: RegistrationCancellation,
    receipt: RegistrationReceipt,
  ): Promise<CancellationApplyResult> {
    const eventKey = `${receipt.tenantId}:${receipt.providerEventId}`;
    const previous = this.receipts.get(eventKey);
    if (previous) {
      return previous.payloadDigest === receipt.payloadDigest && previous.eventType === receipt.eventType
        ? { kind: 'duplicate', receipt: previous }
        : { kind: 'conflict' };
    }
    const registrationKey = `${cancellation.tenantId}:${cancellation.providerRegistrationId}`;
    const currentSequence = this.cancellationSequences.get(registrationKey) ?? 0;
    const kind = cancellation.sequence <= currentSequence
      ? 'stale'
      : this.registrations.has(registrationKey)
        ? 'cancelled'
        : 'pending-create';
    if (kind !== 'stale') {
      this.cancellationSequences.set(registrationKey, cancellation.sequence);
    }
    this.receipts.set(eventKey, receipt);
    return { kind, receipt };
  }
}

class FakeDynamoDocumentClient {
  readonly items = new Map<string, Record<string, unknown>>();

  async send(command: unknown): Promise<Record<string, unknown>> {
    if (command instanceof GetCommand) {
      const key = command.input.Key;
      if (!key || typeof key['PK'] !== 'string' || typeof key['SK'] !== 'string') {
        throw new Error('DynamoDB GetCommand was missing its key.');
      }
      const item = this.items.get(`${key['PK']}:${key['SK']}`);
      return item ? { Item: { ...item } } : {};
    }
    if (!(command instanceof TransactWriteCommand)) {
      throw new Error('Unexpected DynamoDB command.');
    }

    const items = command.input.TransactItems ?? [];
    for (const operation of items) {
      if (operation.Put) {
        const item = operation.Put.Item;
        if (!item || typeof item['PK'] !== 'string' || typeof item['SK'] !== 'string') {
          throw new Error('DynamoDB Put was missing its key.');
        }
        if (this.items.has(`${item['PK']}:${item['SK']}`)) {
          throw { name: 'TransactionCanceledException' };
        }
      } else if (operation.ConditionCheck) {
        const key = operation.ConditionCheck.Key;
        if (!key || typeof key['PK'] !== 'string' || typeof key['SK'] !== 'string') {
          throw new Error('DynamoDB ConditionCheck was missing its key.');
        }
        const item = this.items.get(`${key['PK']}:${key['SK']}`);
        if (operation.ConditionCheck.ConditionExpression === 'attribute_not_exists(PK)' && item) {
          throw { name: 'TransactionCanceledException' };
        }
      }
    }
    for (const operation of items) {
      if (operation.Put?.Item) {
        const item = operation.Put.Item as unknown as Record<string, unknown>;
        this.items.set(`${String(item['PK'])}:${String(item['SK'])}`, { ...item });
      }
    }
    return {};
  }
}