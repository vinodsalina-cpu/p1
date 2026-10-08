export interface VerifyWebhookSignatureInput {
  readonly rawBody: Uint8Array;
  readonly signedAt: string;
  readonly signature: string;
  readonly secret: Uint8Array;
  readonly now: Date;
}

/** Verifies the timestamp window and HMAC over the untouched request bytes. */
export interface SignatureVerifierPort {
  verify(input: VerifyWebhookSignatureInput): Promise<boolean>;
}
