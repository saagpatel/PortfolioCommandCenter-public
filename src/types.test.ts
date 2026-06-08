import { describe, expect, it } from "vitest";
import {
	attentionState,
	openHighCritical,
	receivesDefaultAttention,
	type PortfolioProject,
	type SecurityFields,
} from "./types";

/** Build a SecurityFields with sensible zero defaults; override what a case needs. */
function security(overrides: Partial<SecurityFields> = {}): SecurityFields {
	return {
		alerts_available: true,
		dependabot_critical: 0,
		dependabot_high: 0,
		dependabot_medium: 0,
		dependabot_low: 0,
		secret_scanning_open: 0,
		...overrides,
	};
}

describe("openHighCritical", () => {
	it("sums dependabot high + critical when alerts are available", () => {
		expect(
			openHighCritical(
				security({ dependabot_high: 3, dependabot_critical: 2 }),
			),
		).toBe(5);
	});

	it("returns 0 when the security section is undefined", () => {
		expect(openHighCritical(undefined)).toBe(0);
	});

	it("returns 0 when alerts are not available, even if counts are present", () => {
		// A repo whose alerts we couldn't read must not contribute a phantom count.
		expect(
			openHighCritical(
				security({
					alerts_available: false,
					dependabot_high: 9,
					dependabot_critical: 9,
				}),
			),
		).toBe(0);
	});

	it("treats a zero high+critical count as zero (not missing)", () => {
		expect(openHighCritical(security())).toBe(0);
	});

	it("counts critical alone when high is zero", () => {
		expect(openHighCritical(security({ dependabot_critical: 4 }))).toBe(4);
	});
});

function project(
	registryStatus: string,
	attention?: string,
): PortfolioProject {
	return {
		identity: {
			project_key: "alpha",
			display_name: "Alpha",
			path: "/workspace/projects/Alpha",
			section_marker: "",
			has_git: true,
		},
		declared: {
			operating_path: "",
			category: "",
			tool_provenance: "",
			lifecycle_state: "",
			purpose: "",
		},
		derived: {
			context_quality: "full",
			registry_status: registryStatus,
			attention_state: attention,
			stack: [],
		},
		risk: {
			risk_tier: "baseline",
			risk_factors: [],
			risk_summary: "",
			security_risk: false,
		},
	};
}

describe("attentionState", () => {
	it("does not treat registry active as default attention by itself", () => {
		const p = project("active");

		expect(attentionState(p)).toBe("unspecified");
		expect(receivesDefaultAttention(p)).toBe(false);
	});

	it("uses explicit decision-needed as default operator attention", () => {
		const p = project("parked", "decision-needed");

		expect(attentionState(p)).toBe("decision-needed");
		expect(receivesDefaultAttention(p)).toBe(true);
	});

	it("keeps manual-only outside default operator attention", () => {
		const p = project("active", "manual-only");

		expect(receivesDefaultAttention(p)).toBe(false);
	});
});
