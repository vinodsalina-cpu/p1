/** Computes the stable digest used to reject changed payloads for an idempotency key. */
export interface PayloadDigestPort {
  sha256(rawBody: Uint8Array): Promise<string>;
}
