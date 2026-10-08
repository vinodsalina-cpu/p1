import type { Registration } from '../../../domain/entities/registration.entity.js';

export interface ListWorkshopRegistrationsQuery {
  readonly tenantId: string;
  readonly workshopId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListWorkshopRegistrationsResult {
  readonly registrations: readonly Registration[];
  readonly nextCursor?: string;
}

export interface ListWorkshopRegistrationsPort {
  execute(query: ListWorkshopRegistrationsQuery): Promise<ListWorkshopRegistrationsResult>;
}
