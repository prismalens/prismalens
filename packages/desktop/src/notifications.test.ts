// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	type FinishedInvestigation,
	type InvestigationStatus,
	type InvestigationSummary,
	newlyFinished,
	notificationText,
	snapshot,
} from "./notifications.js";

describe("notifications", () => {
	describe("newlyFinished", () => {
		it("announces running -> completed transition", () => {
			const previous = new Map<string, InvestigationStatus>([
				["inv-1", "running"],
			]);
			const current: InvestigationSummary[] = [
				{
					id: "inv-1",
					summary: "API latency spike",
					status: "completed",
					incidentId: "inc-100",
				},
			];
			expect(newlyFinished(previous, current)).toEqual([
				{
					id: "inv-1",
					summary: "API latency spike",
					status: "completed",
					incidentId: "inc-100",
				},
			]);
		});

		it("announces running -> failed transition", () => {
			const previous = new Map<string, InvestigationStatus>([
				["inv-2", "running"],
			]);
			const current: InvestigationSummary[] = [
				{
					id: "inv-2",
					summary: "Database connection timeouts",
					status: "failed",
					incidentId: "inc-101",
				},
			];
			expect(newlyFinished(previous, current)).toEqual([
				{
					id: "inv-2",
					summary: "Database connection timeouts",
					status: "failed",
					incidentId: "inc-101",
				},
			]);
		});

		it("does not announce pending -> running transition", () => {
			const previous = new Map<string, InvestigationStatus>([
				["inv-3", "pending"],
			]);
			const current: InvestigationSummary[] = [
				{
					id: "inv-3",
					summary: "Queue worker backlog",
					status: "running",
				},
			];
			expect(newlyFinished(previous, current)).toEqual([]);
		});

		it("does not announce an investigation first seen already completed", () => {
			const previous = new Map<string, InvestigationStatus>();
			const current: InvestigationSummary[] = [
				{
					id: "inv-4a",
					summary: "Historical completed investigation",
					status: "completed",
				},
				{
					id: "inv-4b",
					summary: "Historical failed investigation",
					status: "failed",
				},
			];
			expect(newlyFinished(previous, current)).toEqual([]);
		});

		it("does not announce completed -> completed transition", () => {
			const previous = new Map<string, InvestigationStatus>([
				["inv-5a", "completed"],
				["inv-5b", "failed"],
			]);
			const current: InvestigationSummary[] = [
				{
					id: "inv-5a",
					summary: "Already completed",
					status: "completed",
				},
				{
					id: "inv-5b",
					summary: "Already failed",
					status: "failed",
				},
			];
			expect(newlyFinished(previous, current)).toEqual([]);
		});

		it("never announces cancelled investigations", () => {
			const fromRunning = new Map<string, InvestigationStatus>([
				["inv-6a", "running"],
			]);
			const currentRunningToCancelled: InvestigationSummary[] = [
				{
					id: "inv-6a",
					summary: "Cancelled after running",
					status: "cancelled",
				},
			];
			expect(newlyFinished(fromRunning, currentRunningToCancelled)).toEqual([]);

			const fromPending = new Map<string, InvestigationStatus>([
				["inv-6b", "pending"],
			]);
			const currentPendingToCancelled: InvestigationSummary[] = [
				{
					id: "inv-6b",
					summary: "Cancelled while pending",
					status: "cancelled",
				},
			];
			expect(newlyFinished(fromPending, currentPendingToCancelled)).toEqual([]);

			const firstSeenCancelled: InvestigationSummary[] = [
				{
					id: "inv-6c",
					summary: "First seen cancelled",
					status: "cancelled",
				},
			];
			expect(newlyFinished(new Map(), firstSeenCancelled)).toEqual([]);
		});

		it("ignores a finished investigation dropped from the list", () => {
			const previous = new Map<string, InvestigationStatus>([
				["inv-7a", "running"],
				["inv-7b", "completed"],
			]);
			const current: InvestigationSummary[] = [];
			expect(newlyFinished(previous, current)).toEqual([]);
		});

		it("returns id, summary, status, and incidentId", () => {
			const previous = new Map<string, InvestigationStatus>([
				["inv-with-inc", "running"],
				["inv-without-inc", "running"],
			]);
			const current: InvestigationSummary[] = [
				{
					id: "inv-with-inc",
					summary: "With Incident",
					status: "completed",
					incidentId: "inc-999",
				},
				{
					id: "inv-without-inc",
					summary: "Without Incident",
					status: "failed",
				},
			];
			expect(newlyFinished(previous, current)).toEqual([
				{
					id: "inv-with-inc",
					summary: "With Incident",
					status: "completed",
					incidentId: "inc-999",
				},
				{
					id: "inv-without-inc",
					summary: "Without Incident",
					status: "failed",
					incidentId: undefined,
				},
			]);
		});
	});

	describe("snapshot", () => {
		it("builds the map of investigation ids to statuses", () => {
			const current: InvestigationSummary[] = [
				{ id: "inv-1", summary: "One", status: "running" },
				{ id: "inv-2", summary: "Two", status: "completed" },
				{ id: "inv-3", summary: "Three", status: "pending" },
			];
			const map = snapshot(current);
			expect(map).toBeInstanceOf(Map);
			expect(map.size).toBe(3);
			expect(map.get("inv-1")).toBe("running");
			expect(map.get("inv-2")).toBe("completed");
			expect(map.get("inv-3")).toBe("pending");
		});
	});

	describe("notificationText", () => {
		it("picks 'Investigation finished' with the summary as body for completed status", () => {
			const inv: FinishedInvestigation = {
				id: "inv-1",
				summary: "High CPU usage across nodes",
				status: "completed",
			};
			expect(notificationText(inv)).toEqual({
				title: "Investigation finished",
				body: "High CPU usage across nodes",
			});
		});

		it("picks 'Investigation failed' with the summary as body for failed status", () => {
			const inv: FinishedInvestigation = {
				id: "inv-2",
				summary: "OOM killer invoked on cluster",
				status: "failed",
			};
			expect(notificationText(inv)).toEqual({
				title: "Investigation failed",
				body: "OOM killer invoked on cluster",
			});
		});

		it("an investigation with no summary yet gets an empty body", () => {
			const inv: FinishedInvestigation = {
				id: "inv-3",
				summary: null,
				status: "failed",
			};
			expect(notificationText(inv)).toEqual({
				title: "Investigation failed",
				body: "",
			});
		});
	});
});
