import type { RegistrationReceipt } from '../../../domain/entities/registration-receipt.entity.ts';

/** Raw bytes are passed intact so the application can verify HMAC before parsing. */
export interface ReceiveRegistrationCommand {
  readonly credentialId: string;
  readonly signedAt: string;
  readonly signature: string;
  readonly rawBody: Uint8Array;
}

export interface ReceiveRegistrationResult {
  readonly disposition: 'created' | 'duplicate';
  readonly receipt: RegistrationReceipt;
}

export interface ReceiveRegistrationPort {
  execute(command: ReceiveRegistrationCommand): Promise<ReceiveRegistrationResult>;
}

export interface ReceiveRegistrationHandler {
  execute(command: ReceiveRegistrationCommand): Promise<ReceiveRegistrationResult>;
}

export interface ReceiveRegistrationHandlerFactory {
  create(): ReceiveRegistrationHandler;
}
