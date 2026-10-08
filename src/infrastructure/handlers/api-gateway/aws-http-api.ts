export interface HttpApiGatewayEvent {
  readonly rawPath: string;
  readonly rawQueryString?: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly requestContext: {
    readonly http: { readonly method: string };
  };
}

export interface HttpApiGatewayResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export async function invokeWebHandler(
  event: HttpApiGatewayEvent,
  handle: (request: Request) => Promise<Response>,
): Promise<HttpApiGatewayResponse> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers)) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const body = event.body === undefined
    ? undefined
    : event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : new TextEncoder().encode(event.body);
  const method = event.requestContext.http.method;
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const request = new Request(`https://callback.invalid${event.rawPath}${query}`, {
    method,
    headers,
    ...body && method !== 'GET' && method !== 'HEAD' ? { body } : {},
  });
  const response = await handle(request);
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}

export function serviceUnavailableResponse(): HttpApiGatewayResponse {
  return {
    statusCode: 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      error: {
        code: 'service_unavailable',
        message: 'The requested operation is temporarily unavailable.',
      },
    }),
  };
}
