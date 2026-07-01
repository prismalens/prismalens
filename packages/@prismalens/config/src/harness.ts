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
	type PermissionFidelity,
} from "./providers/harness.js";
