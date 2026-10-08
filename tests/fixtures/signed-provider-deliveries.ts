const FIXTURE_SECRET = 'provider-callback-contract-test-secret-32bytes';
const encoder = new TextEncoder();

export interface SignedProviderDelivery {
  readonly body: string;
  readonly rawBody: Uint8Array;
  readonly signedAt: string;
  readonly signature: string;
  readonly credentialId: string;
}

export async function signedRegistrationDelivery(now = new Date()): Promise<SignedProviderDelivery> {
  return signPayload({
    tenantId: 'tenant-1',
    providerEventId: 'evt-registration-001',
    providerRegistrationId: 'reg-001',
    workshopId: 'workshop-001',
    externalParticipantId: 'participant-001',
    occurredAt: '2026-10-08T12:00:00.000Z',
    schemaVersion: 1,
  }, now);
}

export async function signedCancellationDelivery(
  overrides: Readonly<Record<string, unknown>> = {},
  now = new Date(),
): Promise<SignedProviderDelivery> {
  return signPayload({
    tenantId: 'tenant-1',
    providerEventId: 'evt-cancellation-001',
    providerRegistrationId: 'reg-001',
    sequence: 2,
    occurredAt: '2026-10-08T12:01:00.000Z',
    schemaVersion: 1,
    ...overrides,
  }, now);
}

export async function signPayload(
  payload: Readonly<Record<string, unknown>>,
  now = new Date(),
  secret = FIXTURE_SECRET,
): Promise<SignedProviderDelivery> {
  const body = JSON.stringify(payload);
  const rawBody = encoder.encode(body);
  const signedAt = String(Math.floor(now.getTime() / 1000));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const messagePrefix = encoder.encode(`${signedAt}.`);
  const message = new Uint8Array(messagePrefix.length + rawBody.length);
  message.set(messagePrefix);
  message.set(rawBody, messagePrefix.length);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const signature = `v1=${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return { body, rawBody, signedAt, signature, credentialId: 'provider-1' };
}

export function fixtureSecret(): Uint8Array {
  return encoder.encode(FIXTURE_SECRET);
}