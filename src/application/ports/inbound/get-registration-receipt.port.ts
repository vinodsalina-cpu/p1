import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.ts';

export interface GetRegistrationReceiptQuery {
  readonly tenantId: string;
  readonly receiptId: string;
}

export interface GetRegistrationReceiptPort {
  execute(query: GetRegistrationReceiptQuery): Promise<RegistrationReceipt | null>;
}
