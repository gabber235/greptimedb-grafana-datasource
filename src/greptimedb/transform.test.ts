import { FieldType } from '@grafana/data';
import { ColumnHint, QueryType } from 'types/queryBuilder';
import { transformGreptimeDBTraceDetails, transformGreptimeResponse } from './index';

const response = (columnSchemas: Array<{ name: string; data_type: string }>, rows: any[][]) => ({
  code: 0,
  output: [
    {
      records: {
        schema: { column_schemas: columnSchemas },
        rows,
      },
    },
  ],
});

describe('GreptimeDB response transformation', () => {
  it('keeps table queries in table shape even when they look like long time series', () => {
    const frames = transformGreptimeResponse(
      response(
        [
          { name: 'greptime_timestamp', data_type: 'TimestampMillisecond' },
          { name: 'metric', data_type: 'String' },
          { name: 'value', data_type: 'Float64' },
        ],
        [
          [1000, 'node-a', 10],
          [1000, 'node-b', 20],
        ]
      ),
      { refId: 'A', queryType: QueryType.Table }
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].fields.map((field) => field.name)).toEqual(['greptime_timestamp', 'metric', 'value']);
    expect(frames[0].fields[0].type).toBe(FieldType.time);
    expect(frames[0].fields[1].values).toEqual(['node-a', 'node-b']);
  });

  it('turns long metric time series into one frame per metric value', () => {
    const frames = transformGreptimeResponse(
      response(
        [
          { name: 'greptime_timestamp', data_type: 'TimestampMillisecond' },
          { name: 'metric', data_type: 'String' },
          { name: 'value', data_type: 'Float64' },
        ],
        [
          [1000, 'node-a', 10],
          [1000, 'node-b', 20],
          [2000, 'node-a', 11],
          [2000, 'node-b', 21],
        ]
      ),
      { refId: 'A', queryType: QueryType.TimeSeries }
    );

    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.name).sort()).toEqual(['node-a', 'node-b']);

    const nodeA = frames.find((frame) => frame.name === 'node-a')!;
    expect(nodeA.fields.map((field) => field.name)).toEqual(['greptime_timestamp', 'value']);
    expect(nodeA.fields[0].values).toEqual([1000, 2000]);
    expect(nodeA.fields[1].values).toEqual([10, 11]);
    expect(nodeA.fields[1].labels).toEqual({ metric: 'node-a' });
    expect(nodeA.fields[1].config.displayNameFromDS).toBe('node-a');
  });

  it('keeps wide time series as one frame with multiple numeric value fields', () => {
    const frames = transformGreptimeResponse(
      response(
        [
          { name: 'greptime_timestamp', data_type: 'TimestampMillisecond' },
          { name: 'cpu', data_type: 'Float64' },
          { name: 'memory', data_type: 'Float64' },
        ],
        [
          [1000, 10, 70],
          [2000, 11, 71],
        ]
      ),
      { refId: 'A', queryType: QueryType.TimeSeries }
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].fields.map((field) => field.name)).toEqual(['greptime_timestamp', 'cpu', 'memory']);
    expect(frames[0].fields[1].values).toEqual([10, 11]);
    expect(frames[0].fields[2].values).toEqual([70, 71]);
  });

  it('preserves multiple dimensions as field labels', () => {
    const frames = transformGreptimeResponse(
      response(
        [
          { name: 'greptime_timestamp', data_type: 'TimestampMillisecond' },
          { name: 'namespace', data_type: 'String' },
          { name: 'pod', data_type: 'String' },
          { name: 'value', data_type: 'Float64' },
        ],
        [
          [1000, 'observability', 'grafana', 1],
          [2000, 'observability', 'grafana', 2],
          [1000, 'default', 'app', 3],
        ]
      ),
      { refId: 'A', queryType: QueryType.TimeSeries }
    );

    expect(frames).toHaveLength(2);
    const grafana = frames.find((frame) => frame.name === 'namespace=observability pod=grafana')!;
    expect(grafana.fields[1].labels).toEqual({ namespace: 'observability', pod: 'grafana' });
    expect(grafana.fields[1].values).toEqual([1, 2]);
  });

  it('creates one series per dimension and numeric value column', () => {
    const frames = transformGreptimeResponse(
      response(
        [
          { name: 'greptime_timestamp', data_type: 'TimestampMillisecond' },
          { name: 'node', data_type: 'String' },
          { name: 'cpu_busy', data_type: 'Float64' },
          { name: 'memory_used', data_type: 'Float64' },
        ],
        [
          [1000, 'node-a', 10, 70],
          [1000, 'node-b', 20, 80],
        ]
      ),
      { refId: 'A', queryType: QueryType.TimeSeries }
    );

    expect(frames.map((frame) => frame.name).sort()).toEqual([
      'node=node-a cpu_busy',
      'node=node-a memory_used',
      'node=node-b cpu_busy',
      'node=node-b memory_used',
    ]);
    expect(frames.find((frame) => frame.name === 'node=node-a cpu_busy')!.fields[1].labels).toEqual({
      node: 'node-a',
      __field: 'cpu_busy',
    });
  });

  it('returns a clear error frame for invalid time series responses', () => {
    const frames = transformGreptimeResponse(
      response(
        [
          { name: 'metric', data_type: 'String' },
          { name: 'value', data_type: 'Float64' },
        ],
        [['node-a', 10]]
      ),
      { refId: 'A', queryType: QueryType.TimeSeries }
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].fields[0].name).toBe('Error');
    expect(frames[0].fields[0].values[0]).toContain('exactly one time column');
  });

  it('builds trace hierarchy and normalizes native trace fields', () => {
    const schemas = [
      { name: 'trace_id', data_type: 'String' },
      { name: 'span_id', data_type: 'String' },
      { name: 'parent_span_id', data_type: 'String' },
      { name: 'service_name', data_type: 'String' },
      { name: 'resource_attributes.service.namespace', data_type: 'String' },
      { name: 'span_name', data_type: 'String' },
      { name: 'timestamp', data_type: 'TimestampNanosecond' },
      { name: 'duration_nano', data_type: 'UInt64' },
      { name: 'span_status_code', data_type: 'String' },
      { name: 'span_status_message', data_type: 'String' },
      { name: 'span_attributes.http.method', data_type: 'String' },
      { name: 'resource_attributes.deployment.environment', data_type: 'String' },
      { name: 'span_events', data_type: 'Json' },
    ];
    const decodedEvents = [{ time: 1_700_000_000_123_000, name: 'decoded', attributes: { count: 2 } }];
    const serializedEvents = JSON.stringify([{ timestamp: 1_700_000_000_124_000_000, name: 'serialized' }, { timestamp: 'invalid' }, null]);
    const frame = transformGreptimeDBTraceDetails(
      response(schemas, [
        ['trace', 'root', '', 'api', 'prod', 'root operation', 1_700_000_000_000_000_000, 2_500_000, 'STATUS_CODE_OK', '', 'GET', 'production', decodedEvents],
        ['trace', 'child', 'root', 'db', '', 'child operation', 1_700_000_000_500_000_000, 1_000_000, 'error', 'failed', null, 'production', serializedEvents],
      ]),
      {
        database: 'public', table: 'traces', queryType: QueryType.Traces,
        columns: [
          { name: 'span_attributes.http.method', hint: ColumnHint.TraceTags },
          { name: 'resource_attributes.deployment.environment', hint: ColumnHint.TraceServiceTags },
          { name: 'span_events', hint: ColumnHint.TraceEventsPrefix },
        ],
      }
    )[0];
    const values = (name: string) => frame.fields.find((field) => field.name === name)!.values;

    expect(values('parentSpanID')).toEqual([undefined, 'root']);
    expect(values('serviceName')).toEqual(['prod.api', 'db']);
    expect(values('startTime')).toEqual([1_700_000_000_000, 1_700_000_000_500]);
    expect(values('duration')).toEqual([2.5, 1]);
    expect(values('statusCode')).toEqual([1, 2]);
    expect(values('statusMessage')).toEqual([undefined, 'failed']);
    expect(values('tags')[0]).toEqual([{ key: 'http.method', value: 'GET' }]);
    expect(values('serviceTags')[0]).toEqual([{ key: 'deployment.environment', value: 'production' }]);
    expect(values('logs')[0][0].timestamp).toBe(1_700_000_000_123);
    expect(values('logs')[1]).toHaveLength(1);
    expect(values('logs')[1][0].timestamp).toBe(1_700_000_000_124);
  });

  it('uses generated duration without converting it twice and ignores malformed events', () => {
    const frame = transformGreptimeDBTraceDetails(
      response(
        [
          { name: 'traceID', data_type: 'String' }, { name: 'spanID', data_type: 'String' },
          { name: 'startTime', data_type: 'Int64' }, { name: 'duration', data_type: 'Float64' },
          { name: 'logs', data_type: 'String' },
        ],
        [['trace', 'span', 1_700_000_000_000, 2.5, '{malformed']]
      ),
      { database: 'public', table: 'traces', queryType: QueryType.Traces, columns: [] }
    )[0];

    expect(frame.fields.find((field) => field.name === 'duration')!.values).toEqual([2.5]);
    expect(frame.fields.find((field) => field.name === 'logs')!.values).toEqual([[]]);
  });
});
