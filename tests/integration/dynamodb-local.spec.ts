import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoRegistrationStoreAdapter } from '../../src/infrastructure/adapters/database/dynamo-registration-store.adapter.js';
import type { Registration } from '../../src/domain/entities/registration.entity.js';
import type { RegistrationReceipt } from '../../src/domain/entities/registration-receipt.entity.js';

const endpoint = process.env['DYNAMODB_ENDPOINT'];
if (!endpoint || !['localhost', '127.0.0.1', 'host.docker.internal', ...(process.env.P1_LOCAL_TEST_HOSTS ?? '').split(',')].includes(new URL(endpoint).hostname)) {
  throw new Error('DYNAMODB_ENDPOINT must point to a local DynamoDB emulator.');
}

const tableName = `p1-integration-${crypto.randomUUID()}`;
const client = new DynamoDBClient({
  endpoint,
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const documentClient = DynamoDBDocumentClient.from(client);
const store = new DynamoRegistrationStoreAdapter(documentClient, tableName);

const now = new Date();
const registration: Registration = {
  tenantId: 'tenant-1',
  providerEventId: 'event-1',
  providerRegistrationId: 'registration-1',
  workshopId: 'workshop-1',
  externalParticipantId: 'participant-1',
  occurredAt: now,
  receivedAt: now,
  schemaVersion: 1,
};
const receipt: RegistrationReceipt = {
  receiptId: crypto.randomUUID(),
  tenantId: 'tenant-1',
  providerEventId: 'event-1',
  eventType: 'registration',
  payloadDigest: 'a'.repeat(64),
  receivedAt: now,
  expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
};

beforeAll(async () => {
  await client.send(new CreateTableCommand({
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'workshopPK', AttributeType: 'S' },
      { AttributeName: 'workshopSK', AttributeType: 'S' },
      { AttributeName: 'receiptId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'WorkshopIndex',
        KeySchema: [
          { AttributeName: 'workshopPK', KeyType: 'HASH' },
          { AttributeName: 'workshopSK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'ReceiptIndex',
        KeySchema: [{ AttributeName: 'receiptId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  }));
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
}, 40_000);

afterAll(async () => {
  await client.send(new DeleteTableCommand({ TableName: tableName }));
  documentClient.destroy();
  client.destroy();
});

describe('DynamoDB Local registration adapter', () => {
  it('commits one receipt and registration for 100 concurrent duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => store.commitRegistration(registration, receipt)),
    );
    expect(results.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'duplicate')).toHaveLength(99);
    expect(results.every((result) => result.kind === 'created' || result.kind === 'duplicate')).toBe(true);
    expect(new Set(results.map((result) => result.kind === 'conflict' ? '' : result.receipt.receiptId)))
      .toEqual(new Set([receipt.receiptId]));
    expect((await documentClient.send(new ScanCommand({ TableName: tableName, Select: 'COUNT' }))).Count)
      .toBe(2);
  }, 120_000);

  it('recovers the canonical receipt after replacing the client and rejects a changed digest', async () => {
    const restartedClient = DynamoDBDocumentClient.from(new DynamoDBClient({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }));
    try {
      const restartedStore = new DynamoRegistrationStoreAdapter(restartedClient, tableName);
      const retry = await restartedStore.commitRegistration(registration, {
        ...receipt,
        receiptId: crypto.randomUUID(),
      });
      expect(retry.kind).toBe('duplicate');
      if (retry.kind === 'duplicate') expect(retry.receipt.receiptId).toBe(receipt.receiptId);

      const conflict = await restartedStore.commitRegistration(registration, {
        ...receipt,
        payloadDigest: 'b'.repeat(64),
      });
      expect(conflict.kind).toBe('conflict');
      expect((await restartedClient.send(new ScanCommand({ TableName: tableName, Select: 'COUNT' }))).Count)
        .toBe(2);
    } finally {
      restartedClient.destroy();
    }
  }, 30_000);
});
