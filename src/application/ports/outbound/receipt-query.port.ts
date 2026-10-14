import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.ts';

export interface ReceiptQueryPort {
  findByTenantAndId(tenantId: string, receiptId: string): Promise<RegistrationReceipt | null>;
}
