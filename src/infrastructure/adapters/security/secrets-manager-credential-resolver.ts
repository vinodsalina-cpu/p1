import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { WebhookCredential, WebhookCredentialPort } from '../../../application/ports/outbound/webhook-credential.port.ts';
import { parseWebhookCredentials } from './tenant-credential-resolver.ts';

export class SecretsManagerCredentialResolver implements WebhookCredentialPort {
  private credentialMap: ReadonlyMap<string, WebhookCredential> | undefined;
  private credentialExpiresAt = 0;
  private credentialPromise: Promise<ReadonlyMap<string, WebhookCredential>> | undefined;

  constructor(
    private readonly client: SecretsManagerClient,
    private readonly secretArn: string,
  ) {}

  async resolve(credentialId: string): Promise<WebhookCredential | null> {
    const credentials = this.credentialMap && Date.now() < this.credentialExpiresAt
      ? this.credentialMap
      : await this.loadCachedCredentials();
    const credential = credentials.get(credentialId);
    return credential
      ? { tenantId: credential.tenantId, secret: credential.secret.slice() }
      : null;
  }

  private async loadCachedCredentials(): Promise<ReadonlyMap<string, WebhookCredential>> {
    if (!this.credentialPromise) {
      this.credentialPromise = this.loadCredentials().then((credentials) => {
        this.credentialMap = credentials;
        this.credentialExpiresAt = Date.now() + 60_000;
        return credentials;
      }).finally(() => {
        this.credentialPromise = undefined;
      });
    }
    return this.credentialPromise;
  }

  private async loadCredentials(): Promise<ReadonlyMap<string, WebhookCredential>> {
    if (this.secretArn.length === 0) {
      throw new Error('WEBHOOK_SECRET_ARN is required.');
    }
    const response = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretArn }));
    if (!response.SecretString) {
      throw new Error('The webhook secret must be stored as a Secrets Manager JSON string.');
    }
    try {
      return parseWebhookCredentials(response.SecretString);
    } catch (error) {
      throw new Error('The webhook secret has an invalid credential configuration.', { cause: error });
    }
  }
}
