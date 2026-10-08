import type { CancelRegistrationCommand, CancelRegistrationPort } from '../../../application/ports/inbound/cancel-registration.port.js';
import type { ReceiveRegistrationCommand, ReceiveRegistrationPort } from '../../../application/ports/inbound/receive-registration.port.js';
import { InvalidSignatureException } from '../../../domain/exceptions/invalid-signature.exception.js';
import { RegistrationConflictException } from '../../../domain/exceptions/registration-conflict.exception.js';
import { TenantMismatchException } from '../../../domain/exceptions/tenant-mismatch.exception.js';

export const MAX_PROVIDER_BODY_BYTES = 16 * 1024;

export async function handleProviderRegistration(
  request: Request,
  port: ReceiveRegistrationPort,
): Promise<Response> {
  return handleProviderCallback(request, (command) => port.execute(command));
}

export async function handleProviderCancellation(
  request: Request,
  port: CancelRegistrationPort,
): Promise<Response> {
  return handleProviderCallback(request, (command) => port.execute(command));
}

async function handleProviderCallback(
  request: Request,
  execute: (command: ReceiveRegistrationCommand & CancelRegistrationCommand) =>
    Promise<{ readonly disposition: string; readonly receipt: unknown }>,
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Only POST is supported.');
    }
    const rawBody = await readBoundedBody(request);
    const command = {
      credentialId: request.headers.get('x-provider-credential-id') ?? '',
      signedAt: request.headers.get('x-provider-timestamp') ?? '',
      signature: request.headers.get('x-provider-signature') ?? '',
      rawBody,
    };
    const result = await execute(command);
    return jsonResponse(
      { receipt: result.receipt },
      result.disposition === 'duplicate' ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(413, 'payload_too_large', 'Request body exceeds 16 KiB.');
    }
    if (error instanceof InvalidSignatureException) {
      return errorResponse(401, 'invalid_signature', error.message);
    }
    if (error instanceof TenantMismatchException) {
      return errorResponse(403, 'tenant_mismatch', error.message);
    }
    if (error instanceof RegistrationConflictException) {
      return errorResponse(409, 'event_conflict', error.message);
    }
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return errorResponse(400, 'invalid_request', error.message);
    }
    return errorResponse(503, 'service_unavailable', 'The callback could not be durably recorded.');
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_PROVIDER_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.length;
      if (totalBytes > MAX_PROVIDER_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const rawBody = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.length;
  }
  return rawBody;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

class BodyTooLargeError extends Error {}
