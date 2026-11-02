// https://docs.newrelic.com/docs/alerts/get-notified/message-templates/
// https://docs.newrelic.com/docs/alerts/get-notified/notification-integrations/
export const firing = {
	issueId: "a3b6d1f8-0d32-4b4e-9f7c-2d9c6b6f4e11",
	issueUrl:
		"https://one.newrelic.com/alerts-ai/issues/a3b6d1f8-0d32-4b4e-9f7c-2d9c6b6f4e11",
	title: "High error rate on checkout",
	priority: "CRITICAL",
	state: "ACTIVATED",
	trigger: "STATE_CHANGE",
	createdAt: 1758276000000,
	updatedAt: 1758276060000,
	totalIncidents: 1,
	entitiesData: { names: ["checkout-api"] },
	accumulations: {
		conditionName: ["Error rate above 5%"],
		policyName: ["Production"],
		tag: { service: ["checkout"] },
	},
};

export const resolved = { ...firing, state: "CLOSED", closedAt: 1758276600000 };

export const acknowledged = { ...firing, state: "ACKNOWLEDGED" };

export const classicOpen = {
	incident_id: 42,
	condition_name: "Apdex low",
	policy_name: "Production",
	current_state: "open",
	severity: "CRITICAL",
	details: "Apdex fell below 0.7 for 5 minutes",
	incident_url: "https://alerts.newrelic.com/accounts/1/incidents/42",
	targets: [{ name: "checkout-api", type: "Application" }],
};

export const classicClosed = { ...classicOpen, current_state: "closed" };
