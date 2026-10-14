// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Case File route contracts (experiment, behind Setting `case_file`)
 */
import { oc } from "@orpc/contract";
import {
	ArtifactIdParamSchema,
	ArtifactTextSchema,
	BindingDetectionSchema,
	CaptureSummarySchema,
	CaseFileSettingsSchema,
	CaseViewQuerySchema,
	CaseViewSchema,
	ConfirmBindingInputSchema,
	IncidentIdParamSchema,
	ManifestVerifySchema,
	ServiceBindingSchema,
	ServiceIdParamSchema,
	SuccessResponseSchema,
} from "../schemas/index.js";

const tags = ["case-files"];

export const caseFilesContract = {
	settings: {
		/** GET /case-files/settings */
		get: oc
			.route({
				method: "GET",
				path: "/case-files/settings",
				summary: "Whether Case File capture is on",
				tags,
			})
			.output(CaseFileSettingsSchema),

		/** PUT /case-files/settings */
		update: oc
			.route({
				method: "PUT",
				path: "/case-files/settings",
				summary: "Turn Case File capture on or off",
				tags,
			})
			.input(CaseFileSettingsSchema)
			.output(CaseFileSettingsSchema),
	},

	bindings: {
		/** GET /services/{serviceId}/binding/detect */
		detect: oc
			.route({
				method: "GET",
				path: "/services/{serviceId}/binding/detect",
				summary: "What kubectl on this machine offers for a binding",
				tags,
			})
			.input(ServiceIdParamSchema)
			.output(BindingDetectionSchema),

		/** GET /services/{serviceId}/binding */
		get: oc
			.route({
				method: "GET",
				path: "/services/{serviceId}/binding",
				summary: "The service's Kubernetes binding, if any",
				tags,
			})
			.input(ServiceIdParamSchema)
			.output(ServiceBindingSchema.nullable()),

		/** PUT /services/{serviceId}/binding */
		confirm: oc
			.route({
				method: "PUT",
				path: "/services/{serviceId}/binding",
				summary: "Bind the service to a kube context and namespace",
				tags,
			})
			.input(ConfirmBindingInputSchema)
			.output(ServiceBindingSchema),

		/** POST /services/{serviceId}/binding/probe */
		probe: oc
			.route({
				method: "POST",
				path: "/services/{serviceId}/binding/probe",
				summary: "Check the binding with one real read",
				tags,
			})
			.input(ServiceIdParamSchema)
			.output(ServiceBindingSchema),

		/** DELETE /services/{serviceId}/binding */
		remove: oc
			.route({
				method: "DELETE",
				path: "/services/{serviceId}/binding",
				summary: "Unbind the service",
				tags,
			})
			.input(ServiceIdParamSchema)
			.output(SuccessResponseSchema),
	},

	cases: {
		/** GET /cases/{incidentId}?asOf=<iso> */
		get: oc
			.route({
				method: "GET",
				path: "/cases/{incidentId}",
				summary: "The incident's case as it stood at asOf",
				tags,
			})
			.input(CaseViewQuerySchema)
			.output(CaseViewSchema),

		/** GET /cases/artifacts/{artifactId}: the redacted copy only, capped at 1 MiB */
		artifact: oc
			.route({
				method: "GET",
				path: "/cases/artifacts/{artifactId}",
				summary: "One captured artifact's redacted text",
				tags,
			})
			.input(ArtifactIdParamSchema)
			.output(ArtifactTextSchema),

		/** POST /cases/{incidentId}/verify */
		verify: oc
			.route({
				method: "POST",
				path: "/cases/{incidentId}/verify",
				summary: "Re-check the case's manifest chain and files",
				tags,
			})
			.input(IncidentIdParamSchema)
			.output(ManifestVerifySchema),

		/** POST /cases/{incidentId}/capture */
		capture: oc
			.route({
				method: "POST",
				path: "/cases/{incidentId}/capture",
				summary: "Capture the bound target now",
				tags,
			})
			.input(IncidentIdParamSchema)
			.output(CaptureSummarySchema),
	},
};
