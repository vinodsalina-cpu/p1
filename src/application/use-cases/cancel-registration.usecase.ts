import type { CancelRegistrationCommand, CancelRegistrationPort, CancelRegistrationResult } from '../ports/inbound/cancel-registration.port.ts';
import type { CancellationStorePort } from '../ports/outbound/cancellation-store.port.ts';
import type { ClockPort } from '../ports/outbound/clock.port.ts';
import type { IdGeneratorPort } from '../ports/outbound/id-generator.port.ts';
import type { PayloadDigestPort } from '../ports/outbound/payload-digest.port.ts';
import type { SignatureVerifierPort } from '../ports/outbound/signature-verifier.port.ts';
import type { WebhookCredentialPort } from '../ports/outbound/webhook-credential.port.ts';
import type { RegistrationCancellation } from '../../domain/entities/registration-cancellation.entity.ts';
import type { RegistrationReceipt } from '../../domain/entities/registration-receipt.entity.ts';
import { InvalidSignatureException } from '../../domain/exceptions/invalid-signature.exception.ts';
import { RegistrationConflictException } from '../../domain/exceptions/registration-conflict.exception.ts';
import { TenantMismatchException } from '../../domain/exceptions/tenant-mismatch.exception.ts';
import { parseUtcTimestamp } from './provider-payload-validation.ts';

const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class CancelRegistrationUseCase implements CancelRegistrationPort {
  constructor(
    private readonly credentials: WebhookCredentialPort,
    private readonly signatureVerifier: SignatureVerifierPort,
    private readonly store: CancellationStorePort,
    private readonly digest: PayloadDigestPort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: CancelRegistrationCommand): Promise<CancelRegistrationResult> {
    const credential = await this.credentials.resolve(command.credentialId);
    if (!credential) {
      throw new InvalidSignatureException();
    }

    const now = this.clock.now();
    const validSignature = await this.signatureVerifier.verify({
      rawBody: command.rawBody,
      signedAt: command.signedAt,
      signature: command.signature,
      secret: credential.secret,
      now,
    });
    if (!validSignature) {
      throw new InvalidSignatureException();
    }

    const payload = parseJson(command.rawBody);
    const body = validateCancellation(payload);
    if (body.tenantId !== credential.tenantId) {
      throw new TenantMismatchException();
    }

    const payloadDigest = await this.digest.sha256(command.rawBody);
    const cancellation: RegistrationCancellation = { ...body, receivedAt: now, payloadDigest };
    const receipt: RegistrationReceipt = {
      receiptId: this.ids.nextId(),
      tenantId: credential.tenantId,
      providerEventId: body.providerEventId,
      eventType: 'cancellation',
      payloadDigest,
      receivedAt: now,
      expiresAt: new Date(Math.ceil(now.getTime() / 1000) * 1000 + RECEIPT_RETENTION_MS),
    };
    const result = await this.store.applyCancellationAtomically(cancellation, receipt);
    if (result.kind === 'conflict') {
      throw new RegistrationConflictException();
    }
    return { disposition: result.kind, receipt: result.receipt };
  }
}

interface CancellationPayload {
  readonly tenantId: string;
  readonly providerEventId: string;
  readonly providerRegistrationId: string;
  readonly sequence: number;
  readonly occurredAt: Date;
  readonly schemaVersion: number;
}

function parseJson(rawBody: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)) as unknown;
  } catch {
    throw new TypeError('Request body must contain valid UTF-8 JSON.');
  }
}

function validateCancellation(value: unknown): CancellationPayload {
  if (!isRecord(value)) {
    throw new TypeError('Request body must be a JSON object.');
  }
  const record = value;
  const tenantId = requiredString(record, 'tenantId');
  const providerEventId = requiredString(record, 'providerEventId');
  const providerRegistrationId = requiredString(record, 'providerRegistrationId');
  const occurredAtValue = requiredString(record, 'occurredAt');
  const occurredAt = parseUtcTimestamp(occurredAtValue, 'occurredAt');
  const sequence = record['sequence'];
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError('sequence must be a positive integer.');
  }
  const schemaVersion = record['schemaVersion'];
  if (schemaVersion !== 1) {
    throw new TypeError('schemaVersion must be 1.');
  }
  return { tenantId, providerEventId, providerRegistrationId, sequence, occurredAt, schemaVersion };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${key} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
