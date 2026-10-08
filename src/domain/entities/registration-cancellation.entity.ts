/** A provider cancellation is retained as an ordered domain event. */
export interface RegistrationCancellation {
  readonly tenantId: string;
  readonly providerRegistrationId: string;
  readonly providerEventId: string;
  readonly sequence: number;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly schemaVersion: number;
  readonly payloadDigest: string;
}

//add the event to the provider registration's cancellation history, and return the updated registration.

export interface AddRegistrationCancellationPort {
  execute(cancellation: RegistrationCancellation): Promise<void>;
}

export interface GetRegistrationCancellationQuery {
  readonly tenantId: string;
  readonly providerRegistrationId: string;
  readonly sequence: number;
}