// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Shell-only tool provisioning factory — the local/CLI default (ADR-0011). Builds a
 * read-only {@link ToolProvisioning} scoped to a working directory. The tool-seam
 * type model (shell vs connectors, the {@link ConnectorProvider} port) lives in
 * ./types.ts.
 */
import type { ToolProvisioning } from "./types.js";

/** The local/CLI default: shell-only, read-only. */
export function shellOnly(
	cwd: string,
	opts?: { readOnly?: boolean; allowList?: string[] },
): ToolProvisioning {
	return {
		shell: {
			cwd,
			readOnly: opts?.readOnly ?? true,
			allowList: opts?.allowList,
		},
	};
}
