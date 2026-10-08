/** Keeps time access replaceable and independent of Node/Deno APIs. */
export interface ClockPort {
  now(): Date;
}
