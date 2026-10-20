// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";

/** A vendor MCP server the gateway proxies (#848, 06); saved through the connect flow only. */
export const mcpServer: AuthTemplate = {
	id: "mcp-server",
	name: "MCP server",
	version: "1.0.0",
	category: "observability",
	authMode: "api_key",
	setupDocsUrl: "https://docs.prismalens.io/guides/connect-a-source/",
	connectionFields: [],
	connectionCredentialFields: [],
	urlOnly: true,
	credentialKinds: ["bearer", "header", "mcp-oauth", "none"],
	authenticate: {},
	proxy: { baseUrl: "{{baseUrl}}" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "MCP", listed: false },
};
