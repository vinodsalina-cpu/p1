export interface WebhookCredential {
  readonly tenantId: string;
  readonly secret: Uint8Array;
}

/** Resolves configured credentials; provider-supplied tenant values are not trusted. */
export interface WebhookCredentialPort {
  resolve(credentialId: string): Promise<WebhookCredential | null>;
}
