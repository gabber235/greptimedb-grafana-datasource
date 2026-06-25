import {
  DataFrame,
  Field,
  FieldType,
  createDataFrame,
  DataFrameType,
} from '@grafana/data';

import { GreptimeColumnSchema, GreptimeDataTypes, GreptimeRecords, GreptimeResponse } from './types';
import { getColumnsByHint, logColumnHintsToAlias } from 'data/sqlGenerator';
import { ColumnHint, QueryBuilderOptions, QueryType } from 'types/queryBuilder';
import { CHQuery } from 'types/sql';
import { GrafanaTraceLog, GREPTIME_TRACE_DEFAULTS, GreptimeSpanEvent, normalizeTraceColumnPrefix, stringifyTraceValue, stripTraceColumnPrefix } from './traceModel';


/**
 * Maps GreptimeDB data type strings to Grafana FieldType enums.
 * @param greptimeType The data_type string from GreptimeDB schema.
 * @returns Corresponding Grafana FieldType.
 */
function mapGreptimeTypeToGrafana(greptimeType: string | undefined | null): FieldType {
  if (!greptimeType) {
    return FieldType.other;
  }
  const lowerType = greptimeType.toLowerCase();

  // Time types
  if (lowerType.includes('timestamp')) {
    return FieldType.time;
  }
  // Numeric types (covers int, float, double, decimal, numeric variants)
  if (lowerType.includes('int') || lowerType.includes('float') || lowerType.includes('double') || lowerType.includes('decimal') || lowerType.includes('numeric')) {
    return FieldType.number;
  }
  // Boolean types
  if (lowerType.includes('bool')) {
    return FieldType.boolean;
  }
  // String types
  if (lowerType.includes('string') || lowerType.includes('varchar') || lowerType.includes('text')) {
    return FieldType.string;
  }
  // Date types -> map to time for Grafana representation
  if (lowerType.includes('date')) {
    return FieldType.time;
  }
  // Interval types -> map to string for now
  if (lowerType.includes('interval')) {
    return FieldType.string;
  }

  // Log unhandled types and default to 'other'
  console.warn(`Unhandled GreptimeDB type: "${greptimeType}", mapping to FieldType.other.`);
  return FieldType.other;
}


export const greptimeTypeToGrafana: Record<GreptimeDataTypes, FieldType> = {
  [GreptimeDataTypes.Null]: FieldType.other,

  // Numeric types:
  [GreptimeDataTypes.Boolean]: FieldType.boolean,
  [GreptimeDataTypes.UInt8]: FieldType.number,
  [GreptimeDataTypes.UInt16]: FieldType.number,
  [GreptimeDataTypes.UInt32]: FieldType.number,
  [GreptimeDataTypes.UInt64]: FieldType.number,
  [GreptimeDataTypes.Int8]: FieldType.number,
  [GreptimeDataTypes.Int16]: FieldType.number,
  [GreptimeDataTypes.Int32]: FieldType.number,
  [GreptimeDataTypes.Int64]: FieldType.number,
  [GreptimeDataTypes.Float32]: FieldType.number,
  [GreptimeDataTypes.Float64]: FieldType.number,

  // String types:
  [GreptimeDataTypes.String]: FieldType.string,
  [GreptimeDataTypes.Binary]: FieldType.string,

  // Date & Time types:
  [GreptimeDataTypes.Date]: FieldType.time,
  [GreptimeDataTypes.DateTime]: FieldType.time,

  [GreptimeDataTypes.TimestampSecond]: FieldType.time,
  [GreptimeDataTypes.TimestampMillisecond]: FieldType.time,
  [GreptimeDataTypes.TimestampMicrosecond]: FieldType.time,
  [GreptimeDataTypes.TimestampNanosecond]: FieldType.time,

  [GreptimeDataTypes.List]: FieldType.other,
};


type GreptimeTimeType = GreptimeDataTypes.TimestampSecond | GreptimeDataTypes.TimestampMillisecond | GreptimeDataTypes.TimestampMicrosecond | GreptimeDataTypes.TimestampNanosecond
export function toMs(time: number, columnType: GreptimeTimeType) {
  switch (columnType) {
    case GreptimeDataTypes.TimestampSecond:
      return time * 1000
    case GreptimeDataTypes.TimestampMillisecond:
      return time
    case GreptimeDataTypes.TimestampMicrosecond:
      return time / 1000
    case GreptimeDataTypes.TimestampNanosecond:
      return time / 1000000
    default:  // Handle unexpected types
      console.warn(`Unexpected column type: ${columnType}. Defaulting to milliseconds.`);
      return time; // Default to milliseconds
  }
}


export function transformGreptimeDBLogs(sqlResponse: GreptimeResponse, query: CHQuery, contextColumns: string[]) {
  if (!sqlResponse.output || sqlResponse.output.length === 0) {
    console.error('GreptimeDB query failed or returned no data:', sqlResponse.error);
    return null; // Or handle the error as needed
  }

  const records = sqlResponse.output[0]?.records;
  if (!records || !records.schema || !records.rows) {
    console.error('Invalid GreptimeDB records format:', records);
    return null;
  }

  const columnSchemas = records.schema.column_schemas;
  const rows = records.rows;

  let timestampColumnIndex = -1;
  let bodyColumnIndex = -1;
  let severityColumnIndex = -1;
  let idColumnIndex = -1;
  const labelColumnIndices: Record<string, number> = {};
  const contextColumnIndices: Record<string, number> = {};

  
  if('builderOptions' in query) {

    columnSchemas.forEach((schema, index) => {
      const lowerCaseName = schema.name.toLowerCase();
      if (lowerCaseName === logColumnHintsToAlias.get(ColumnHint.Time)) {
        timestampColumnIndex = index;
      } else if (lowerCaseName === logColumnHintsToAlias.get(ColumnHint.LogMessage)) {
        bodyColumnIndex = index;
      } else if (lowerCaseName === logColumnHintsToAlias.get(ColumnHint.LogLevel)) {
        severityColumnIndex = index;
      } else if (contextColumns.includes(schema.name)) {
        contextColumnIndices[schema.name] = index;
      } else {
        // Consider other columns as potential labels
        labelColumnIndices[schema.name] = index;
      }
    });
  }

  const timestamps: number[] = [];
  const bodies: string[] = [];
  const severities: string[] = [];
  const ids: string[] = [];
  const labelsArray: Array<Record<string, any>> = [];
  const contextColumnValues: Record<string, string[]> = {};
  rows.forEach((row) => {
    const timestampValue = toMs(row[timestampColumnIndex], columnSchemas[timestampColumnIndex].data_type as GreptimeTimeType);

    timestamps.push(
      typeof timestampValue === 'string' || typeof timestampValue === 'number'
        ? new Date(timestampValue).getTime()
        : timestampValue
    );
    if (bodyColumnIndex !== -1) {
      bodies.push(String(row[bodyColumnIndex]));
    }
    if (severityColumnIndex !== -1) {
      severities.push(String(row[severityColumnIndex]));
    }


    const labels: Record<string, any> = {};
    for (const labelName in labelColumnIndices) {
      if (Object.prototype.hasOwnProperty.call(labelColumnIndices, labelName)) {
        labels[labelName] = row[labelColumnIndices[labelName]];
      }
    }
    // Per Grafana dataplane LogLines: extra top-level fields are ignored by the logs UI.
    // Put context columns into `labels` so they appear in single-line log details (Fields/Labels).
    for (const contextName in contextColumnIndices) {
      if (!contextColumnValues[contextName]) {
        contextColumnValues[contextName] = [];
      }
      const contextValue = row[contextColumnIndices[contextName]];
      contextColumnValues[contextName].push(contextValue);
      labels[contextName] = contextValue;
    }
    labelsArray.push(labels);

  });

  const fields = [
    { name: 'timestamp', type: FieldType.time, values: timestamps },
    { name: 'body', type: FieldType.string, values: bodies },
  ] as any;

  if (severityColumnIndex !== -1) {
    fields.push({ name: 'severity', type: FieldType.string, values: severities });
  }

  if (idColumnIndex !== -1) {
    fields.push({ name: 'id', type: FieldType.string, values: ids });
  }

  for (const contextName in contextColumnValues) {
    fields.push({ name: contextName, type: FieldType.string, values: contextColumnValues[contextName] });
  }

  fields.push({ name: 'labels', type: FieldType.other, values: labelsArray });

  const result = createDataFrame({
    refId: query.refId,
    fields: fields,
    meta: {
      preferredVisualisationType: 'logs',
      type: DataFrameType.LogLines,
    },
  });

  return result;
}



interface GrafanaTraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: number; // Unix timestamp in milliseconds
  duration: number;  // Duration in milliseconds
  tags?: Array<Record<string, any>>;
  serviceTags?: Array<Record<string, any>>;
  logs?: GrafanaTraceLog[];
  // Add other relevant fields as needed (kind, status, etc.)
}

export type Column = {
  name: string,
  alias: string
}

export function transformGreptimeDBTraceDetails(response: GreptimeResponse, builderOptions: QueryBuilderOptions): DataFrame[] {
  const records = response?.output?.[0]?.records;
  if (!records?.rows) {
    return [];
  }

  const columnNames = records.schema.column_schemas.map((column) => column.name);
  const columnIndexByName = new Map(columnNames.map((name, index) => [name, index]));
  const tagColumnNames = getColumnsByHint(builderOptions, ColumnHint.TraceTags)?.map((column) => column.name) || [];
  const serviceTagColumnNames = getColumnsByHint(builderOptions, ColumnHint.TraceServiceTags)?.map((column) => column.name) || [];
  const eventColumnName = getColumnsByHint(builderOptions, ColumnHint.TraceEventsPrefix)?.[0]?.name || GREPTIME_TRACE_DEFAULTS.eventsColumn;
  const tagColumnPrefix = normalizeTraceColumnPrefix(undefined, GREPTIME_TRACE_DEFAULTS.tagColumnPrefix);
  const serviceTagColumnPrefix = normalizeTraceColumnPrefix(undefined, GREPTIME_TRACE_DEFAULTS.serviceTagColumnPrefix);

  const spans: GrafanaTraceSpan[] = records.rows.map(row => {
    const data: Record<string, any> = {};

    columnNames.forEach((columnName, index) => {
      data[columnName] = row[index];
      data[columnName.toLowerCase()] = row[index];
    });

    const tags = getTraceTags(row, columnIndexByName, tagColumnNames, tagColumnPrefix);
    const serviceTags = getTraceTags(row, columnIndexByName, serviceTagColumnNames, serviceTagColumnPrefix);
    const spanEvents = getTraceValue(data, 'logs', eventColumnName, GREPTIME_TRACE_DEFAULTS.eventsColumn);

    return {
      traceId: getTraceValue(data, 'traceID', 'trace_id'),
      spanId: getTraceValue(data, 'spanID', 'span_id'),
      parentSpanId: getTraceValue(data, 'parentSpanID', 'parent_span_id') || undefined,
      operationName: getTraceValue(data, 'operationName', 'span_name') || 'unknown',
      serviceName: getTraceValue(data, 'serviceName', 'service_name') || 'unknown',
      startTime: getTraceStartTime(getTraceValue(data, 'startTime', 'timestamp')),
      duration: getTraceValue(data, 'duration', 'duration_nano') || 0,
      tags,
      serviceTags,
      logs: transformGreptimeDBEvents(parseGreptimeSpanEvents(spanEvents)),
    };
  });

  const fields = [
    { name: 'traceID', type: FieldType.string, values: spans.map(s => s.traceId) },
    { name: 'spanID', type: FieldType.string, values: spans.map(s => s.spanId) },
    { name: 'parentSpanID', type: FieldType.string, values: spans.map(s => s.parentSpanId) },
    { name: 'operationName', type: FieldType.string, values: spans.map(s => s.operationName) },
    { name: 'serviceName', type: FieldType.string, values: spans.map(s => s.serviceName) },
    { name: 'startTime', type: FieldType.time, values: spans.map(s => s.startTime) },
    { name: 'duration', type: FieldType.number, values: spans.map(s => s.duration), "config": { "unit": "ms" }, },
    { name: 'tags', type: FieldType.other, values: spans.map(s => s.tags) },
    { name: 'serviceTags', type: FieldType.other, values: spans.map(s => s.serviceTags) },
    { name: 'logs', type: FieldType.other, values: spans.map(s => s.logs) },
  ];

  const frame = createDataFrame({
    refId: 'Trace ID',
    name: 'Trace Details',
    fields: fields,
    meta: {
      preferredVisualisationType: 'trace',
    },
  });

  return [frame];
}

function getTraceValue(data: Record<string, any>, ...names: string[]): any {
  for (const name of names) {
    if (data[name] !== undefined) {
      return data[name];
    }

    const lowerName = name.toLowerCase();
    if (data[lowerName] !== undefined) {
      return data[lowerName];
    }
  }

  return undefined;
}

function getTraceStartTime(value: any): number {
  if (typeof value === 'number') {
    return value;
  }

  return new Date(value).getTime();
}

function getTraceTags(row: any[], columnIndexByName: Map<string, number>, columnNames: string[], prefix: string): Array<{ key: string; value: string }> {
  return columnNames.flatMap((columnName) => {
    const columnIndex = columnIndexByName.get(columnName);
    if (columnIndex === undefined) {
      return [];
    }

    const value = row[columnIndex];
    if (value === null || value === undefined) {
      return [];
    }

    return [{
      key: stripTraceColumnPrefix(columnName, prefix),
      value: stringifyTraceValue(value),
    }];
  });
}

function parseGreptimeSpanEvents(value: unknown): GreptimeSpanEvent[] {
  if (Array.isArray(value)) {
    return value as GreptimeSpanEvent[];
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as GreptimeSpanEvent[] : [];
  } catch (e) {
    console.error('Failed to parse span_events from GreptimeDB:', value, e);
    return [];
  }
}

function transformGreptimeDBEvents(events: GreptimeSpanEvent[]): GrafanaTraceLog[] {
  return events.flatMap((event) => {
    const timestamp = getTraceStartTime(event.time || event.timestamp);
    if (!Number.isFinite(timestamp)) {
      return [];
    }

    const fields = [
      ...(event.name ? [{ key: 'event.name', value: stringifyTraceValue(event.name) }] : []),
      ...Object.entries(event.attributes || {}).map(([key, value]) => ({
        key,
        value: stringifyTraceValue(value),
      })),
    ];

    return [{ timestamp, fields }];
  });
}



export type TransformContext = {
  refId?: string;
  queryType: QueryType;
  query?: CHQuery;
};

type TimeSeriesSchema = {
  timeIndex: number;
  dimensionIndices: number[];
  valueIndices: number[];
};

type SeriesBucket = {
  name: string;
  labels: Record<string, string>;
  valueFieldName: string;
  times: number[];
  values: Array<number | null>;
};

function getFieldType(column: GreptimeColumnSchema): FieldType {
  return mapGreptimeTypeToGrafana(column.data_type);
}

function isTimeColumn(column: GreptimeColumnSchema): boolean {
  return getFieldType(column) === FieldType.time;
}

function isNumberColumn(column: GreptimeColumnSchema): boolean {
  return getFieldType(column) === FieldType.number;
}

function isDimensionColumn(column: GreptimeColumnSchema): boolean {
  return getFieldType(column) === FieldType.string;
}

function convertTimeValue(value: unknown, columnType: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    return toMs(value, columnType as GreptimeTimeType);
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (!Number.isNaN(numericValue) && value.trim() !== '') {
      return toMs(numericValue, columnType as GreptimeTimeType);
    }

    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function convertCellValue(value: unknown, column: GreptimeColumnSchema): unknown {
  if (isTimeColumn(column)) {
    return convertTimeValue(value, column.data_type);
  }
  return value;
}

function createErrorFrame(refId: string | undefined, message: string): DataFrame {
  return createDataFrame({
    refId,
    fields: [
      { name: 'Error', type: FieldType.string, values: [message], config: {} },
    ],
    meta: {
      preferredVisualisationType: 'table',
    },
  });
}

function getValidResultSets(response: GreptimeResponse, refId?: string): Array<{ records: GreptimeRecords; index: number }> | DataFrame[] {
  if (!response || !response.output || !Array.isArray(response.output)) {
    if (response?.error) {
      console.error(`GreptimeDB query failed: ${response.error} (Code: ${response.code})`);
      return [createErrorFrame(refId, response.error)];
    }

    console.error('Invalid or missing "output" array in GreptimeDB response.');
    return [];
  }

  const resultSets: Array<{ records: GreptimeRecords; index: number }> = [];
  response.output.forEach((resultSet, index) => {
    if (!resultSet?.records?.schema?.column_schemas || !resultSet?.records?.rows) {
      console.warn(`Skipping invalid result set at index ${index}. Missing schema, column_schemas, or rows.`);
      return;
    }
    resultSets.push({ records: resultSet.records, index });
  });

  return resultSets;
}

export function transformTable(response: GreptimeResponse, context: TransformContext): DataFrame[] {
  const resultSetsOrFrames = getValidResultSets(response, context.refId);
  if (resultSetsOrFrames.length === 0 || 'fields' in resultSetsOrFrames[0]) {
    return resultSetsOrFrames as DataFrame[];
  }

  return (resultSetsOrFrames as Array<{ records: GreptimeRecords; index: number }>).map(({ records, index }) => {
    const columns = records.schema.column_schemas;
    const fields: Field[] = columns.map((column, columnIndex) => ({
      name: column.name || `column_${columnIndex + 1}`,
      type: mapGreptimeTypeToGrafana(column.data_type),
      values: records.rows.map((row) => convertCellValue(row[columnIndex], column)),
      config: {},
    }));

    return createDataFrame({
      name: `Result ${index + 1}`,
      refId: context.refId,
      fields,
    });
  });
}

function inferTimeSeriesSchema(columns: GreptimeColumnSchema[]): TimeSeriesSchema {
  const timeIndices = columns
    .map((column, index) => isTimeColumn(column) ? index : -1)
    .filter((index) => index !== -1);

  if (timeIndices.length !== 1) {
    throw new Error(`Time series query must return exactly one time column; got ${timeIndices.length}`);
  }

  const valueIndices = columns
    .map((column, index) => isNumberColumn(column) ? index : -1)
    .filter((index) => index !== -1);

  if (valueIndices.length === 0) {
    throw new Error('Time series query must return at least one numeric value column');
  }

  const dimensionIndices = columns
    .map((column, index) => isDimensionColumn(column) ? index : -1)
    .filter((index) => index !== -1);

  return {
    timeIndex: timeIndices[0],
    dimensionIndices,
    valueIndices,
  };
}

function buildDimensionLabels(
  row: any[],
  columns: GreptimeColumnSchema[],
  dimensionIndices: number[]
): Record<string, string> {
  return Object.fromEntries(
    dimensionIndices.map((index) => [columns[index].name, String(row[index])])
  );
}

function buildSeriesName(
  labels: Record<string, string>,
  valueColumnName: string,
  includeValueColumn: boolean
): string {
  const labelEntries = Object.entries(labels).filter(([key]) => key !== '__field');
  const base = labels.metric ?? labelEntries.map(([key, value]) => `${key}=${value}`).join(' ');

  if (includeValueColumn) {
    return base ? `${base} ${valueColumnName}` : valueColumnName;
  }

  return base || valueColumnName;
}

function toWideTimeSeriesFrame(
  records: GreptimeRecords,
  schema: TimeSeriesSchema,
  context: TransformContext,
  resultIndex: number
): DataFrame {
  const columns = records.schema.column_schemas;
  const timeColumn = columns[schema.timeIndex];
  const fields: Field[] = [
    {
      name: timeColumn.name,
      type: FieldType.time,
      values: records.rows.map((row) => convertTimeValue(row[schema.timeIndex], timeColumn.data_type)),
      config: {},
    },
  ];

  for (const valueIndex of schema.valueIndices) {
    const valueColumn = columns[valueIndex];
    fields.push({
      name: valueColumn.name,
      type: FieldType.number,
      values: records.rows.map((row) => row[valueIndex] ?? null),
      config: {
        displayNameFromDS: valueColumn.name,
      },
    });
  }

  return createDataFrame({
    name: `Result ${resultIndex + 1}`,
    refId: context.refId,
    fields,
  });
}

function toMultiTimeSeriesFrames(
  records: GreptimeRecords,
  schema: TimeSeriesSchema,
  context: TransformContext
): DataFrame[] {
  const columns = records.schema.column_schemas;
  const timeColumn = columns[schema.timeIndex];
  const buckets = new Map<string, SeriesBucket>();

  for (const row of records.rows) {
    const time = convertTimeValue(row[schema.timeIndex], timeColumn.data_type);
    const dimensionLabels = buildDimensionLabels(row, columns, schema.dimensionIndices);

    for (const valueIndex of schema.valueIndices) {
      const valueColumn = columns[valueIndex];
      const labels = { ...dimensionLabels };

      if (schema.valueIndices.length > 1) {
        labels.__field = valueColumn.name;
      }

      const key = JSON.stringify(labels);
      const name = buildSeriesName(labels, valueColumn.name, schema.valueIndices.length > 1);
      const bucket = buckets.get(key) ?? {
        name,
        labels,
        valueFieldName: valueColumn.name,
        times: [],
        values: [],
      };

      bucket.times.push(time ?? NaN);
      bucket.values.push(row[valueIndex] ?? null);
      buckets.set(key, bucket);
    }
  }

  return Array.from(buckets.values()).map((bucket) => createDataFrame({
    name: bucket.name,
    refId: context.refId,
    fields: [
      {
        name: timeColumn.name,
        type: FieldType.time,
        values: bucket.times,
        config: {},
      },
      {
        name: bucket.valueFieldName,
        type: FieldType.number,
        values: bucket.values,
        labels: bucket.labels,
        config: {
          displayNameFromDS: bucket.name,
        },
      },
    ],
  }));
}

function transformTimeSeriesResultSet(
  records: GreptimeRecords,
  context: TransformContext,
  resultIndex: number
): DataFrame[] {
  const schema = inferTimeSeriesSchema(records.schema.column_schemas);

  if (schema.dimensionIndices.length === 0) {
    return [toWideTimeSeriesFrame(records, schema, context, resultIndex)];
  }

  return toMultiTimeSeriesFrames(records, schema, context);
}

export function transformTimeSeries(response: GreptimeResponse, context: TransformContext): DataFrame[] {
  const resultSetsOrFrames = getValidResultSets(response, context.refId);
  if (resultSetsOrFrames.length === 0 || 'fields' in resultSetsOrFrames[0]) {
    return resultSetsOrFrames as DataFrame[];
  }

  const frames: DataFrame[] = [];
  for (const { records, index } of resultSetsOrFrames as Array<{ records: GreptimeRecords; index: number }>) {
    try {
      frames.push(...transformTimeSeriesResultSet(records, context, index));
    } catch (error) {
      frames.push(createErrorFrame(context.refId, error instanceof Error ? error.message : String(error)));
    }
  }
  return frames;
}

export function transformGreptimeResponse(
  response: GreptimeResponse,
  context: TransformContext
): DataFrame[] {
  switch (context.queryType) {
    case QueryType.TimeSeries:
      return transformTimeSeries(response, context);
    case QueryType.Table:
    default:
      return transformTable(response, context);
  }
}

export function transformGreptimeResponseToGrafana(
  response: GreptimeResponse,
  refId?: string,
  _sql?: string
): DataFrame[] {
  return transformGreptimeResponse(response, { refId, queryType: QueryType.Table });
}
