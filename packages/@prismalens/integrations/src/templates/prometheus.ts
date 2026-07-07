// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

const prometheusPermissions: PermissionRequirement[] = [
	{
		key: "query",
		reason: "Read metrics data for monitoring and alerting",
		capabilities: ["monitoring:read"],
	},
];

export const prometheus: AuthTemplate = {
	id: "prometheus",
	name: "Prometheus",
	version: "1.0.0",
	category: "observability",
	authMode: "basic",
	icon: "https://prometheus.io/assets/prometheus_logo_grey.svg",
	docsUrl: "https://prometheus.io/docs/prometheus/latest/querying/api/",
	setupDocsUrl: "https://docs.prismalens.io/integrations/prometheus/",
	requiredPermissions: prometheusPermissions,
	connectionFields: [
		{
			name: "baseUrl",
			label: "Prometheus URL",
			type: "string",
			required: true,
			placeholder: "http://prometheus:9090",
			description: "Prometheus server URL",
			default: "http://localhost:9090",
		},
	],
	connectionCredentialFields: [
		{
			name: "username",
			label: "Username",
			type: "string",
			required: false,
			placeholder: "admin",
			description: "Basic auth username (optional)",
		},
		{
			name: "apiKey",
			label: "Password / API Key",
			type: "password",
			required: false,
			description: "Basic auth password (optional)",
			sensitive: true,
		},
	],
	authenticate: {
		headers: {
			Authorization: 'Basic {{base64(username + ":" + apiKey)}}',
		},
	},
	proxy: {
		baseUrl: "{{baseUrl}}",
	},
	verify: { method: "GET", path: "/api/v1/status/config" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "Basic Auth" },
};
