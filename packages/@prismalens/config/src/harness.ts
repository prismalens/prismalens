// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export {
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
	isAdmitted,
	MODEL_SOURCES,
	type ModelSource,
	PERMISSION_MODES,
	type PermissionFidelity,
	type PermissionMode,
	type PermissionOutcome,
	PLACEMENTS,
	type Placement,
	type ResolvedModel,
	refuseModel,
	resolveHarnessModel,
	resolvePermissionOutcome,
	resolvePlacement,
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
