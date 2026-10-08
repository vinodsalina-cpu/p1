export class InvalidSignatureException extends Error {
  constructor(message = 'The signature is missing, invalid, or expired.') {
    super(message);
    this.name = 'InvalidSignatureException';
  }
}