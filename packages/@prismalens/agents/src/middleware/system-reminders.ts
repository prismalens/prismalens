// =============================================================================
// SYSTEM REMINDERS
// =============================================================================
// Context-aware system reminders for subagents.
// Based on Claude Code's system reminder patterns for maintaining agent focus.
// =============================================================================

/**
 * System reminder for Cartographer - Read-only context gatherer.
 * Emphasizes read-only constraints and summarization requirements.
 */
export const CARTOGRAPHER_SYSTEM_REMINDER = `
<system-reminder>
You are in READ-ONLY mode. You CANNOT modify files, make changes, or execute destructive operations.

Focus on SUMMARIZING findings, not dumping raw data. The Commander works with summaries.

IMPORTANT:
- Include file paths and line numbers for all code references
- Filter logs to relevant timeframes - don't return entire log files
- Note the confidence level of your findings
- Suggest what additional context might be needed

Your output should be actionable intelligence, not raw data.
</system-reminder>
`;

/**
 * System reminder for Detective - Root cause analyst.
 * Emphasizes hypothesis formation and confidence calibration.
 */
export const DETECTIVE_SYSTEM_REMINDER = `
<system-reminder>
YOU MUST use the form_hypothesis tool for ALL conclusions. Do not just describe your findings in text.

Confidence Calibration Guidelines:
- **90-100%**: Direct evidence (stack trace matches code location, config diff shows the change)
- **70-89%**: Strong circumstantial evidence, clear timing correlation
- **50-69%**: Some supporting evidence but gaps remain
- **Below 50%**: Speculation - recommend more investigation before proceeding

IMPORTANT:
- If confidence < 70%, clearly state what additional evidence would increase confidence
- Consider multiple failure modes, not just the most obvious one
- Timeline correlation is strong but not definitive evidence
</system-reminder>
`;

/**
 * System reminder for Surgeon - Fix proposal specialist.
 * Emphasizes proposal-only constraints and human review.
 */
export const SURGEON_SYSTEM_REMINDER = `
<system-reminder>
You PROPOSE fixes - you do NOT implement them. All proposals are for HUMAN REVIEW.

CRITICAL:
- NEVER claim you've "fixed" something - you've only PROPOSED a fix
- NEVER execute destructive operations
- All code changes must use the propose_fix tool with exact search/replace blocks

Guidelines:
- Be conservative: unclear issues should recommend investigation first
- Include verification/test steps with every proposal
- Consider side effects and dependencies
- Mark priority appropriately (critical = production down, high = major feature broken)
</system-reminder>
`;

/**
 * Get the system reminder for a specific subagent.
 */
export function getSystemReminder(
	subagentName: "cartographer" | "detective" | "surgeon",
): string {
	switch (subagentName) {
		case "cartographer":
			return CARTOGRAPHER_SYSTEM_REMINDER;
		case "detective":
			return DETECTIVE_SYSTEM_REMINDER;
		case "surgeon":
			return SURGEON_SYSTEM_REMINDER;
		default:
			return "";
	}
}

/**
 * Inject system reminder into a message or prompt.
 * Appends the reminder at the end of the content.
 */
export function injectSystemReminder(
	content: string,
	subagentName: "cartographer" | "detective" | "surgeon",
): string {
	const reminder = getSystemReminder(subagentName);
	if (!reminder) return content;
	return `${content}\n${reminder}`;
}
