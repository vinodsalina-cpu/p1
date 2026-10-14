import type { GetRegistrationReceiptPort } from '../../../application/ports/inbound/get-registration-receipt.port.ts';

export async function adminGetReceiptHandler(
  request: Request,
  getRegistrationReceipt: GetRegistrationReceiptPort,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'Only GET is supported.');
  }
  try {
    const receiptId = new URL(request.url).pathname.split('/').at(-1);
    const tenantId = new URL(request.url).searchParams.get('tenantId');
    if (!receiptId || !tenantId) {
      return errorResponse(400, 'invalid_request', 'receiptId and tenantId are required.');
    }
    const receipt = await getRegistrationReceipt.execute({ tenantId, receiptId });
    if (!receipt) {
      return errorResponse(404, 'receipt_not_found', 'Registration receipt not found.');
    }
    return jsonResponse(receipt, 200);
  } catch (error) {
    if (error instanceof TypeError) {
      return errorResponse(400, 'invalid_request', error.message);
    }
    return errorResponse(503, 'service_unavailable', 'The receipt could not be retrieved.');
  }
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