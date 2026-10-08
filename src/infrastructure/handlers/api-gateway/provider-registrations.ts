import type { ReceiveRegistrationPort } from '../../../application/ports/inbound/receive-registration.port.js';
import { handleProviderRegistration } from './provider-callback-http.js';

export function providerRegistrationsHandler(
  request: Request,
  receiveRegistration: ReceiveRegistrationPort,
): Promise<Response> {
  return handleProviderRegistration(request, receiveRegistration);
}
