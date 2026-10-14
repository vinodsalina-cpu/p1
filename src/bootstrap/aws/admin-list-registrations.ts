import { ListWorkshopRegistrationsUseCase } from '../../application/use-cases/list-workshop-registrations.usecase.ts';
import {
  invokeWebHandler,
  serviceUnavailableResponse,
  type HttpApiGatewayEvent,
} from '../../infrastructure/handlers/api-gateway/aws-http-api.ts';
import { adminListRegistrationsHandler } from '../../infrastructure/handlers/api-gateway/admin-list-registrations.ts';
import { createAdminRegistrationStore } from './admin-registration-runtime.ts';

export async function handler(event: HttpApiGatewayEvent) {
  try {
    const store = createAdminRegistrationStore();
    const useCase = new ListWorkshopRegistrationsUseCase(store);
    return await invokeWebHandler(event, (request) => adminListRegistrationsHandler(request, useCase));
  } catch {
    console.error('Admin workshop lookup infrastructure is unavailable.');
    return serviceUnavailableResponse();
  }
}
