
import React from 'react';
import { ConfigSection, ConfigSubSection } from 'components/experimental/ConfigSection';
import { Input, Field } from '@grafana/ui';
// import { OtelVersionSelect } from 'components/queryBuilder/OtelVersionSelect';
import { ColumnHint, TimeUnit } from 'types/queryBuilder';
import otel, { defaultTraceTable } from 'otel';
import { LabeledInput } from './LabeledInput';
import { DurationUnitSelect } from 'components/queryBuilder/DurationUnitSelect';
import { CHTracesConfig } from 'types/config';
import allLabels from 'labels';
import { columnLabelToPlaceholder } from 'data/utils';

const splitColumnList = (value: string): string[] => value.split(',').map(column => column.trim()).filter(Boolean);

interface TraceConfigProps {
  tracesConfig?: CHTracesConfig;
  onDefaultDatabaseChange: (v: string) => void;
  onDefaultTableChange: (v: string) => void;
  onOtelEnabledChange: (v: boolean) => void;
  onOtelVersionChange: (v: string) => void;
  onTraceIdColumnChange: (v: string) => void;
  onSpanIdColumnChange: (v: string) => void;
  onOperationNameColumnChange: (v: string) => void;
  onParentSpanIdColumnChange: (v: string) => void;
  onServiceNameColumnChange: (v: string) => void;
  onDurationColumnChange: (v: string) => void;
  onDurationUnitChange: (v: TimeUnit) => void;
  onStartTimeColumnChange: (v: string) => void;
  onTagColumnPrefixChange: (v: string) => void;
  onServiceTagColumnPrefixChange: (v: string) => void;
  onExcludedTagColumnsChange: (v: string[]) => void;
  onExcludedServiceTagColumnsChange: (v: string[]) => void;
  onEventsColumnChange: (v: string) => void;
}

export const TracesConfig = (props: TraceConfigProps) => {
  const {
    onDefaultDatabaseChange, onDefaultTableChange,
    // onOtelEnabledChange, onOtelVersionChange,
    onTraceIdColumnChange, onSpanIdColumnChange, onOperationNameColumnChange, onParentSpanIdColumnChange,
    onServiceNameColumnChange, onDurationColumnChange, onDurationUnitChange, onStartTimeColumnChange,
    onTagColumnPrefixChange, onServiceTagColumnPrefixChange, onExcludedTagColumnsChange,
    onExcludedServiceTagColumnsChange, onEventsColumnChange
  } = props;
  let {
    defaultDatabase, defaultTable,
    otelEnabled, otelVersion,
    traceIdColumn, spanIdColumn, operationNameColumn, parentSpanIdColumn, serviceNameColumn,
    durationColumn, durationUnit, startTimeColumn, tagColumnPrefix, serviceTagColumnPrefix,
    excludedTagColumns, excludedServiceTagColumns, eventsColumn
  } = (props.tracesConfig || {}) as CHTracesConfig;
  const labels = allLabels.components.Config.TracesConfig;

  const otelConfig = otel.getVersion(otelVersion);
  if (otelEnabled && otelConfig) {
    startTimeColumn = otelConfig.traceColumnMap.get(ColumnHint.Time);
    traceIdColumn = otelConfig.traceColumnMap.get(ColumnHint.TraceId);
    spanIdColumn = otelConfig.traceColumnMap.get(ColumnHint.TraceSpanId);
    parentSpanIdColumn = otelConfig.traceColumnMap.get(ColumnHint.TraceParentSpanId);
    serviceNameColumn = otelConfig.traceColumnMap.get(ColumnHint.TraceServiceName);
    operationNameColumn = otelConfig.traceColumnMap.get(ColumnHint.TraceOperationName);
    durationColumn = otelConfig.traceColumnMap.get(ColumnHint.TraceDurationTime);
    tagColumnPrefix = otelConfig.traceColumnMap.get(ColumnHint.TraceTags);
    serviceTagColumnPrefix = otelConfig.traceColumnMap.get(ColumnHint.TraceServiceTags);
    eventsColumn = otelConfig.traceColumnMap.get(ColumnHint.TraceEventsPrefix);
    durationUnit = otelConfig.traceDurationUnit.toString();
  }

  return (
    <ConfigSection
      title={labels.title}
      description={labels.description}
    >
      <div id="traces-config" />
      <Field
        label={labels.defaultDatabase.label}
        description={labels.defaultDatabase.description}
      >
        <Input
          name={labels.defaultDatabase.name}
          width={40}
          value={defaultDatabase || ''}
          onChange={e => onDefaultDatabaseChange(e.currentTarget.value)}
          label={labels.defaultDatabase.label}
          aria-label={labels.defaultDatabase.label}
          placeholder={labels.defaultDatabase.placeholder}
        />
      </Field>
      <Field
        label={labels.defaultTable.label}
        description={labels.defaultTable.description}
      >
        <Input
          name={labels.defaultTable.name}
          width={40}
          value={defaultTable || ''}
          onChange={e => onDefaultTableChange(e.currentTarget.value)}
          label={labels.defaultTable.label}
          aria-label={labels.defaultTable.label}
          placeholder={defaultTraceTable}
        />
      </Field>
      <ConfigSubSection
        title={labels.columns.title}
        description={labels.columns.description}
      >
        {/* <OtelVersionSelect
          enabled={otelEnabled || false}
          selectedVersion={otelVersion || ''}
          onEnabledChange={onOtelEnabledChange}
          onVersionChange={onOtelVersionChange}
          wide
        /> */}
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.traceId.label}
          placeholder={columnLabelToPlaceholder(labels.columns.traceId.label)}
          tooltip={labels.columns.traceId.tooltip}
          value={traceIdColumn || ''}
          onChange={onTraceIdColumnChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.spanId.label}
          placeholder={columnLabelToPlaceholder(labels.columns.spanId.label)}
          tooltip={labels.columns.spanId.tooltip}
          value={spanIdColumn || ''}
          onChange={onSpanIdColumnChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.operationName.label}
          placeholder={columnLabelToPlaceholder(labels.columns.operationName.label)}
          tooltip={labels.columns.operationName.tooltip}
          value={operationNameColumn || ''}
          onChange={onOperationNameColumnChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.parentSpanId.label}
          placeholder={columnLabelToPlaceholder(labels.columns.parentSpanId.label)}
          tooltip={labels.columns.parentSpanId.tooltip}
          value={parentSpanIdColumn || ''}
          onChange={onParentSpanIdColumnChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.serviceName.label}
          placeholder={columnLabelToPlaceholder(labels.columns.serviceName.label)}
          tooltip={labels.columns.serviceName.tooltip}
          value={serviceNameColumn || ''}
          onChange={onServiceNameColumnChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.durationTime.label}
          placeholder={columnLabelToPlaceholder(labels.columns.durationTime.label)}
          tooltip={labels.columns.durationTime.tooltip}
          value={durationColumn || ''}
          onChange={onDurationColumnChange}
        />
        <DurationUnitSelect
          disabled={otelEnabled}
          unit={durationUnit as TimeUnit || TimeUnit.Nanoseconds}
          onChange={onDurationUnitChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.startTime.label}
          placeholder={columnLabelToPlaceholder(labels.columns.startTime.label)}
          tooltip={labels.columns.startTime.tooltip}
          value={startTimeColumn || ''}
          onChange={onStartTimeColumnChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.tags.label}
          placeholder={columnLabelToPlaceholder(labels.columns.tags.label)}
          tooltip={labels.columns.tags.tooltip}
          value={tagColumnPrefix || 'span_attributes.'}
          onChange={onTagColumnPrefixChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.serviceTags.label}
          placeholder={columnLabelToPlaceholder(labels.columns.serviceTags.label)}
          tooltip={labels.columns.serviceTags.tooltip}
          value={serviceTagColumnPrefix || 'resource_attributes.'}
          onChange={onServiceTagColumnPrefixChange}
        />
        <LabeledInput
          disabled={otelEnabled}
          label="Excluded span attribute columns"
          placeholder="span_attributes.code.file.path, span_attributes.thread.id"
          tooltip="Comma-separated Greptime trace span attribute columns to hide from trace tags."
          value={(excludedTagColumns || []).join(', ')}
          onChange={value => onExcludedTagColumnsChange(splitColumnList(value))}
        />
        <LabeledInput
          disabled={otelEnabled}
          label="Excluded service attribute columns"
          placeholder="resource_attributes.telemetry.sdk.version"
          tooltip="Comma-separated Greptime trace resource attribute columns to hide from service tags."
          value={(excludedServiceTagColumns || []).join(', ')}
          onChange={value => onExcludedServiceTagColumnsChange(splitColumnList(value))}
        />
        <LabeledInput
          disabled={otelEnabled}
          label={labels.columns.eventsPrefix.label}
          placeholder="span_events"
          tooltip={labels.columns.eventsPrefix.tooltip}
          value={eventsColumn || 'span_events'}
          onChange={onEventsColumnChange}
        />
      </ConfigSubSection>
    </ConfigSection>
  );
}
