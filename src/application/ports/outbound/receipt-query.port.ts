import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.js';

export interface ReceiptQueryPort {
  findByTenantAndId(tenantId: string, receiptId: string): Promise<RegistrationReceipt | null>;
}
