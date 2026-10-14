import type {
  ListWorkshopRegistrationsPort,
  ListWorkshopRegistrationsQuery,
  ListWorkshopRegistrationsResult,
} from '../ports/inbound/list-workshop-registrations.port.ts';
import type { WorkshopRegistrationQueryPort } from '../ports/outbound/workshop-registration-query.port.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export class ListWorkshopRegistrationsUseCase implements ListWorkshopRegistrationsPort {
  constructor(private readonly registrations: WorkshopRegistrationQueryPort) {}

  execute(query: ListWorkshopRegistrationsQuery): Promise<ListWorkshopRegistrationsResult> {
    if (!query.tenantId || !query.workshopId) {
      throw new TypeError('tenantId and workshopId are required.');
    }
    const limit = query.limit || DEFAULT_PAGE_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new TypeError(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
    }
    return this.registrations.listByWorkshop({
      ...query,
      limit,
    });
  }
}