/**
 * Validation utilities for gatherer findings
 *
 * Provides code-based validation for gathered data including:
 * - Timestamp alignment with incident window
 * - Service matching
 * - Cross-correlation between findings
 * - Quality score calculation
 *
 * Uses progressive time windows that expand if insufficient data is found.
 */

import { Logger } from "@prismalens/logger";
import type {
	CorrelationResult,
	Finding,
	FindingValidation,
	IncidentContext,
	ValidationWindowLevel,
} from "../types/index.js";

const logger = new Logger({ context: "Validation" });

// =============================================================================
// CONSTANTS - Time Windows
// =============================================================================

/** Progressive log time windows (before, after incident) in hours */
export const LOG_WINDOWS: Record<ValidationWindowLevel, { before: number; after: number }> = {
	1: { before: 4, after: 1 },     // Level 1: -4h to +1h (fast, most relevant)
	2: { before: 12, after: 2 },    // Level 2: -12h to +2h (broader)
	3: { before: 48, after: 4 },    // Level 3: -48h to +4h (maximum)
};

/** Progressive change time windows (before incident) in hours */
export const CHANGE_WINDOWS: Record<ValidationWindowLevel, number> = {
	1: 24,   // Level 1: last 24 hours
	2: 72,   // Level 2: last 3 days
	3: 168,  // Level 3: last week
};

/** Minimum findings per source to avoid window expansion */
const MIN_FINDINGS_PER_SOURCE = 2;

/** Minimum quality score threshold */
export const MIN_QUALITY_THRESHOLD = 60;

// =============================================================================
// VALIDATION RESULT TYPES
// =============================================================================

export interface ValidationResult<T extends Finding = Finding> {
	/** Findings that passed validation */
	valid: T[];
	/** Findings that were filtered out */
	filtered: T[];
	/** Validation warnings */
	warnings: string[];
	/** Whether to suggest expanding time window */
	suggestExpandWindow: boolean;
}

// =============================================================================
// TIME HELPERS
// =============================================================================

/**
 * Parse an ISO timestamp string to Date
 */
function parseTimestamp(timestamp: string | undefined): Date | null {
	if (!timestamp) return null;
	const date = new Date(timestamp);
	return isNaN(date.getTime()) ? null : date;
}

/**
 * Check if a timestamp is within a window around an incident time
 */
function isWithinWindow(
	findingTimestamp: string | undefined,
	incidentTime: string | undefined,
	beforeHours: number,
	afterHours: number,
): boolean {
	const findingDate = parseTimestamp(findingTimestamp);
	const incidentDate = parseTimestamp(incidentTime);

	if (!findingDate || !incidentDate) {
		// If we can't parse timestamps, assume it's within window (don't filter)
		return true;
	}

	const windowStart = new Date(incidentDate.getTime() - beforeHours * 60 * 60 * 1000);
	const windowEnd = new Date(incidentDate.getTime() + afterHours * 60 * 60 * 1000);

	return findingDate >= windowStart && findingDate <= windowEnd;
}

/**
 * Extract timestamp from finding (checks both top-level and details)
 */
function getFindingTimestamp(finding: Finding): string | undefined {
	if (finding.timestamp) return finding.timestamp;

	// Try to extract from details
	const details = finding.details as Record<string, unknown> | undefined;
	if (details?.timestamp && typeof details.timestamp === "string") {
		return details.timestamp;
	}

	return undefined;
}

// =============================================================================
// SERVICE MATCHING
// =============================================================================

/**
 * Extract service name from finding (checks multiple locations)
 */
function getFindingService(finding: Finding): string | undefined {
	const details = finding.details as Record<string, unknown> | undefined;

	// Check common service name locations
	if (details?.service && typeof details.service === "string") {
		return details.service.toLowerCase();
	}
	if (details?.serviceName && typeof details.serviceName === "string") {
		return details.serviceName.toLowerCase();
	}
	if (details?.source && typeof details.source === "string") {
		return details.source.toLowerCase();
	}

	// For log findings, check for service in summary
	if (finding.type === "log" && finding.summary) {
		const match = finding.summary.match(/\[([^\]]+)\]/);
		if (match) return match[1].toLowerCase();
	}

	return undefined;
}

/**
 * Check if a finding's service matches incident service or dependencies
 */
function matchesService(
	finding: Finding,
	incidentServiceName: string | undefined,
	dependencies: string[] = [],
): boolean {
	if (!incidentServiceName) return true; // Can't verify, assume match

	const findingService = getFindingService(finding);
	if (!findingService) return true; // Can't verify, assume match

	const normalizedIncidentService = incidentServiceName.toLowerCase();
	const normalizedDeps = dependencies.map((d) => d.toLowerCase());

	return (
		findingService === normalizedIncidentService ||
		normalizedDeps.includes(findingService)
	);
}

// =============================================================================
// PER-GATHERER VALIDATION
// =============================================================================

/**
 * Validate log findings (from log-gatherer or preGather)
 */
export function validateLogFindings(
	findings: Finding[],
	context: {
		triggeredAt?: string;
		serviceName?: string;
		dependencies?: string[];
	},
	windowLevel: ValidationWindowLevel = 1,
): ValidationResult {
	const window = LOG_WINDOWS[windowLevel];
	const valid: Finding[] = [];
	const filtered: Finding[] = [];
	const warnings: string[] = [];

	for (const finding of findings) {
		const timestamp = getFindingTimestamp(finding);
		const timeAligned = isWithinWindow(
			timestamp,
			context.triggeredAt,
			window.before,
			window.after,
		);
		const serviceMatched = matchesService(
			finding,
			context.serviceName,
			context.dependencies,
		);

		// Build validation metadata
		const validation: FindingValidation = {
			timeAligned,
			serviceMatched,
			correlatedWith: [],
			warnings: [],
		};

		if (!timeAligned) {
			validation.warnings.push(`Log timestamp outside window (level ${windowLevel})`);
		}
		if (!serviceMatched) {
			validation.warnings.push("Log service does not match incident");
		}

		// Add validation to finding
		const validatedFinding: Finding = { ...finding, validation };

		// Filter out findings that fail both checks
		if (!timeAligned && !serviceMatched) {
			filtered.push(validatedFinding);
		} else {
			valid.push(validatedFinding);
		}
	}

	// Suggest window expansion if we have too few valid findings
	const suggestExpandWindow =
		valid.length < MIN_FINDINGS_PER_SOURCE && windowLevel < 3;

	if (filtered.length > 0) {
		warnings.push(`Filtered ${filtered.length} log findings outside validation criteria`);
	}

	logger.info("Log validation complete", {
		total: findings.length,
		valid: valid.length,
		filtered: filtered.length,
		windowLevel,
		suggestExpandWindow,
	});

	return { valid, filtered, warnings, suggestExpandWindow };
}

/**
 * Validate code findings (from code-searcher)
 */
export function validateCodeFindings(
	findings: Finding[],
	context: {
		clonePaths?: Record<string, string>;
		errorPatterns?: string[];
	},
): ValidationResult {
	const valid: Finding[] = [];
	const filtered: Finding[] = [];
	const warnings: string[] = [];

	for (const finding of findings) {
		const validation: FindingValidation = {
			timeAligned: true, // Code findings are not time-based
			serviceMatched: true, // Assume match since we searched in cloned repo
			correlatedWith: [],
			warnings: [],
		};

		// Check if finding correlates with error patterns
		if (context.errorPatterns && context.errorPatterns.length > 0) {
			const summary = finding.summary.toLowerCase();
			const hasPatternMatch = context.errorPatterns.some((pattern) =>
				summary.includes(pattern.toLowerCase()),
			);
			if (!hasPatternMatch) {
				validation.warnings.push("Code finding does not match error patterns");
			}
		}

		// Check file path validity (if we have details)
		const details = finding.details as Record<string, unknown> | undefined;
		if (details?.filePath && context.clonePaths) {
			const filePath = String(details.filePath);
			const hasValidPath = Object.values(context.clonePaths).some((basePath) =>
				filePath.startsWith(basePath) || !filePath.startsWith("/"),
			);
			if (!hasValidPath) {
				validation.warnings.push("File path not in cloned repository");
			}
		}

		const validatedFinding: Finding = { ...finding, validation };
		valid.push(validatedFinding); // Don't filter code findings, just warn
	}

	logger.info("Code validation complete", {
		total: findings.length,
		valid: valid.length,
		warnings: warnings.length,
	});

	return { valid, filtered, warnings, suggestExpandWindow: false };
}

/**
 * Validate change findings (from change-tracker)
 */
export function validateChangeFindings(
	findings: Finding[],
	context: {
		triggeredAt?: string;
		serviceName?: string;
		codeFiles?: string[];
	},
	windowLevel: ValidationWindowLevel = 1,
): ValidationResult {
	const windowHours = CHANGE_WINDOWS[windowLevel];
	const valid: Finding[] = [];
	const filtered: Finding[] = [];
	const warnings: string[] = [];

	for (const finding of findings) {
		const timestamp = getFindingTimestamp(finding);
		const timeAligned = isWithinWindow(
			timestamp,
			context.triggeredAt,
			windowHours,
			0, // No "after" window for changes - they must be before incident
		);

		const validation: FindingValidation = {
			timeAligned,
			serviceMatched: true, // Assume match for now
			correlatedWith: [],
			warnings: [],
		};

		if (!timeAligned) {
			validation.warnings.push(`Change outside window (level ${windowLevel})`);
		}

		// Check if change touches any of the code files found
		if (context.codeFiles && context.codeFiles.length > 0) {
			const details = finding.details as Record<string, unknown> | undefined;
			const changedFiles = (details?.files as string[]) || [];
			const touchesCodeFiles = changedFiles.some((file) =>
				context.codeFiles!.some((codeFile) =>
					file.includes(codeFile) || codeFile.includes(file),
				),
			);
			if (touchesCodeFiles) {
				validation.correlatedWith.push("code-findings");
			}
		}

		const validatedFinding: Finding = { ...finding, validation };

		// Filter out changes outside time window (unless they touch code files)
		if (!timeAligned && validation.correlatedWith.length === 0) {
			filtered.push(validatedFinding);
		} else {
			valid.push(validatedFinding);
		}
	}

	const suggestExpandWindow =
		valid.length < MIN_FINDINGS_PER_SOURCE && windowLevel < 3;

	if (filtered.length > 0) {
		warnings.push(`Filtered ${filtered.length} change findings outside time window`);
	}

	logger.info("Change validation complete", {
		total: findings.length,
		valid: valid.length,
		filtered: filtered.length,
		windowLevel,
		suggestExpandWindow,
	});

	return { valid, filtered, warnings, suggestExpandWindow };
}

// =============================================================================
// CROSS-CORRELATION
// =============================================================================

/**
 * Extract file paths from findings for correlation
 */
function extractFilePaths(findings: Finding[]): string[] {
	const paths: string[] = [];

	for (const finding of findings) {
		const details = finding.details as Record<string, unknown> | undefined;

		// Direct file path
		if (details?.filePath && typeof details.filePath === "string") {
			paths.push(details.filePath);
		}

		// Files array (for commits)
		if (Array.isArray(details?.files)) {
			paths.push(...(details.files as string[]));
		}

		// Extract from summary using common patterns
		const pathMatch = finding.summary.match(/[\w./\-]+\.[a-z]{2,5}(?::\d+)?/g);
		if (pathMatch) {
			paths.push(...pathMatch.map((p) => p.split(":")[0]));
		}
	}

	return [...new Set(paths)]; // Deduplicate
}

/**
 * Calculate overlap between two sets of file paths
 */
function calculateFileOverlap(paths1: string[], paths2: string[]): number {
	if (paths1.length === 0 || paths2.length === 0) return 0;

	let matches = 0;
	for (const p1 of paths1) {
		for (const p2 of paths2) {
			// Check for exact match or partial path match
			if (p1 === p2 || p1.endsWith(p2) || p2.endsWith(p1)) {
				matches++;
				break;
			}
		}
	}

	// Normalize to 0-100
	return Math.min(100, Math.round((matches / Math.min(paths1.length, paths2.length)) * 100));
}

/**
 * Calculate time correlation between changes and errors
 */
function calculateTimeCorrelation(
	changeFindings: Finding[],
	logFindings: Finding[],
): number {
	if (changeFindings.length === 0 || logFindings.length === 0) return 0;

	// Find error timestamps
	const errorTimestamps = logFindings
		.filter((f) => f.type === "log" || f.type === "error")
		.map((f) => parseTimestamp(getFindingTimestamp(f)))
		.filter((t): t is Date => t !== null)
		.sort((a, b) => a.getTime() - b.getTime());

	if (errorTimestamps.length === 0) return 0;

	const firstError = errorTimestamps[0];

	// Count changes that occurred before the first error
	let changesBeforeError = 0;
	let changeScoreSum = 0;

	for (const change of changeFindings) {
		const changeTime = parseTimestamp(getFindingTimestamp(change));
		if (!changeTime) continue;

		if (changeTime < firstError) {
			changesBeforeError++;
			// Score higher for changes closer to the error
			const hoursBefore = (firstError.getTime() - changeTime.getTime()) / (1000 * 60 * 60);
			if (hoursBefore <= 1) changeScoreSum += 100;
			else if (hoursBefore <= 4) changeScoreSum += 75;
			else if (hoursBefore <= 12) changeScoreSum += 50;
			else if (hoursBefore <= 24) changeScoreSum += 25;
			else changeScoreSum += 10;
		}
	}

	if (changesBeforeError === 0) return 0;
	return Math.min(100, Math.round(changeScoreSum / changesBeforeError));
}

/**
 * Check cross-correlation between findings from different sources
 */
export function checkCrossCorrelation(findings: Finding[]): CorrelationResult {
	const logFindings = findings.filter((f) => f.source === "log-gatherer");
	const codeFindings = findings.filter((f) => f.source === "code-searcher");
	const changeFindings = findings.filter((f) => f.source === "change-tracker");

	// Extract file paths from each source
	const logPaths = extractFilePaths(logFindings);
	const codePaths = extractFilePaths(codeFindings);
	const changePaths = extractFilePaths(changeFindings);

	// Calculate correlations
	const logCodeOverlap = calculateFileOverlap(logPaths, codePaths);
	const codeChangeOverlap = calculateFileOverlap(codePaths, changePaths);
	const changeTimeCorrelation = calculateTimeCorrelation(changeFindings, logFindings);

	// Weighted overall correlation
	const overallCorrelation = Math.round(
		logCodeOverlap * 0.3 +
		codeChangeOverlap * 0.4 +
		changeTimeCorrelation * 0.3,
	);

	logger.info("Cross-correlation complete", {
		logCodeOverlap,
		codeChangeOverlap,
		changeTimeCorrelation,
		overallCorrelation,
	});

	return {
		logCodeOverlap,
		codeChangeOverlap,
		changeTimeCorrelation,
		overallCorrelation,
	};
}

// =============================================================================
// RELEVANCE SCORING
// =============================================================================

/**
 * Extract keywords from incident title for pattern matching.
 * Filters out common stop words and short words.
 */
function extractKeywords(text: string | undefined): string[] {
	if (!text) return [];

	const stopWords = new Set([
		"the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to",
		"for", "of", "with", "by", "from", "as", "and", "or", "not", "be",
		"this", "that", "it", "has", "have", "had", "will", "would", "could",
		"should", "may", "might", "can", "do", "does", "did", "been", "being",
	]);

	return text
		.toLowerCase()
		.split(/[\s\-_]+/)
		.filter((word) => word.length > 3 && !stopWords.has(word));
}

/**
 * Calculate relevance score for a single finding against incident context.
 * Returns a score from 0-100 based on:
 * - Time proximity (40% max) - closer to incident time = higher score
 * - Service overlap (30% max) - matches incident service
 * - Error pattern match (30% max) - contains keywords from incident
 */
export function calculateFindingRelevanceScore(
	finding: Finding,
	incident: IncidentContext | null,
): number {
	if (!incident) return 50; // Default neutral score if no incident context

	let score = 0;

	// 1. Time proximity (40% weight)
	const findingTimestamp = getFindingTimestamp(finding);
	const incidentTimestamp = incident.triggeredAt;

	if (findingTimestamp && incidentTimestamp) {
		const findingTime = parseTimestamp(findingTimestamp);
		const incidentTime = parseTimestamp(incidentTimestamp);

		if (findingTime && incidentTime) {
			const timeDiffMs = Math.abs(findingTime.getTime() - incidentTime.getTime());
			const timeDiffMinutes = timeDiffMs / (1000 * 60);

			// Score based on proximity
			if (timeDiffMinutes <= 30) {
				score += 40; // Within 30 minutes = max score
			} else if (timeDiffMinutes <= 60) {
				score += 30; // Within 1 hour
			} else if (timeDiffMinutes <= 240) {
				score += 20; // Within 4 hours
			} else if (timeDiffMinutes <= 720) {
				score += 10; // Within 12 hours
			}
			// Beyond 12 hours = 0 time score
		}
	}

	// 2. Service overlap (30% weight)
	const findingService = getFindingService(finding);
	const incidentService = incident.serviceName?.toLowerCase();

	if (findingService && incidentService) {
		if (findingService === incidentService) {
			score += 30;
		} else if (findingService.includes(incidentService) || incidentService.includes(findingService)) {
			score += 15; // Partial match
		}
	}

	// 3. Error pattern match (30% weight)
	const keywords = extractKeywords(incident.title);
	const summaryLower = finding.summary.toLowerCase();

	if (keywords.length > 0) {
		const matchedKeywords = keywords.filter((kw) => summaryLower.includes(kw));
		const matchRatio = matchedKeywords.length / keywords.length;
		score += Math.round(matchRatio * 30);
	}

	return Math.min(100, score);
}

/**
 * Calculate aggregate relevance score for all findings against incident.
 * Returns average relevance score across all findings.
 */
export function calculateRelevanceScore(
	findings: Finding[],
	incident: IncidentContext | null,
): number {
	if (findings.length === 0) return 0;

	const totalScore = findings.reduce(
		(sum, finding) => sum + calculateFindingRelevanceScore(finding, incident),
		0,
	);

	return Math.round(totalScore / findings.length);
}

/**
 * Enrich findings with individual relevance scores.
 * Updates each finding's relevance property based on incident context.
 */
export function enrichFindingsWithRelevance(
	findings: Finding[],
	incident: IncidentContext | null,
): Finding[] {
	return findings.map((finding) => ({
		...finding,
		relevance: calculateFindingRelevanceScore(finding, incident),
	}));
}

// =============================================================================
// QUALITY SCORE CALCULATION
// =============================================================================

/**
 * Calculate overall data quality score for gathered findings
 */
export function calculateDataQualityScore(
	findings: Finding[],
	incident: IncidentContext | null,
): number {
	if (findings.length === 0) return 0;

	let score = 0;

	// 1. Relevance alignment (30% weight)
	const avgRelevance =
		findings.reduce((sum, f) => sum + f.relevance, 0) / findings.length;
	score += avgRelevance * 0.3;

	// 2. Time alignment (30% weight) - check validation metadata
	const timeAlignedCount = findings.filter(
		(f) => f.validation?.timeAligned !== false,
	).length;
	score += (timeAlignedCount / findings.length) * 30;

	// 3. Service alignment (20% weight)
	const serviceAlignedCount = findings.filter(
		(f) => f.validation?.serviceMatched !== false,
	).length;
	score += (serviceAlignedCount / findings.length) * 20;

	// 4. Source diversity (20% weight)
	const sources = new Set(findings.map((f) => f.source));
	score += Math.min(sources.size * 10, 20);

	return Math.min(100, Math.round(score));
}

/**
 * Check if quality score meets minimum threshold
 */
export function meetsQualityThreshold(
	score: number,
	threshold: number = MIN_QUALITY_THRESHOLD,
): boolean {
	return score >= threshold;
}

/**
 * Generate a unique ID for a finding (for correlation tracking)
 */
export function generateFindingId(finding: Finding): string {
	try {
		const hash = `${finding.source}-${finding.type}-${(finding.summary || "").slice(0, 50)}`;
		return Buffer.from(hash).toString("base64").slice(0, 12);
	} catch {
		// Fallback to timestamp-based ID if encoding fails
		return `${finding.source}-${Date.now()}`.slice(0, 12);
	}
}

/**
 * Add IDs to findings for correlation tracking
 */
export function addFindingIds(findings: Finding[]): Finding[] {
	return findings.map((f) => ({
		...f,
		id: f.id || generateFindingId(f),
	}));
}
