/**
 * Service discovery route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AcceptBulkSuggestionsResponseSchema,
	AcceptBulkSuggestionsSchema,
	AcceptSuggestionResponseSchema,
	AcceptSuggestionSchema,
	IdParamSchema,
	ServiceSuggestionQuerySchema,
	ServiceSuggestionSchema,
	TriggerDiscoveryResponseSchema,
	TriggerDiscoverySchema,
} from "../schemas/index.js";

export const serviceDiscoveryContract = {
	/**
	 * List service suggestions
	 * GET /service-discovery/suggestions
	 */
	listSuggestions: oc
		.route({
			method: "GET",
			path: "/service-discovery/suggestions",
			summary: "List pending service suggestions",
			tags: ["service-discovery"],
		})
		.input(ServiceSuggestionQuerySchema)
		.output(z.array(ServiceSuggestionSchema)),

	/**
	 * Get a single service suggestion
	 * GET /service-discovery/suggestions/:id
	 */
	getSuggestion: oc
		.route({
			method: "GET",
			path: "/service-discovery/suggestions/{id}",
			summary: "Get service suggestion by ID",
			tags: ["service-discovery"],
		})
		.input(IdParamSchema)
		.output(ServiceSuggestionSchema),

	/**
	 * Accept a service suggestion
	 * POST /service-discovery/suggestions/:id/accept
	 */
	acceptSuggestion: oc
		.route({
			method: "POST",
			path: "/service-discovery/suggestions/{id}/accept",
			summary: "Accept service suggestion and create service",
			tags: ["service-discovery"],
		})
		.input(IdParamSchema.merge(AcceptSuggestionSchema))
		.output(AcceptSuggestionResponseSchema),

	/**
	 * Reject a service suggestion
	 * POST /service-discovery/suggestions/:id/reject
	 */
	rejectSuggestion: oc
		.route({
			method: "POST",
			path: "/service-discovery/suggestions/{id}/reject",
			summary: "Reject service suggestion",
			tags: ["service-discovery"],
		})
		.input(IdParamSchema)
		.output(ServiceSuggestionSchema),

	/**
	 * Ignore a service suggestion
	 * POST /service-discovery/suggestions/:id/ignore
	 */
	ignoreSuggestion: oc
		.route({
			method: "POST",
			path: "/service-discovery/suggestions/{id}/ignore",
			summary: "Ignore service suggestion",
			tags: ["service-discovery"],
		})
		.input(IdParamSchema)
		.output(ServiceSuggestionSchema),

	/**
	 * Accept multiple suggestions at once
	 * POST /service-discovery/suggestions/bulk-accept
	 */
	acceptBulkSuggestions: oc
		.route({
			method: "POST",
			path: "/service-discovery/suggestions/bulk-accept",
			summary: "Accept multiple service suggestions",
			tags: ["service-discovery"],
		})
		.input(AcceptBulkSuggestionsSchema)
		.output(AcceptBulkSuggestionsResponseSchema),

	/**
	 * Trigger service discovery
	 * POST /service-discovery/discover
	 */
	triggerDiscovery: oc
		.route({
			method: "POST",
			path: "/service-discovery/discover",
			summary: "Trigger service discovery from integration",
			tags: ["service-discovery"],
		})
		.input(TriggerDiscoverySchema)
		.output(TriggerDiscoveryResponseSchema),
};
