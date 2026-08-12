---
"prismalens": minor
---

The first-run setup wizard now finishes the job. After creating the owner account it walks a new install through the two things an investigation cannot run without — an AI provider and a local code checkout — and then hands off to a first incident. Previously `pl up` dropped a new user on a dashboard with no model configured, no service mapped to a checkout, and no explanation of either.

The wizard resumes correctly, because it keeps no progress of its own. `GET /setup/status` now reports each step (`owner`, `aiProvider`, `codeLocation`, `firstIncident`) derived from durable state — a user row, a stored credential, a service with a `localCheckoutPath`, an incident row — and returns the first incomplete one as `currentStep`. A reload, a sign-in bounce, or a different browser lands on the thing that is genuinely still missing instead of falling straight through to the dashboard as the old binary `account → complete` state machine did. `setupComplete` still means only "an owner exists", so it remains the auth gate and the later steps never lock anyone out of the app.

The provider step is a composition over the existing **Settings → AI Provider** surface, so there is still exactly one credential path in the app: the key is encrypted with AES-256-GCM by the token vault and stored in the database. The CLI's own `auth.json` is untouched.

Empty screens are no longer dead ends. The dashboard, incidents and alerts pages now name whichever setup step is outstanding and link to it, instead of describing a source of data the operator has not connected yet and offering nowhere to go.
