/** Domain registration state; contains no transport or persistence details. */
export interface Registration {
  readonly tenantId: string;
  readonly providerEventId: string;
  readonly providerRegistrationId: string;
  readonly workshopId: string;
  readonly externalParticipantId: string;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly schemaVersion: number;
}
