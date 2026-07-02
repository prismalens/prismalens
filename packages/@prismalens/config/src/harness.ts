/**
 * @prismalens/config/harness
 *
 * Harness backend metadata (SSOT). Browser-safe: no Node.js dependencies.
 */

export {
	HARNESS_BINARY,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
	type HarnessTransport,
	PERMISSION_MODES,
	type PermissionFidelity,
	type PermissionMode,
	type PermissionOutcome,
	resolvePermissionOutcome,
} from "./providers/harness.js";
