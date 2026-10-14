import type { ReceiveRegistrationPort } from '../../../application/ports/inbound/receive-registration.port.ts';
import { handleProviderRegistration } from './provider-callback-http.ts';

export function providerRegistrationsHandler(
  request: Request,
  receiveRegistration: ReceiveRegistrationPort,
): Promise<Response> {
  return handleProviderRegistration(request, receiveRegistration);
}
