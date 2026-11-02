// https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-common-schema
const alertId =
	"/subscriptions/00000000-1111-2222-3333-444444444444/providers/Microsoft.AlertsManagement/alerts/aaaa0a0a-bb1b-cc2c-dd3d-eeeeee4e4e4e";

const alert = (monitorCondition: "Fired" | "Resolved") => ({
	schemaId: "azureMonitorCommonAlertSchema",
	data: {
		essentials: {
			alertId,
			alertRule: "WCUS-R2-Gen2",
			severity: "Sev1",
			signalType: "Metric",
			monitorCondition,
			monitoringService: "Platform",
			alertTargetIDs: [
				"/subscriptions/00000000-1111-2222-3333-444444444444/resourcegroups/pipelinealertrg/providers/microsoft.compute/virtualmachines/wcus-r2-gen2",
			],
			configurationItems: ["wcus-r2-gen2"],
			originAlertId:
				"3f2d4487-b0fc-4125-8bd5-7ad17384221e_PipeLineAlertRG_microsoft.insights_metricAlerts_WCUS-R2-Gen2_-117781227",
			firedDateTime: "2019-03-22T13:58:24.3713213Z",
			...(monitorCondition === "Resolved" && {
				resolvedDateTime: "2019-03-22T14:03:16.2246313Z",
			}),
			description: "CPU above 25 percent",
			essentialsVersion: "1.0",
			alertContextVersion: "1.0",
		},
		alertContext: {
			properties: null,
			conditionType: "SingleResourceMultipleMetricCriteria",
		},
		customProperties: { service: "checkout" },
	},
});

export const firing = alert("Fired");
export const resolved = alert("Resolved");
