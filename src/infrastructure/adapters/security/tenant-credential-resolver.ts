import type {
  WebhookCredential,
  WebhookCredentialPort,
} from '../../../application/ports/outbound/webhook-credential.port.ts';

/** Resolves credential IDs from deployment-provided configuration. */
export class TenantCredentialResolver implements WebhookCredentialPort {
  constructor(private readonly credentials: ReadonlyMap<string, WebhookCredential>) {}

  async resolve(credentialId: string): Promise<WebhookCredential | null> {
    const credential = this.credentials.get(credentialId);
    return credential
      ? { tenantId: credential.tenantId, secret: credential.secret.slice() }
      : null;
  }
}

/** Parses a JSON object of credential IDs to { tenantId, secret } values. */
export function parseWebhookCredentials(value: string): ReadonlyMap<string, WebhookCredential> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TypeError('WEBHOOK_CREDENTIALS must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('WEBHOOK_CREDENTIALS must be a JSON object.');
  }

  const entries = new Map<string, WebhookCredential>();
  for (const [credentialId, candidate] of Object.entries(parsed)) {
    if (
      typeof candidate !== 'object'
      || candidate === null
      || typeof Reflect.get(candidate, 'tenantId') !== 'string'
      || typeof Reflect.get(candidate, 'secret') !== 'string'
    ) {
      throw new TypeError(`Credential ${credentialId} must contain tenantId and secret strings.`);
    }
    const tenantId = Reflect.get(candidate, 'tenantId') as string;
    const secret = Reflect.get(candidate, 'secret') as string;
    if (credentialId.length === 0 || tenantId.length === 0 || secret.length < 32) {
      throw new TypeError(`Credential ${credentialId} is invalid or its secret is shorter than 32 characters.`);
    }
    entries.set(credentialId, { tenantId, secret: new TextEncoder().encode(secret) });
  }
  if (entries.size === 0) {
    throw new TypeError('WEBHOOK_CREDENTIALS must contain at least one credential.');
  }
  return entries;
}