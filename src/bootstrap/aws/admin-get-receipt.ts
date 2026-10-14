import { GetRegistrationReceiptUseCase } from '../../application/use-cases/get-registration-receipt.usecase.ts';
import {
  invokeWebHandler,
  serviceUnavailableResponse,
  type HttpApiGatewayEvent,
} from '../../infrastructure/handlers/api-gateway/aws-http-api.ts';
import { adminGetReceiptHandler } from '../../infrastructure/handlers/api-gateway/admin-get-receipt.ts';
import { createAdminRegistrationStore } from './admin-registration-runtime.ts';

export async function handler(event: HttpApiGatewayEvent) {
  try {
    const store = createAdminRegistrationStore();
    const useCase = new GetRegistrationReceiptUseCase(store);
    return await invokeWebHandler(event, (request) => adminGetReceiptHandler(request, useCase));
  } catch {
    console.error('Admin receipt lookup infrastructure is unavailable.');
    return serviceUnavailableResponse();
  }
}
