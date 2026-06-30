/**
 * Tool provisioning — the seam (ADR-0011; candidate ADR-0012) that decides HOW a
 * Tier-2 harness reaches data:
 *
 *   - SHELL-FIRST (local: CLI / desktop / local web): the harness uses its OWN
 *     shell + reads the source in `cwd`. Primary modality (ADR-0005).
 *   - INTEGRATION-FIRST (server: self-hosted / cloud): the harness calls MCP
 *     connectors backed by a vaulted token store. Pluggable secondary, added in
 *     Phase D — the engine ships the seam now, wired shell-only.
 *
 * The Tier-1 supervisor stays AGNOSTIC: it resolves a {@link ToolProvisioning}
 * per runtime and hands it to the harness; each harness adapter translates it to
 * its native tool mechanism (ACP fs/terminal + `mcpServers`; Claude Agent SDK
 * `allowedTools` + `mcpServers`). The canonical event stream is identical either
 * way — which side was used never leaks past the harness.
 *
 * Connectors arrive via a {@link ConnectorProvider} the EMBEDDING APP injects, so
 * the engine library never depends on the token vault or the integration engine
 * (keeps the standalone CLI server-config-free — ADR-0011 §consequences).
 */

/** A runnable MCP server the harness connects to (stdio-spawned or remote http). */
export type McpServerConfig =
	| {
			transport: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  }
	| { transport: "http"; url: string; headers?: Record<string, string> };

/** Shell-first provisioning: configure the harness's NATIVE shell + file tools. */
export interface ShellProvisioning {
	/** Working directory the harness reads (the repo / source checkout). */
	cwd: string;
	/** Read-only — no Edit/Write/mutating shell. The investigation default. */
	readOnly: boolean;
	/** Optional command allow-list, e.g. ["gh","kubectl","curl","jq","grep","cat"]. */
	allowList?: string[];
}

/** A connector resolved to a runnable MCP server — credentials ALREADY injected. */
export interface ResolvedConnector {
	/** Stable id: "prometheus" | "loki" | "github" | "jira" | "confluence" | … */
	id: string;
	/** The MCP server the harness calls; creds already resolved from the vault. */
	mcp: McpServerConfig;
	/** Read-only connector — query, never mutate. */
	readOnly: boolean;
}

/**
 * The tool surface handed to a harness for one investigation. Typically exactly
 * one side is populated per runtime (`shell` locally, `connectors` on a server);
 * a runtime MAY compose both (e.g. desktop with extra connectors).
 */
export interface ToolProvisioning {
	shell?: ShellProvisioning;
	connectors?: ResolvedConnector[];
}

/** Narrowing scope passed when resolving connectors for an investigation. */
export interface ConnectorResolveContext {
	/** Tenant/org scope (single-tenant deploys may ignore it). */
	orgId?: string;
	/** Services in scope for this investigation, if known (to narrow connectors). */
	services?: string[];
}

/**
 * PORT (ADR-0011): the engine declares this slot; the EMBEDDING APP supplies the
 * adapter (backed by its integration engine + token vault). Local/CLI leave it
 * unset and use {@link ShellProvisioning}. The engine never imports a vault.
 */
export interface ConnectorProvider {
	/**
	 * Resolve the connector set for an investigation. Vault lookups happen INSIDE
	 * the adapter (server-side); returned connectors carry resolved credentials.
	 */
	resolve(ctx: ConnectorResolveContext): Promise<ResolvedConnector[]>;
}

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
