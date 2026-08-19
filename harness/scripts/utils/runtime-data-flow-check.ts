import * as fs from 'fs';
import * as path from 'path';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  getId,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { validateLiteSchema } from './lite-json-schema';
import { validateProvenanceRecord } from './blueprint-provenance';

const TRIGGER_CONDITIONS = [
  'persistent_or_remote_ui',
  'multiple_consumers',
  'background_system_external_scheduled_write',
  'cold_start_resume_mount_account_switch',
  'user_mutation_refreshes_other_consumers',
  'cache_sync_freshness_consistency_process_recreation',
] as const;

const LIFECYCLE_EVENTS = [
  'cold_start',
  'warm_resume',
  'page_attach',
  'page_detach',
  'account_switch',
  'process_recreation',
  'background_write',
] as const;

function requireNonEmptyArray(
  flow: BlueprintRecord,
  field: string,
  base: string,
  out: BlueprintIssue[],
): void {
  const value = flow[field];
  if (!Array.isArray(value) || value.length === 0) {
    out.push(issue('runtime_flow_content_empty', `${base}.${field}`, `runtime flow 的 ${field} 不能为空。`));
  }
}

function localRefId(ref: unknown, prefix: string): string | undefined {
  if (!nonEmptyString(ref) || !ref.startsWith(prefix)) return undefined;
  return ref.slice(prefix.length);
}

function indexedLocalIds(
  records: BlueprintRecord[],
  idField: string,
  collectionPath: string,
  out: BlueprintIssue[],
): Set<string> {
  const ids = new Set<string>();
  records.forEach((record, index) => {
    const id = getId(record, idField);
    if (!id) {
      out.push(issue('runtime_flow_local_id_missing', `${collectionPath}[${index}].${idField}`, `${idField} 必须是非空稳定 id。`));
    } else if (ids.has(id)) {
      out.push(issue('runtime_flow_local_id_duplicate', `${collectionPath}[${index}].${idField}`, `${idField}=${id} 重复，局部引用不再唯一。`));
    } else {
      ids.add(id);
    }
  });
  return ids;
}

function loadRuntimeSchema(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', 'runtime-data-flow.schema.json'), 'utf8')) as Record<string, unknown>;
}

export function validateRuntimeDataFlows(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const runtime = asRecords(blueprint.design_views).find(view => view.view_id === 'runtime');
  const flows = asRecords(runtime?.runtime_data_flows);
  const assessment = asRecord(asRecord(blueprint.app_lens)?.runtime_flow_trigger_assessment);
  let triggered = false;
  for (const condition of TRIGGER_CONDITIONS) {
    const entry = asRecord(assessment?.[condition]);
    if (!entry || typeof entry.applies !== 'boolean' || asStrings(entry.evidence_refs).length === 0) {
      out.push(issue('runtime_flow_trigger_assessment_missing', `$.app_lens.runtime_flow_trigger_assessment.${condition}`, `六项触发条件必须逐条裁决并提供 evidence_refs：${condition}。`));
    } else if (entry.applies) {
      triggered = true;
    }
  }
  if (triggered && flows.length === 0) {
    out.push(issue('runtime_flow_required', '$.design_views[runtime].runtime_data_flows', '至少一项触发条件成立，必须生成 runtime_data_flow。'));
  }
  if (!triggered && flows.length === 0) {
    const disposition = asRecord(runtime?.runtime_data_flow_disposition);
    if (disposition?.status !== 'not_applicable' || asStrings(disposition.evidence_refs).length === 0 || !nonEmptyString(disposition.retrigger_condition)) {
      out.push(issue('runtime_flow_na_evidence_missing', '$.design_views[runtime].runtime_data_flow_disposition', '六项均不触发时必须以证据和重新触发条件声明 not_applicable。'));
    }
  }

  const schema = loadRuntimeSchema();
  const seen = new Set<string>();
  flows.forEach((flow, index) => {
    const base = `$.design_views[runtime].runtime_data_flows[${index}]`;
    for (const violation of validateLiteSchema(flow, schema)) {
      out.push(issue('runtime_flow_schema_invalid', `${base}${violation.path.slice(1)}`, violation.message));
    }
    const flowId = getId(flow, 'flow_id');
    if (flowId && seen.has(flowId)) out.push(issue('runtime_flow_id_duplicate', `${base}.flow_id`, `flow_id=${flowId} 重复。`));
    if (flowId) seen.add(flowId);
    out.push(...validateProvenanceRecord(flow.provenance, `${base}.provenance`));
    for (const field of [
      'data_domain_refs',
      'triggers',
      'evidence_refs',
      'verification_refs',
      'logical_contract_refs',
    ]) {
      requireNonEmptyArray(flow, field, base, out);
    }
    const publications = asRecords(flow.publications);
    const publicationIds = indexedLocalIds(publications, 'publication_id', `${base}.publications`, out);
    const consumers = asRecords(flow.consumers);
    const consumerIds = indexedLocalIds(consumers, 'consumer_id', `${base}.consumers`, out);
    const mutations = asRecords(flow.mutations);
    const subscriptions = asRecords(flow.subscriptions);
    indexedLocalIds(mutations, 'mutation_id', `${base}.mutations`, out);
    indexedLocalIds(subscriptions, 'subscription_id', `${base}.subscriptions`, out);
    const initialLoad = asRecord(flow.initial_load);
    const initialLoadId = getId(initialLoad ?? {}, 'initial_load_id');
    const recovery = asRecord(flow.failure_recovery);
    const recoveryId = getId(recovery ?? {}, 'recovery_id');
    if (asStrings(asRecord(flow.state_owner)?.states).length === 0) {
      out.push(issue('runtime_flow_content_empty', `${base}.state_owner.states`, 'state_owner.states 不能为空。'));
    }
    const sourceOfTruth = asRecord(flow.source_of_truth);
    if (asStrings(sourceOfTruth?.projections_and_caches).length === 0) {
      out.push(issue('runtime_flow_content_empty', `${base}.source_of_truth.projections_and_caches`, 'projections_and_caches 不能为空。'));
    }
    if (asRecords(flow.triggers).some(trigger => !nonEmptyString(trigger.idempotency))) {
      out.push(issue('runtime_flow_trigger_idempotency_missing', `${base}.triggers`, '每个 trigger 必须声明 idempotency。'));
    }
    if (!initialLoad || !nonEmptyString(initialLoad.strategy) || !nonEmptyString(initialLoad.freshness)) {
      out.push(issue('runtime_flow_initial_load_missing', `${base}.initial_load`, 'consumer 必须可反向追到 initial load 与 freshness。'));
    }
    subscriptions.forEach((subscription, subIndex) => {
      for (const field of ['consumer_ref', 'attach', 'detach', 'cleanup', 'replay_or_snapshot', 'ordering']) {
        if (!nonEmptyString(subscription[field])) {
          out.push(issue(
            field === 'replay_or_snapshot' ? 'runtime_flow_late_subscription_snapshot_missing' : 'runtime_flow_subscription_lifecycle_missing',
            `${base}.subscriptions[${subIndex}].${field}`,
            `subscription 缺 ${field}。`,
          ));
        }
      }
      const consumerId = localRefId(subscription.consumer_ref, 'consumer:');
      if (!consumerId || !consumerIds.has(consumerId)) {
        out.push(issue('runtime_flow_reference_missing', `${base}.subscriptions[${subIndex}].consumer_ref`, `subscription consumer_ref 无法解析：${String(subscription.consumer_ref)}。`));
      }
    });
    mutations.forEach((mutation, mutationIndex) => {
      if (mutation.kind === 'background' && (!nonEmptyString(mutation.persistence_ref) || !nonEmptyString(mutation.recovery_ref))) {
        out.push(issue('runtime_flow_background_recovery_missing', `${base}.mutations[${mutationIndex}]`, '后台写入必须有 persistence_ref 与 recovery_ref。'));
      }
      if (!nonEmptyString(mutation.publication_ref)) {
        out.push(issue('runtime_flow_mutation_propagation_missing', `${base}.mutations[${mutationIndex}].publication_ref`, '写入必须可正向追到 publication。'));
      }
      const publicationId = localRefId(mutation.publication_ref, 'publication:');
      if (!publicationId || !publicationIds.has(publicationId)) {
        out.push(issue('runtime_flow_reference_missing', `${base}.mutations[${mutationIndex}].publication_ref`, `mutation publication_ref 无法解析：${String(mutation.publication_ref)}。`));
      }
      if (nonEmptyString(mutation.persistence_ref) && mutation.persistence_ref !== sourceOfTruth?.persistence) {
        out.push(issue('runtime_flow_reference_missing', `${base}.mutations[${mutationIndex}].persistence_ref`, `mutation persistence_ref 未指向 source_of_truth.persistence。`));
      }
      const mutationRecoveryId = localRefId(mutation.recovery_ref, 'recovery:');
      if (!mutationRecoveryId || mutationRecoveryId !== recoveryId) {
        out.push(issue('runtime_flow_reference_missing', `${base}.mutations[${mutationIndex}].recovery_ref`, `mutation recovery_ref 无法解析：${String(mutation.recovery_ref)}。`));
      }
    });
    const publicationConsumers = new Map<string, Set<string>>();
    consumers.forEach((consumer, consumerIndex) => {
      const loadId = localRefId(consumer.initial_load_ref, 'initial-load:');
      const validInitialLoad = Boolean(loadId && loadId === initialLoadId);
      if (!validInitialLoad) {
        out.push(issue('runtime_flow_reference_missing', `${base}.consumers[${consumerIndex}].initial_load_ref`, `consumer initial_load_ref 无法解析：${String(consumer.initial_load_ref)}。`));
      }
      const updateId = localRefId(consumer.update_ref, 'publication:');
      const hasUpdateRef = nonEmptyString(consumer.update_ref);
      const validUpdate = Boolean(updateId && publicationIds.has(updateId));
      if (hasUpdateRef && !validUpdate) {
        out.push(issue('runtime_flow_reference_missing', `${base}.consumers[${consumerIndex}].update_ref`, `consumer update_ref 无法解析：${String(consumer.update_ref)}。`));
      } else if (!hasUpdateRef && (publications.length > 0 || subscriptions.length > 0)) {
        out.push(issue('runtime_flow_consumer_update_missing', `${base}.consumers[${consumerIndex}].update_ref`, '存在 publication/subscription 时，consumer 必须声明后续更新来源。'));
      }
      if (validUpdate && updateId) {
        const ids = publicationConsumers.get(updateId) ?? new Set<string>();
        const consumerId = getId(consumer, 'consumer_id');
        if (consumerId) ids.add(consumerId);
        publicationConsumers.set(updateId, ids);
      }
      if (!validInitialLoad && !validUpdate) {
        out.push(issue('runtime_flow_consumer_orphan', `${base}.consumers[${consumerIndex}]`, 'consumer 无法追到首次加载或后续更新来源。'));
      }
    });
    publications.forEach((publication, publicationIndex) => {
      const publicationId = getId(publication, 'publication_id');
      if (publicationId && (publicationConsumers.get(publicationId)?.size ?? 0) === 0) {
        out.push(issue('runtime_flow_publication_orphan', `${base}.publications[${publicationIndex}]`, `publication=${publicationId} 没有任何受影响 consumer。`));
      }
    });
    mutations.forEach((mutation, mutationIndex) => {
      const publicationId = localRefId(mutation.publication_ref, 'publication:');
      if (publicationId && publicationIds.has(publicationId) && (publicationConsumers.get(publicationId)?.size ?? 0) === 0) {
        out.push(issue('runtime_flow_mutation_consumer_missing', `${base}.mutations[${mutationIndex}].publication_ref`, `mutation 的 publication=${publicationId} 未继续闭合到受影响 consumer。`));
      }
    });
    const lifecycle = asRecord(flow.lifecycle_coverage);
    for (const event of LIFECYCLE_EVENTS) {
      const coverage = asRecord(lifecycle?.[event]);
      if (!coverage || !['covered', 'not_applicable'].includes(String(coverage.status)) || asStrings(coverage.evidence_refs).length === 0) {
        out.push(issue('runtime_flow_lifecycle_gap', `${base}.lifecycle_coverage.${event}`, `生命周期 ${event} 未证据化闭合。`));
      }
    }
    if (!sourceOfTruth || !nonEmptyString(sourceOfTruth.authority) || !nonEmptyString(sourceOfTruth.reconciliation)) {
      out.push(issue('runtime_flow_source_of_truth_incomplete', `${base}.source_of_truth`, 'source_of_truth 必须说明 authority 与 reconciliation。'));
    }
  });
  return out;
}
