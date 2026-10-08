import type { CancelRegistrationPort } from '../../../application/ports/inbound/cancel-registration.port.js';
import { handleProviderCancellation } from './provider-callback-http.js';

export function providerRegistrationCancellationsHandler(
  request: Request,
  cancelRegistration: CancelRegistrationPort,
): Promise<Response> {
  return handleProviderCancellation(request, cancelRegistration);
}
