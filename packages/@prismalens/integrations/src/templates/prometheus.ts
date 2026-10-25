// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";
import { SOURCE_AUTH_KINDS } from "./source-auth.js";

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
				"Credentials and query strings in the URL are not supported; choose how to sign in below.",
		},
	],
	connectionCredentialFields: [],
	urlOnly: true,
	credentialKinds: SOURCE_AUTH_KINDS,
	authenticate: {},
	proxy: { baseUrl: "{{baseUrl}}" },
	verify: { method: "GET", path: "/-/ready" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "URL" },
};
