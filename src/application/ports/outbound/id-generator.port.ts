/** Generates canonical receipt IDs without coupling the application to a runtime. */
export interface IdGeneratorPort {
  nextId(): string;
}
