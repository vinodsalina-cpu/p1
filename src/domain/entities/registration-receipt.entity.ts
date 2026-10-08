/** Canonical durable receipt for one tenant-scoped provider event. */
export type RegistrationReceiptEventType = 'registration' | 'cancellation';

export interface RegistrationReceipt {
  readonly receiptId: string;
  readonly tenantId: string;
  readonly providerEventId: string;
  readonly eventType: RegistrationReceiptEventType;
  readonly payloadDigest: string;
  readonly receivedAt: Date;
  readonly expiresAt: Date;
}
