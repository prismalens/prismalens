// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export {
	AGENT_DEFAULT_MODE,
	agentModeEnv,
	getHarnessProviderKeys,
	HARNESS_AUTO_ORDER,
	HARNESS_BINARY,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	HARNESS_SELECTION_FAILURES,
	type HarnessDescriptor,
	type HarnessId,
	type HarnessRunEnv,
	type HarnessSelectionFailure,
	harnessEnvModel,
	MODEL_SOURCES,
	type ModelSource,
	type ModeMechanism,
	modeFidelity,
	type PermissionFidelity,
	type ResolvedModel,
	refuseModel,
	resolveAgentMode,
	resolveHarnessModel,
	resumeBlockedReason,
} from "./providers/harness.js";
export {
	annotateModel,
	BUNDLED_MODEL_CATALOGUE,
	catalogueModels,
	type ModelCatalogue,
	type ModelEntry,
	parseModelCatalogue,
	pickModelCatalogue,
} from "./providers/model-catalogue.js";
