// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";

export const prometheus: AuthTemplate = {
	id: "prometheus",
	name: "Prometheus",
	version: "1.0.0",
	category: "observability",
	authMode: "api_key",
	docsUrl: "https://prometheus.io/docs/prometheus/latest/querying/api/",
	setupDocsUrl: "https://docs.prismalens.io/integrations/prometheus/",
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
			label: "Prometheus URL",
			type: "string",
			required: true,
			placeholder: "http://prometheus.internal:9090",
			pattern: "^https?://[^@\\s/$.?#][^@?#\\s]*$",
			description:
				"Credentials and query strings in the URL are not supported. Reachable from this machine without credentials. Put a read-only reverse proxy in front if your Prometheus needs auth.",
		},
	],
	connectionCredentialFields: [],
	urlOnly: true,
	authenticate: {},
	proxy: { baseUrl: "{{baseUrl}}" },
	verify: { method: "GET", path: "/-/ready" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "URL only" },
};
