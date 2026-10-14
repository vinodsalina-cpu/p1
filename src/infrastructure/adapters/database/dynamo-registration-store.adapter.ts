import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { ReceiptQueryPort } from '../../../application/ports/outbound/receipt-query.port.ts';
import type {
  WorkshopRegistrationPage,
  WorkshopRegistrationQueryPort,
} from '../../../application/ports/outbound/workshop-registration-query.port.ts';
import type { CancellationApplyResult, CancellationStorePort } from '../../../application/ports/outbound/cancellation-store.port.ts';
import type { RegistrationCommitResult, RegistrationStorePort } from '../../../application/ports/outbound/registration-store.port.ts';
import type { RegistrationCancellation } from '../../../domain/entities/registration-cancellation.entity.ts';
import type { Registration } from '../../../domain/entities/registration.entity.ts';
import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.ts';

const MAX_CANCELLATION_RETRIES = 5;

export class DynamoRegistrationStoreAdapter
  implements RegistrationStorePort, CancellationStorePort, ReceiptQueryPort, WorkshopRegistrationQueryPort {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async commitRegistration(
    registration: Registration,
    receipt: RegistrationReceipt,
  ): Promise<RegistrationCommitResult> {
    for (let attempt = 0; attempt < MAX_CANCELLATION_RETRIES; attempt += 1) {
      const existingReceipt = await this.getEventReceipt(receipt.tenantId, receipt.providerEventId);
      if (existingReceipt) {
        return compareExistingReceipt(existingReceipt, receipt);
      }
      const cancellationState = await this.getItem(
        registration.tenantId,
        `CANCELLATION#${registration.providerRegistrationId}`,
      );
      const registrationKey = {
        PK: tenantKey(registration.tenantId),
        SK: `REG#${registration.providerRegistrationId}`,
      };
      if (await this.getByKey(registrationKey)) {
        const committedReceipt = await this.getEventReceipt(receipt.tenantId, receipt.providerEventId);
        return committedReceipt ? compareExistingReceipt(committedReceipt, receipt) : { kind: 'conflict' };
      }

      const receiptItem = createReceiptItem(receipt);
      const registrationItem = {
        ...registrationKey,
        entityType: 'registration',
        tenantId: registration.tenantId,
        providerRegistrationId: registration.providerRegistrationId,
        providerEventId: registration.providerEventId,
        workshopId: registration.workshopId,
        externalParticipantId: registration.externalParticipantId,
        occurredAt: registration.occurredAt.toISOString(),
        receivedAt: registration.receivedAt.toISOString(),
        schemaVersion: registration.schemaVersion,
        cancelled: cancellationState?.['cancelled'] === true,
        cancellationSequence: typeof cancellationState?.['sequence'] === 'number'
          ? cancellationState['sequence']
          : 0,
        workshopPK: workshopKey(registration.tenantId, registration.workshopId),
        workshopSK: `${registration.occurredAt.toISOString()}#${registration.providerRegistrationId}`,
      };
      const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
        {
          Put: {
            TableName: this.tableName,
            Item: receiptItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: registrationItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          ConditionCheck: {
            TableName: this.tableName,
            Key: {
              PK: tenantKey(registration.tenantId),
              SK: `CANCELLATION#${registration.providerRegistrationId}`,
            },
            ...cancellationState
              ? {
                  ConditionExpression: '#sequence = :sequence',
                  ExpressionAttributeNames: { '#sequence': 'sequence' },
                  ExpressionAttributeValues: { ':sequence': cancellationState['sequence'] },
                }
              : { ConditionExpression: 'attribute_not_exists(PK)' },
          },
        },
      ];

      try {
        await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
        return { kind: 'created', receipt };
      } catch (error) {
        const existingReceipt = await this.getEventReceipt(receipt.tenantId, receipt.providerEventId);
        if (existingReceipt) {
          return compareExistingReceipt(existingReceipt, receipt);
        }
        if (await this.getByKey(registrationKey)) {
          const committedReceipt = await this.getEventReceipt(receipt.tenantId, receipt.providerEventId);
          return committedReceipt ? compareExistingReceipt(committedReceipt, receipt) : { kind: 'conflict' };
        }
        if (!isTransactionCanceled(error)) {
          throw error;
        }
      }
    }
    throw new Error('Registration could not be committed because cancellation state kept changing.');
  }

  async applyCancellationAtomically(
    cancellation: RegistrationCancellation,
    receipt: RegistrationReceipt,
  ): Promise<CancellationApplyResult> {
    for (let attempt = 0; attempt < MAX_CANCELLATION_RETRIES; attempt += 1) {
      const existingReceipt = await this.getEventReceipt(receipt.tenantId, receipt.providerEventId);
      if (existingReceipt) {
        return compareExistingCancellationReceipt(existingReceipt, receipt);
      }

      const stateKey = {
        PK: tenantKey(cancellation.tenantId),
        SK: `CANCELLATION#${cancellation.providerRegistrationId}`,
      };
      const [state, registration] = await Promise.all([
        this.getByKey(stateKey),
        this.getByKey({
          PK: tenantKey(cancellation.tenantId),
          SK: `REG#${cancellation.providerRegistrationId}`,
        }),
      ]);
      const currentSequence = typeof state?.['sequence'] === 'number' ? state['sequence'] : 0;
      const stale = cancellation.sequence <= currentSequence;
      const kind = stale ? 'stale' : registration ? 'cancelled' : 'pending-create';
      const eventItem = {
        PK: tenantKey(cancellation.tenantId),
        SK: `CANCEL_EVENT#${cancellation.providerEventId}`,
        entityType: 'cancellation',
        tenantId: cancellation.tenantId,
        providerEventId: cancellation.providerEventId,
        providerRegistrationId: cancellation.providerRegistrationId,
        sequence: cancellation.sequence,
        occurredAt: cancellation.occurredAt.toISOString(),
        receivedAt: cancellation.receivedAt.toISOString(),
        schemaVersion: cancellation.schemaVersion,
        payloadDigest: cancellation.payloadDigest,
      };
      const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
        {
          Put: {
            TableName: this.tableName,
            Item: createReceiptItem(receipt),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: eventItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ];
      if (!stale) {
        transactItems.push({
          Update: {
            TableName: this.tableName,
            Key: stateKey,
            UpdateExpression: 'SET #sequence = :sequence, occurredAt = :occurredAt, cancelled = :cancelled',
            ConditionExpression: state
              ? '#sequence = :previousSequence'
              : 'attribute_not_exists(PK)',
            ExpressionAttributeNames: { '#sequence': 'sequence' },
            ExpressionAttributeValues: {
              ':sequence': cancellation.sequence,
              ':occurredAt': cancellation.occurredAt.toISOString(),
              ':cancelled': true,
              ...(state ? { ':previousSequence': currentSequence } : {}),
            },
          },
        });
        if (registration) {
          transactItems.push({
            Update: {
              TableName: this.tableName,
              Key: {
                PK: tenantKey(cancellation.tenantId),
                SK: `REG#${cancellation.providerRegistrationId}`,
              },
              UpdateExpression: 'SET cancelled = :cancelled, cancellationSequence = :sequence',
              ExpressionAttributeValues: {
                ':cancelled': true,
                ':sequence': cancellation.sequence,
              },
            },
          });
        }
      }

      try {
        await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
        return { kind, receipt };
      } catch (error) {
        const committedReceipt = await this.getEventReceipt(receipt.tenantId, receipt.providerEventId);
        if (committedReceipt) {
          return compareExistingCancellationReceipt(committedReceipt, receipt);
        }
        if (!isTransactionCanceled(error)) {
          throw error;
        }
      }
    }
    throw new Error('Cancellation could not be committed because registration state kept changing.');
  }

  async findByTenantAndId(tenantId: string, receiptId: string): Promise<RegistrationReceipt | null> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'ReceiptIndex',
      KeyConditionExpression: 'receiptId = :receiptId',
      ExpressionAttributeValues: { ':receiptId': receiptId },
      Limit: 2,
      ConsistentRead: false,
    }));
    const matches = (result.Items ?? []).filter(
      (item) => item['tenantId'] === tenantId && item['entityType'] === 'receipt',
    );
    if (matches.length > 1) {
      throw new Error('DynamoDB returned multiple receipts for one receipt ID.');
    }
    return matches[0] ? restoreReceipt(matches[0]) : null;
  }

  async listByWorkshop(input: {
    readonly tenantId: string;
    readonly workshopId: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<WorkshopRegistrationPage> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'WorkshopIndex',
      KeyConditionExpression: 'workshopPK = :workshopPK',
      ExpressionAttributeValues: { ':workshopPK': workshopKey(input.tenantId, input.workshopId) },
      Limit: input.limit + 1,
      ScanIndexForward: true,
      ...(input.cursor ? { ExclusiveStartKey: decodeCursor(input.cursor) } : {}),
    }));
    const items = (result.Items ?? []).filter((item) =>
      item['entityType'] === 'registration'
      && item['tenantId'] === input.tenantId
      && item['workshopId'] === input.workshopId
    );
    const hasMore = items.length > input.limit;
    const pageItems = hasMore ? items.slice(0, input.limit) : items;
    return {
      registrations: pageItems.map(restoreRegistration),
      ...(hasMore && result.LastEvaluatedKey
        ? { nextCursor: encodeCursor(result.LastEvaluatedKey) }
        : {}),
    };
  }

  private async getEventReceipt(tenantId: string, providerEventId: string): Promise<Record<string, unknown> | undefined> {
    return this.getByKey({
      PK: tenantKey(tenantId),
      SK: `EVENT#${providerEventId}`,
    });
  }

  private async getItem(tenantId: string, sortKey: string): Promise<Record<string, unknown> | undefined> {
    return this.getByKey({ PK: tenantKey(tenantId), SK: sortKey });
  }

  private async getByKey(key: { readonly PK: string; readonly SK: string }): Promise<Record<string, unknown> | undefined> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: key,
      ConsistentRead: true,
    }));
    return isRecord(result.Item) ? result.Item : undefined;
  }
}

function createReceiptItem(receipt: RegistrationReceipt) {
  return {
    PK: tenantKey(receipt.tenantId),
    SK: `EVENT#${receipt.providerEventId}`,
    entityType: 'receipt',
    receiptId: receipt.receiptId,
    tenantId: receipt.tenantId,
    providerEventId: receipt.providerEventId,
    eventType: receipt.eventType,
    payloadDigest: receipt.payloadDigest,
    receivedAt: receipt.receivedAt.toISOString(),
    expiresAt: Math.floor(receipt.expiresAt.getTime() / 1000),
  };
}

function compareExistingReceipt(
  existing: Record<string, unknown>,
  requested: RegistrationReceipt,
): RegistrationCommitResult {
  const receipt = restoreReceipt(existing);
  return existing['eventType'] === requested.eventType && existing['payloadDigest'] === requested.payloadDigest
    ? { kind: 'duplicate', receipt }
    : { kind: 'conflict' };
}

function compareExistingCancellationReceipt(
  existing: Record<string, unknown>,
  requested: RegistrationReceipt,
): CancellationApplyResult {
  const receipt = restoreReceipt(existing);
  return existing['eventType'] === requested.eventType && existing['payloadDigest'] === requested.payloadDigest
    ? { kind: 'duplicate', receipt }
    : { kind: 'conflict' };
}

function restoreReceipt(item: Record<string, unknown>): RegistrationReceipt {
  const receiptId = item['receiptId'];
  const tenantId = item['tenantId'];
  const providerEventId = item['providerEventId'];
  const eventType = item['eventType'];
  const payloadDigest = item['payloadDigest'];
  const receivedAtValue = item['receivedAt'];
  const expiresAtValue = item['expiresAt'];
  if (
    typeof receiptId !== 'string'
    || typeof tenantId !== 'string'
    || typeof providerEventId !== 'string'
    || (eventType !== 'registration' && eventType !== 'cancellation')
    || typeof payloadDigest !== 'string'
    || typeof receivedAtValue !== 'string'
    || typeof expiresAtValue !== 'number'
  ) {
    throw new Error('DynamoDB returned an invalid canonical receipt.');
  }
  return {
    receiptId,
    tenantId,
    providerEventId,
    eventType,
    payloadDigest,
    receivedAt: new Date(receivedAtValue),
    expiresAt: new Date(expiresAtValue * 1000),
  };
}

function restoreRegistration(item: Record<string, unknown>): Registration {
  const tenantId = item['tenantId'];
  const providerEventId = item['providerEventId'];
  const providerRegistrationId = item['providerRegistrationId'];
  const workshopId = item['workshopId'];
  const externalParticipantId = item['externalParticipantId'];
  const occurredAt = item['occurredAt'];
  const receivedAt = item['receivedAt'];
  const schemaVersion = item['schemaVersion'];
  if (
    typeof tenantId !== 'string'
    || typeof providerEventId !== 'string'
    || typeof providerRegistrationId !== 'string'
    || typeof workshopId !== 'string'
    || typeof externalParticipantId !== 'string'
    || typeof occurredAt !== 'string'
    || typeof receivedAt !== 'string'
    || typeof schemaVersion !== 'number'
  ) {
    throw new Error('DynamoDB returned an invalid registration.');
  }
  const occurredAtDate = new Date(occurredAt);
  const receivedAtDate = new Date(receivedAt);
  if (!Number.isFinite(occurredAtDate.getTime()) || !Number.isFinite(receivedAtDate.getTime())) {
    throw new Error('DynamoDB returned invalid registration timestamps.');
  }
  return {
    tenantId,
    providerEventId,
    providerRegistrationId,
    workshopId,
    externalParticipantId,
    occurredAt: occurredAtDate,
    receivedAt: receivedAtDate,
    schemaVersion,
  };
}

function encodeCursor(cursor: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !isRecord(value)
      || typeof value['PK'] !== 'string'
      || typeof value['SK'] !== 'string'
      || typeof value['workshopPK'] !== 'string'
      || typeof value['workshopSK'] !== 'string'
    ) {
      throw new Error('Invalid workshop cursor.');
    }
    return value;
  } catch (error) {
    throw new TypeError('cursor must be a valid workshop pagination token.', { cause: error });
  }
}

function tenantKey(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function workshopKey(tenantId: string, workshopId: string): string {
  return `${tenantKey(tenantId)}#WORKSHOP#${workshopId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTransactionCanceled(error: unknown): boolean {
  return isRecord(error) && error['name'] === 'TransactionCanceledException';
}
