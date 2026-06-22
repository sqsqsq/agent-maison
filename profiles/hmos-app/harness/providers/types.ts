/**
 * hmos-app · capability providers
 *
 * `profile.yaml > capabilities` 的 `provider` 字段与下列模块对应。每个 provider
 * 必须导出 `provider` metadata，capability-registry 会在动态 require 后校验
 * provider id / capability / expected export，避免 profile.yaml 与实现文件漂移。
 */

import type { CapabilityKey } from '../../../../harness/scripts/utils/types';

export type CapabilityProviderId =
  | 'ohpm'
  | 'hvigor'
  | 'hvigor_ohostest'
  | 'hvigor_hypium'
  | 'hvigor_app'
  | 'hdc'
  | 'hdc_app'
  | 'hylyre'
  | 'script'
  | 'none';

export interface CapabilityProvider {
  readonly id: CapabilityProviderId;
  readonly capability: CapabilityKey;
  readonly exports: readonly string[];
}
