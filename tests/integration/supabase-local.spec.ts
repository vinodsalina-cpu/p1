import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { signPayload, type SignedProviderDelivery } from '../fixtures/signed-provider-deliveries.js';

function localUrl(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Supabase integration test.`);
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', 'host.docker.internal', ...(process.env.P1_LOCAL_TEST_HOSTS ?? '').split(',')].includes(url.hostname)) {
    throw new Error(`${name} must point to the local Supabase stack.`);
  }
  return url;
}

const apiUrl = localUrl('SUPABASE_API_URL');
const databaseUrl = localUrl('P1_TEST_DATABASE_URL');
const database = new pg.Pool({
  connectionString: databaseUrl.toString(),
  connectionTimeoutMillis: 5_000,
  max: 5,
});
const eventId = `p1-integration-${crypto.randomUUID()}`;
const registrationId = `p1-registration-${crypto.randomUUID()}`;

async function deliver(delivery: SignedProviderDelivery): Promise<Response> {
  return fetch(new URL('/functions/v1/provider/registrations', apiUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-provider-credential-id': delivery.credentialId,
      'x-provider-timestamp': delivery.signedAt,
      'x-provider-signature': delivery.signature,
    },
    body: delivery.body,
  });
}

beforeAll(async () => {
  const { rows } = await database.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.registration_receipts')::text AS table_name",
  );
  expect(rows[0]?.table_name).toBe('registration_receipts');
  const functionResponse = await fetch(new URL('/functions/v1/provider/unknown', apiUrl));
  expect(functionResponse.status).toBe(404);
}, 30_000);

afterAll(async () => {
  await database.query('DELETE FROM registrations WHERE tenant_id = $1 AND provider_registration_id = $2', [
    'tenant-1', registrationId,
  ]);
  await database.query('DELETE FROM registration_receipts WHERE tenant_id = $1 AND provider_event_id = $2', [
    'tenant-1', eventId,
  ]);
  await database.end();
}, 30_000);

describe('Supabase Edge Function and PostgreSQL', () => {
  it('commits one registration and receipt for 100 concurrent signed callbacks', async () => {
    const delivery = await signPayload({
      tenantId: 'tenant-1',
      providerEventId: eventId,
      providerRegistrationId: registrationId,
      workshopId: 'workshop-1',
      externalParticipantId: 'participant-1',
      occurredAt: new Date().toISOString(),
      schemaVersion: 1,
    });
    const responses = await Promise.all(Array.from({ length: 100 }, () => deliver(delivery)));
    const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{
      receipt?: { receiptId: string };
      error?: unknown;
    }>));

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(99);
    expect(new Set(bodies.map((body) => body.receipt?.receiptId))).toHaveLength(1);

    const receipts = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM registration_receipts WHERE tenant_id = $1 AND provider_event_id = $2',
      ['tenant-1', eventId],
    );
    const registrations = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM registrations WHERE tenant_id = $1 AND provider_registration_id = $2',
      ['tenant-1', registrationId],
    );
    expect(receipts.rows[0]?.count).toBe('1');
    expect(registrations.rows[0]?.count).toBe('1');

    const retry = await deliver(delivery);
    expect(retry.status).toBe(200);
    expect((await retry.json() as { receipt: { receiptId: string } }).receipt.receiptId)
      .toBe(bodies[0]?.receipt?.receiptId);
  }, 120_000);
});
