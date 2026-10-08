import type { Registration } from '../../../domain/entities/registration.entity.js';

export interface WorkshopRegistrationPage {
  readonly registrations: readonly Registration[];
  readonly nextCursor?: string;
}

export interface WorkshopRegistrationQueryPort {
  listByWorkshop(input: {
    readonly tenantId: string;
    readonly workshopId: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<WorkshopRegistrationPage>;
}
