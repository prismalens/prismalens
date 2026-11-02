// https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/webhook-notifier/
export const firing = {
	receiver: "My Super Webhook",
	status: "firing",
	orgId: 1,
	alerts: [
		{
			status: "firing",
			labels: {
				alertname: "High memory usage",
				team: "blue",
				zone: "us-1",
				service: "checkout",
				severity: "critical",
			},
			annotations: {
				description: "The system has high memory usage",
				runbook_url: "https://myrunbook.com/runbook/1234",
				summary: "This alert was triggered for zone us-1",
			},
			startsAt: "2021-10-12T09:51:03.157076+02:00",
			endsAt: "0001-01-01T00:00:00Z",
			generatorURL: "https://play.grafana.org/alerting/1afz29v7z/edit",
			fingerprint: "c6eadffa33fcdf37",
			dashboardURL: "",
			panelURL: "",
			values: { B: 44.23943737541908, C: 1 },
		},
	],
	groupLabels: {},
	commonLabels: { team: "blue" },
	commonAnnotations: {},
	externalURL: "https://play.grafana.org/",
	version: "1",
	groupKey: "{}:{}",
	truncatedAlerts: 0,
	title: "[FIRING:1]  (blue)",
	state: "alerting",
	message: "**Firing**",
};

export const resolved = {
	...firing,
	status: "resolved",
	state: "ok",
	title: "[RESOLVED]  (blue)",
	alerts: [
		{
			...firing.alerts[0],
			status: "resolved",
			endsAt: "2021-10-12T10:05:03.157076+02:00",
			values: { B: 12.1, C: 0 },
		},
	],
};
