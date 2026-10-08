export class TenantMismatchException extends Error {
  constructor(message = 'The callback tenant does not match the authenticated provider tenant.') {
    super(message);
    this.name = 'TenantMismatchException';
  }
}