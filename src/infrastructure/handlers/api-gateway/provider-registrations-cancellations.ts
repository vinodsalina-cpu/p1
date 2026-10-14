import type { CancelRegistrationPort } from '../../../application/ports/inbound/cancel-registration.port.ts';
import { handleProviderCancellation } from './provider-callback-http.ts';

export function providerRegistrationCancellationsHandler(
  request: Request,
  cancelRegistration: CancelRegistrationPort,
): Promise<Response> {
  return handleProviderCancellation(request, cancelRegistration);
}
