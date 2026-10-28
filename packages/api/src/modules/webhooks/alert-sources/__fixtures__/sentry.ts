// https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issue-alerts/
// https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/
// https://docs.sentry.io/organization/integrations/integration-platform/webhooks/metric-alerts/
export const issueAlert = {
	action: "triggered",
	actor: { id: "sentry", name: "Sentry", type: "application" },
	data: {
		event: {
			event_id: "e4874d664c3540c1a32eab185f12c5ab",
			issue_id: "1234567890",
			title: "ReferenceError: heck is not defined",
			culprit: "?(<anonymous>)",
			level: "error",
			project: 1,
			datetime: "2019-08-19T21:06:17.677000Z",
			tags: [
				["environment", "prod"],
				["service", "checkout"],
				["level", "error"],
			],
			url: "https://sentry.io/api/0/projects/acme/web/events/e4874d664c3540c1a32eab185f12c5ab/",
			web_url:
				"https://sentry.io/organizations/acme/issues/1234567890/events/e4874d664c3540c1a32eab185f12c5ab/",
			issue_url: "https://sentry.io/api/0/issues/1234567890/",
		},
		triggered_rule: "Send a notification for high priority issues",
	},
	installation: { uuid: "a8e5d37a-696c-4c54-adb5-b3f28d64c7de" },
};

export const issueResolved = {
	action: "resolved",
	actor: { id: 1, name: "Jane", type: "user" },
	data: {
		issue: {
			id: "1234567890",
			title: "ReferenceError: heck is not defined",
			culprit: "?(<anonymous>)",
			level: "error",
			status: "resolved",
			project: { id: "1", name: "web", slug: "web" },
			web_url: "https://sentry.io/organizations/acme/issues/1234567890/",
		},
	},
	installation: { uuid: "a8e5d37a-696c-4c54-adb5-b3f28d64c7de" },
};

export const metricAlert = {
	action: "critical",
	actor: { id: "sentry", name: "Sentry", type: "application" },
	data: {
		description_text: "1000 events in the last 10 minutes\nFilter: level:error",
		description_title: "Critical: Too many errors",
		metric_alert: {
			alert_rule: { id: "7", name: "Too many errors", projects: ["bar"] },
			id: "4",
			identifier: "1",
			projects: ["bar"],
			status: 2,
			title: "Sacred Marmot",
		},
		web_url: "https://sentry.io/organizations/baz/alerts/1/",
	},
	installation: { uuid: "a8e5d37a-696c-4c54-adb5-b3f28d64c7de" },
};

export const metricResolved = {
	...metricAlert,
	action: "resolved",
	data: {
		...metricAlert.data,
		description_title: "Resolved: Too many errors",
	},
};
