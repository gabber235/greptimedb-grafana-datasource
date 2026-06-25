export const GREPTIME_TRACE_DEFAULTS = {
  tagColumnPrefix: 'span_attributes.',
  serviceTagColumnPrefix: 'resource_attributes.',
  eventsColumn: 'span_events',
} as const;

export type GreptimeSpanEvent = {
  name?: string;
  time?: string;
  timestamp?: string;
  attributes?: Record<string, unknown>;
};

export type GrafanaTraceLogField = { key: string; value: string };
export type GrafanaTraceLog = { timestamp: number; fields: GrafanaTraceLogField[] };

export function normalizeTraceColumnPrefix(value: string | undefined, fallback: string): string {
  const prefix = value?.trim() || fallback;
  return prefix.endsWith('.') ? prefix : `${prefix}.`;
}

export function stripTraceColumnPrefix(columnName: string, prefix: string): string {
  return columnName.startsWith(prefix) ? columnName.slice(prefix.length) : columnName;
}

export function stringifyTraceValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
