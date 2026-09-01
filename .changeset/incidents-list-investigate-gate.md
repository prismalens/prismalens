---
"prismalens": patch
---

ui: gate incidents list investigate buttons on harness readiness and render refusal reason (issue #520)

- The Investigate buttons on the incidents list (`IncidentTable` and `IncidentDataTable`) now consume the same harness readiness and AI provider status as the detail page and picker. When no harness or provider is usable, the button is disabled and displays the remedy in a tooltip on hover.
- Handled HTTP 412 server refusals when initiating investigations across the incidents list, incident detail page, and command center dashboard by rendering the specific server-provided refusal reason in the error toast rather than a generic error.
