import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoRegistrationStoreAdapter } from '../../infrastructure/adapters/database/dynamo-registration-store.adapter.ts';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

let store: DynamoRegistrationStoreAdapter | undefined;

export function createAdminRegistrationStore(): DynamoRegistrationStoreAdapter {
  if (store) {
    return store;
  }
  const tableName = process.env['REGISTRATIONS_TABLE'];
  if (!tableName) {
    throw new Error('REGISTRATIONS_TABLE is required.');
  }
  store = new DynamoRegistrationStoreAdapter(client, tableName);
  return store;
}
