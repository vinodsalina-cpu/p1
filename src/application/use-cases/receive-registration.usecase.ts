import type { ReceiveRegistrationCommand, ReceiveRegistrationPort, ReceiveRegistrationResult } from '../ports/inbound/receive-registration.port.ts';
import type { ClockPort } from '../ports/outbound/clock.port.ts';
import type { IdGeneratorPort } from '../ports/outbound/id-generator.port.ts';
import type { PayloadDigestPort } from '../ports/outbound/payload-digest.port.ts';
import type { RegistrationStorePort } from '../ports/outbound/registration-store.port.ts';
import type { SignatureVerifierPort } from '../ports/outbound/signature-verifier.port.ts';
import type { WebhookCredentialPort } from '../ports/outbound/webhook-credential.port.ts';
import type { Registration } from '../../domain/entities/registration.entity.ts';
import type { RegistrationReceipt } from '../../domain/entities/registration-receipt.entity.ts';
import { InvalidSignatureException } from '../../domain/exceptions/invalid-signature.exception.ts';
import { RegistrationConflictException } from '../../domain/exceptions/registration-conflict.exception.ts';
import { TenantMismatchException } from '../../domain/exceptions/tenant-mismatch.exception.ts';
import { parseUtcTimestamp } from './provider-payload-validation.ts';

const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class ReceiveRegistrationUseCase implements ReceiveRegistrationPort {
  constructor(
    private readonly credentials: WebhookCredentialPort,
    private readonly signatureVerifier: SignatureVerifierPort,
    private readonly store: RegistrationStorePort,
    private readonly digest: PayloadDigestPort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: ReceiveRegistrationCommand): Promise<ReceiveRegistrationResult> {
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
    const body = validateRegistration(payload);
    if (body.tenantId !== credential.tenantId) {
      throw new TenantMismatchException();
    }

    const payloadDigest = await this.digest.sha256(command.rawBody);
    const registration: Registration = { ...body, receivedAt: now };
    const receipt: RegistrationReceipt = {
      receiptId: this.ids.nextId(),
      tenantId: credential.tenantId,
      providerEventId: body.providerEventId,
      eventType: 'registration',
      payloadDigest,
      receivedAt: now,
      expiresAt: new Date(Math.ceil(now.getTime() / 1000) * 1000 + RECEIPT_RETENTION_MS),
    };
    const result = await this.store.commitRegistration(registration, receipt);
    if (result.kind === 'conflict') {
      throw new RegistrationConflictException();
    }
    return { disposition: result.kind, receipt: result.receipt };
  }
}

interface RegistrationPayload {
  readonly tenantId: string;
  readonly providerEventId: string;
  readonly providerRegistrationId: string;
  readonly workshopId: string;
  readonly externalParticipantId: string;
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

function validateRegistration(value: unknown): RegistrationPayload {
  if (!isRecord(value)) {
    throw new TypeError('Request body must be a JSON object.');
  }
  const tenantId = requiredString(value, 'tenantId');
  const providerEventId = requiredString(value, 'providerEventId');
  const providerRegistrationId = requiredString(value, 'providerRegistrationId');
  const workshopId = requiredString(value, 'workshopId');
  const externalParticipantId = requiredString(value, 'externalParticipantId');
  const occurredAtValue = requiredString(value, 'occurredAt');
  const occurredAt = parseUtcTimestamp(occurredAtValue, 'occurredAt');
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 1) {
    throw new TypeError('schemaVersion must be 1.');
  }
  return {
    tenantId,
    providerEventId,
    providerRegistrationId,
    workshopId,
    externalParticipantId,
    occurredAt,
    schemaVersion,
  };
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
