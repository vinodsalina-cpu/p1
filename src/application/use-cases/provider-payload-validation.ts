const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|\+00:00)$/;

export function parseUtcTimestamp(value: string, fieldName: string): Date {
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  const timestamp = new Date(value);
  const hour = match ? Number(match[4]) : -1;
  const minute = match ? Number(match[5]) : -1;
  const second = match ? Number(match[6]) : -1;
  const calendarDate = match
    ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`)
    : null;
  if (
    !match
    || !Number.isFinite(timestamp.getTime())
    || calendarDate === null
    || !Number.isFinite(calendarDate.getTime())
    || calendarDate.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new TypeError(`${fieldName} must be an ISO-8601 UTC timestamp.`);
  }
  return timestamp;
}
