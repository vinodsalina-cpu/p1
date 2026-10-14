import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ClockPort } from '../../application/ports/outbound/clock.port.ts';
import type { IdGeneratorPort } from '../../application/ports/outbound/id-generator.port.ts';
import { DynamoRegistrationStoreAdapter } from '../../infrastructure/adapters/database/dynamo-registration-store.adapter.ts';
import { HmacSignatureVerifier } from '../../infrastructure/adapters/security/hmac-signature-verifier.ts';
import { SecretsManagerCredentialResolver } from '../../infrastructure/adapters/security/secrets-manager-credential-resolver.ts';
import { WebCryptoPayloadDigest } from '../../infrastructure/adapters/security/web-crypto-payload-digest.ts';

const clock: ClockPort = { now: () => new Date() };
const ids: IdGeneratorPort = { nextId: () => globalThis.crypto.randomUUID() };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const secrets = new SecretsManagerClient({});
let callbackRuntime: ReturnType<typeof buildCallbackRuntime> | undefined;

export function createCallbackRuntime() {
  return callbackRuntime ??= buildCallbackRuntime();
}

function buildCallbackRuntime() {
  const tableName = process.env['REGISTRATIONS_TABLE'];
  if (!tableName) {
    throw new Error('REGISTRATIONS_TABLE is required.');
  }
  const store = new DynamoRegistrationStoreAdapter(dynamo, tableName);
  const credentials = new SecretsManagerCredentialResolver(
    secrets,
    process.env['WEBHOOK_SECRET_ARN'] ?? '',
  );
  return {
    clock,
    ids,
    store,
    credentials,
    digest: new WebCryptoPayloadDigest(),
    signatureVerifier: new HmacSignatureVerifier(),
  };
}
