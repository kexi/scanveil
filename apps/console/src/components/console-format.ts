// Why not construct per call: Intl.DateTimeFormat resolves locale data on every
// construction, and formatDate runs once per table row per render; the options are
// constant, so a single shared formatter avoids that repeated work.
const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

export function formatDate(value: string): string {
  const hasValue = value.length > 0;
  if (!hasValue) {
    return "unknown";
  }

  const date = new Date(value);
  const isValidDate = !Number.isNaN(date.getTime());
  if (!isValidDate) {
    return value;
  }

  return dateTimeFormat.format(date);
}

export function isScanStreamTerminalError(data: string | undefined): boolean {
  const hasData = typeof data === "string" && data.length > 0;
  if (!hasData) {
    return false;
  }

  try {
    const parsed = JSON.parse(data) as { error?: unknown };
    return parsed.error === "access_revoked" || parsed.error === "session_expired";
  } catch {
    return false;
  }
}
