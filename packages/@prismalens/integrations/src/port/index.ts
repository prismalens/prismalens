// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type {
	Authorization,
	CredentialContext,
	CredentialKind,
} from "./credential-kind.js";
export { SourceRegistry } from "./registry.js";
export {
	defineSourceTool,
	SOURCE_TOOL_NAME,
	type SourceTool,
	type SourceToolContext,
	SourceToolRefused,
	type SourceToolResult,
} from "./source-tool.js";
