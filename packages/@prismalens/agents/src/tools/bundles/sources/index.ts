// =============================================================================
// BUNDLE SOURCES INDEX
// =============================================================================
// Exports all bundle source implementations.
// =============================================================================

export {
	FilesystemBundleSource,
	createFilesystemBundleSource,
	type FilesystemBundleSourceConfig,
} from "./filesystem.js";

export {
	NativeBundleSource,
	createNativeBundleSource,
	type NativeBundleSourceConfig,
} from "./native.js";

export {
	OpenApiBundleSource,
	createOpenApiBundleSource,
	type OpenApiBundleDefinition,
	type OpenApiBundleSourceConfig,
} from "./openapi.js";
