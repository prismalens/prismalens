// https://docs.datadoghq.com/integrations/webhooks/
export const firing = {
	alert_id: "1234567",
	alert_title: "[Triggered on {host:web-1}] CPU high on web-1",
	alert_transition: "Triggered",
	alert_status: "Triggered",
	alert_type: "error",
	alert_scope: "host:web-1",
	priority: "P2",
	hostname: "web-1",
	tags: "env:prod,service:checkout,team:payments",
	body: "CPU user is above 90% on web-1",
	link: "https://app.datadoghq.com/monitors/1234567",
};

export const resolved = {
	...firing,
	alert_title: "[Recovered on {host:web-1}] CPU high on web-1",
	alert_transition: "Recovered",
	alert_status: "Recovered",
	alert_type: "success",
	body: "CPU user is back under 90% on web-1",
};
