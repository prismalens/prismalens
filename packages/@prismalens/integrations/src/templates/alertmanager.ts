// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";

export const alertmanager: AuthTemplate = {
	id: "alertmanager",
	name: "Alertmanager",
	version: "1.0.0",
	category: "observability",
	authMode: "api_key",
	docsUrl: "https://prometheus.io/docs/alerting/latest/alertmanager/",
	setupDocsUrl: "https://docs.prismalens.io/integrations/alertmanager/",
	requiredPermissions: [
		{
			key: "http_read",
			reason: "Read-only HTTP API",
			capabilities: ["monitoring:read"],
		},
	],
	connectionFields: [
		{
			name: "baseUrl",
			label: "Alertmanager URL",
			type: "string",
			required: true,
			placeholder: "http://alertmanager.internal:9093",
			pattern: "^https?://[^\\s/$.?#].[^\\s]*$",
			description:
				"Reachable from this machine without credentials. Put a read-only reverse proxy in front if your Alertmanager needs auth.",
		},
	],
	connectionCredentialFields: [],
	authenticate: {},
	proxy: { baseUrl: "{{baseUrl}}" },
	verify: { method: "GET", path: "/-/ready" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "URL only" },
};
