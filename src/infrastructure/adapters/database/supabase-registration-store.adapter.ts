import type { CancellationApplyResult, CancellationStorePort } from '../../../application/ports/outbound/cancellation-store.port.ts';
import type { RegistrationCommitResult, RegistrationStorePort } from '../../../application/ports/outbound/registration-store.port.ts';
import type { RegistrationCancellation } from '../../../domain/entities/registration-cancellation.entity.ts';
import type { Registration } from '../../../domain/entities/registration.entity.ts';
import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.ts';

interface SupabaseRpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

export interface SupabaseRpcClient {
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<SupabaseRpcResult>;
}

export class SupabaseRegistrationStoreAdapter implements RegistrationStorePort {
  constructor(private readonly client: SupabaseRpcClient) {}

  async commitRegistration(
    registration: Registration,
    receipt: RegistrationReceipt,
  ): Promise<RegistrationCommitResult> {
    const { data, error } = await this.client.rpc('commit_registration', {
      p_registration: serializeRegistration(registration),
      p_receipt: serializeReceipt(receipt),
    });
    if (error) {
      throw new Error(`Supabase commit_registration failed: ${error.message}`);
    }
    const result = requireRecord(data, 'commit_registration');
    if (result['kind'] === 'conflict') {
      return { kind: 'conflict' };
    }
    if (result['kind'] !== 'created' && result['kind'] !== 'duplicate') {
      throw new Error('Supabase commit_registration returned an unknown result.');
    }
    return {
      kind: result['kind'],
      receipt: deserializeReceipt(result['receipt']),
    };
  }
}

export class SupabaseCancellationStoreAdapter implements CancellationStorePort {
  constructor(private readonly client: SupabaseRpcClient) {}

  async applyCancellationAtomically(
    cancellation: RegistrationCancellation,
    receipt: RegistrationReceipt,
  ): Promise<CancellationApplyResult> {
    const { data, error } = await this.client.rpc('apply_registration_cancellation', {
      p_cancellation: {
        ...cancellation,
        occurredAt: cancellation.occurredAt.toISOString(),
        receivedAt: cancellation.receivedAt.toISOString(),
      },
      p_receipt: serializeReceipt(receipt),
    });
    if (error) {
      throw new Error(`Supabase apply_registration_cancellation failed: ${error.message}`);
    }
    const result = requireRecord(data, 'apply_registration_cancellation');
    const kind = result['kind'];
    if (kind === 'conflict') {
      return { kind };
    }
    if (kind !== 'cancelled' && kind !== 'duplicate' && kind !== 'pending-create' && kind !== 'stale') {
      throw new Error('Supabase apply_registration_cancellation returned an unknown result.');
    }
    return { kind, receipt: deserializeReceipt(result['receipt']) };
  }
}

function serializeRegistration(registration: Registration): Record<string, unknown> {
  return {
    ...registration,
    occurredAt: registration.occurredAt.toISOString(),
    receivedAt: registration.receivedAt.toISOString(),
  };
}

function serializeReceipt(receipt: RegistrationReceipt): Record<string, unknown> {
  return {
    ...receipt,
    receivedAt: receipt.receivedAt.toISOString(),
    expiresAt: receipt.expiresAt.toISOString(),
  };
}

function deserializeReceipt(value: unknown): RegistrationReceipt {
  const record = requireRecord(value, 'receipt');
  const eventType = stringField(record, 'eventType', 'event_type');
  if (eventType !== 'registration' && eventType !== 'cancellation') {
    throw new Error('Supabase returned a receipt with an invalid event type.');
  }
  return {
    receiptId: stringField(record, 'receiptId', 'receipt_id'),
    tenantId: stringField(record, 'tenantId', 'tenant_id'),
    providerEventId: stringField(record, 'providerEventId', 'provider_event_id'),
    eventType,
    payloadDigest: stringField(record, 'payloadDigest', 'payload_digest'),
    receivedAt: dateField(record, 'receivedAt', 'received_at'),
    expiresAt: dateField(record, 'expiresAt', 'expires_at'),
  };
}

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Supabase ${description} response was not an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, camel: string, snake: string): string {
  const value = record[camel] ?? record[snake];
  if (typeof value !== 'string') {
    throw new Error(`Supabase response is missing ${camel}.`);
  }
  return value;
}

function dateField(record: Record<string, unknown>, camel: string, snake: string): Date {
  const value = stringField(record, camel, snake);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Supabase response contains an invalid ${camel}.`);
  }
  return date;
}
