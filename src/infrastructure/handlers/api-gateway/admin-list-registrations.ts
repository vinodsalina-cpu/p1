import type { ListWorkshopRegistrationsPort } from '../../../application/ports/inbound/list-workshop-registrations.port.ts';

export async function adminListRegistrationsHandler(
  request: Request,
  listWorkshopRegistrations: ListWorkshopRegistrationsPort,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'Only GET is supported.');
  }
  try {
    const url = new URL(request.url);
    const workshopId = url.pathname.split('/').at(-2);
    const tenantId = url.searchParams.get('tenantId');
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!workshopId || !tenantId) {
      return errorResponse(400, 'invalid_request', 'workshopId and tenantId are required.');
    }
    const result = await listWorkshopRegistrations.execute({
      tenantId,
      workshopId,
      limit,
      ...(url.searchParams.has('cursor') ? { cursor: url.searchParams.get('cursor') ?? '' } : {}),
    });
    return jsonResponse(result, 200);
  } catch (error) {
    if (error instanceof TypeError) {
      return errorResponse(400, 'invalid_request', error.message);
    }
    return errorResponse(503, 'service_unavailable', 'Workshop registrations could not be retrieved.');
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