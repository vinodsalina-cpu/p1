import { CancelRegistrationUseCase } from '../../application/use-cases/cancel-registration.usecase.ts';
import {
  invokeWebHandler,
  serviceUnavailableResponse,
  type HttpApiGatewayEvent,
} from '../../infrastructure/handlers/api-gateway/aws-http-api.ts';
import { providerRegistrationCancellationsHandler } from '../../infrastructure/handlers/api-gateway/provider-registrations-cancellations.ts';
import { createCallbackRuntime } from './provider-callback-runtime.ts';

export async function handler(event: HttpApiGatewayEvent) {
  try {
    const runtime = createCallbackRuntime();
    const useCase = new CancelRegistrationUseCase(
      runtime.credentials,
      runtime.signatureVerifier,
      runtime.store,
      runtime.digest,
      runtime.ids,
      runtime.clock,
    );
    return await invokeWebHandler(event, (request) => providerRegistrationCancellationsHandler(request, useCase));
  } catch {
    console.error('Provider cancellation callback infrastructure is unavailable.');
    return serviceUnavailableResponse();
  }
}