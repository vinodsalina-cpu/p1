import { ReceiveRegistrationUseCase } from '../../application/use-cases/receive-registration.usecase.js';
import {
  invokeWebHandler,
  serviceUnavailableResponse,
  type HttpApiGatewayEvent,
} from '../../infrastructure/handlers/api-gateway/aws-http-api.js';
import { providerRegistrationsHandler } from '../../infrastructure/handlers/api-gateway/provider-registrations.js';
import { createCallbackRuntime } from './provider-callback-runtime.js';

export async function handler(event: HttpApiGatewayEvent) {
  try {
    const runtime = createCallbackRuntime();
    const useCase = new ReceiveRegistrationUseCase(
      runtime.credentials,
      runtime.signatureVerifier,
      runtime.store,
      runtime.digest,
      runtime.ids,
      runtime.clock,
    );
    return await invokeWebHandler(event, (request) => providerRegistrationsHandler(request, useCase));
  } catch {
    console.error('Provider registration callback infrastructure is unavailable.');
    return serviceUnavailableResponse();
  }
}
