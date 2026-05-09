/** 聚合导出：供文档 / 工具链审计；脚本侧优先走各子文件。 */
export * as codingCompile from './coding-compile';
export * as utCompile from './ut-compile';
export * as utRun from './ut-run';
export * as deviceTest from './device-test';
export * as prdVisualHandoff from './prd-visual-handoff';
export type { CapabilityProvider, CapabilityProviderId } from './types';
