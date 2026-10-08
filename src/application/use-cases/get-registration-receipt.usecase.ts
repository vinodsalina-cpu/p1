import type { GetRegistrationReceiptPort, GetRegistrationReceiptQuery } from '../ports/inbound/get-registration-receipt.port.js';
import type { ReceiptQueryPort } from '../ports/outbound/receipt-query.port.js';

export class GetRegistrationReceiptUseCase implements GetRegistrationReceiptPort {
  constructor(private readonly receipts: ReceiptQueryPort) {}

  execute(query: GetRegistrationReceiptQuery) {
    return this.receipts.findByTenantAndId(query.tenantId, query.receiptId);
  }
}