// https://developer.pagerduty.com/docs/webhooks-overview
const incident = {
	id: "PGR0VU2",
	type: "incident",
	self: "https://api.pagerduty.com/incidents/PGR0VU2",
	html_url: "https://acme.pagerduty.com/incidents/PGR0VU2",
	number: 2,
	status: "triggered",
	incident_key: "d3640fbd41094207a1c11e58e46b1662",
	created_at: "2020-04-09T15:16:27Z",
	title: "A little bump in the road",
	service: {
		html_url: "https://acme.pagerduty.com/services/PF9KMXH",
		id: "PF9KMXH",
		summary: "API Service",
		type: "service_reference",
	},
	teams: [
		{
			html_url: "https://acme.pagerduty.com/teams/PFCVPS0",
			id: "PFCVPS0",
			summary: "Engineering",
			type: "team_reference",
		},
	],
	priority: { id: "PSO75BM", summary: "P1", type: "priority_reference" },
	urgency: "high",
};

const wrap = (event_type: string, status: string) => ({
	event: {
		id: "5ac64822-4adc-4fda-ade0-410becf0de4f",
		event_type,
		resource_type: "incident",
		occurred_at: "2020-10-02T18:45:22.169Z",
		agent: { id: "PLH1HKV", summary: "Tenex Engineer", type: "user_reference" },
		client: { name: "PagerDuty" },
		data: { ...incident, status },
	},
});

export const triggered = wrap("incident.triggered", "triggered");
export const acknowledged = wrap("incident.acknowledged", "acknowledged");
export const resolved = wrap("incident.resolved", "resolved");
