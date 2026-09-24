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
	MODEL_SOURCES,
	type ModelSource,
	PERMISSION_MODES,
	type PermissionFidelity,
	type PermissionMode,
	type PermissionOutcome,
	PLACEMENTS,
	type Placement,
	type ResolvedModel,
	resolveHarnessModel,
	resolvePermissionOutcome,
	resolvePlacement,
} from "./providers/harness.js";
