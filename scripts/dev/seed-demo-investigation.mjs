// Seeds a stable demo incident + ensures a pending investigation to run the engine on,
// and sets Google Gemini as the active LLM provider. The API key itself is supplied via
// GOOGLE_API_KEY in the API process env at runtime (not stored here).
// Idempotent: reuses the demo incident and any existing pending investigation.
// Usage: node scripts/dev/seed-demo-investigation.mjs   (or: pnpm seed:demo)
import { prisma } from "../../packages/@prismalens/database/dist/client.js";

const DEMO_TITLE = "Checkout API returning 503s after deploy";

const llmSettings = {
	activeProvider: "google",
	providers: { google: { model: "gemini-2.5-flash" } },
};
await prisma.setting.upsert({
	where: { key: "LLM_SETTINGS" },
	update: { value: JSON.stringify(llmSettings) },
	create: { key: "LLM_SETTINGS", value: JSON.stringify(llmSettings) },
});

let incident = await prisma.incident.findFirst({ where: { title: DEMO_TITLE } });
if (!incident) {
	const maxNumber = (await prisma.incident.aggregate({ _max: { number: true } }))
		._max.number;
	incident = await prisma.incident.create({
		data: {
			number: (maxNumber ?? 0) + 1,
			title: DEMO_TITLE,
			description:
				"Error rate on checkout-api spiked to ~40% shortly after the 14:20 rollout. Users see 'Service Unavailable' at payment; pods appear to be restarting in a loop.",
			severity: "high",
			status: "triggered",
			customerImpact: "Payments failing for ~40% of checkout attempts.",
			affectedSystems: JSON.stringify(["checkout-api", "payments"]),
			alertCount: 3,
		},
	});
}

let investigation = await prisma.investigation.findFirst({
	where: { incidentId: incident.id, status: "pending" },
	orderBy: { createdAt: "desc" },
});
if (!investigation) {
	investigation = await prisma.investigation.create({
		data: { incidentId: incident.id, status: "pending" },
	});
}

console.log(`INCIDENT_NUMBER=INC-${incident.number}`);
console.log(`INVESTIGATION_ID=${investigation.id}`);
await prisma.$disconnect();
