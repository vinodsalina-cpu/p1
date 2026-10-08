export class RegistrationConflictException extends Error {
  constructor(message = 'This provider event ID was already used with a different payload.') {
    super(message);
    this.name = 'RegistrationConflictException';
  }
}