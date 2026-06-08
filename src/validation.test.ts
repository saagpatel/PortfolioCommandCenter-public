import { describe, expect, it } from "vitest";
import type { PortfolioTruthSnapshot } from "./types";
import {
	AGING_HOURS,
	formatAge,
	freshnessLevel,
	STALE_HOURS,
	snapshotAgeHours,
	validateSnapshot,
} from "./validation";

const NOW = new Date("2026-06-07T12:00:00Z");

function validProject(name = "Alpha", tier = "baseline") {
	return {
		identity: {
			project_key: name,
			display_name: name,
			path: `/workspace/projects/${name}`,
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
		derived: { context_quality: "full", registry_status: "active", stack: [] },
		risk: {
			risk_tier: tier,
			risk_factors: [],
			risk_summary: "",
			security_risk: false,
		},
	};
}

function validSnapshot(
	overrides: Partial<PortfolioTruthSnapshot> = {},
): PortfolioTruthSnapshot {
	return {
		schema_version: "0.5.0",
		generated_at: "2026-06-07T00:00:00Z",
		workspace_root: "/workspace/projects",
		projects: [validProject() as never],
		...overrides,
	};
}

describe("snapshotAgeHours", () => {
	it("computes the gap between generated_at and now", () => {
		// 12h before NOW
		expect(snapshotAgeHours("2026-06-07T00:00:00Z", NOW)).toBeCloseTo(12, 5);
	});

	it("returns null for a missing timestamp", () => {
		expect(snapshotAgeHours(undefined, NOW)).toBeNull();
		expect(snapshotAgeHours(null, NOW)).toBeNull();
		expect(snapshotAgeHours("", NOW)).toBeNull();
	});

	it("returns null for an unparseable timestamp", () => {
		expect(snapshotAgeHours("not-a-date", NOW)).toBeNull();
	});
});

describe("freshnessLevel", () => {
	it("is fresh at or under the aging threshold", () => {
		expect(freshnessLevel(0)).toBe("fresh");
		expect(freshnessLevel(AGING_HOURS)).toBe("fresh");
	});

	it("is aging between the aging and stale thresholds", () => {
		expect(freshnessLevel(AGING_HOURS + 1)).toBe("aging");
		expect(freshnessLevel(STALE_HOURS)).toBe("aging");
	});

	it("is stale beyond a week", () => {
		expect(freshnessLevel(STALE_HOURS + 1)).toBe("stale");
	});

	it("is unknown when the age is null", () => {
		expect(freshnessLevel(null)).toBe("unknown");
	});
});

describe("formatAge", () => {
	it("renders sub-threshold ages in hours", () => {
		expect(formatAge(12)).toBe("12h");
	});

	it("renders longer ages in days", () => {
		expect(formatAge(72)).toBe("3d");
	});

	it("renders null as unknown", () => {
		expect(formatAge(null)).toBe("unknown");
	});
});

describe("validateSnapshot", () => {
	it("returns no warnings for a well-formed current snapshot", () => {
		expect(validateSnapshot(validSnapshot())).toEqual([]);
	});

	it("accepts an additive minor bump without a version warning (>= gate, not ==)", () => {
		const warnings = validateSnapshot(
			validSnapshot({ schema_version: "0.6.0" }),
		);
		expect(warnings).toEqual([]);
	});

	it("flags a version below the minimum", () => {
		const warnings = validateSnapshot(
			validSnapshot({ schema_version: "0.4.0" }),
		);
		expect(warnings.some((w) => /below PCC's minimum/.test(w))).toBe(true);
	});

	it("flags a major-version skew", () => {
		const warnings = validateSnapshot(
			validSnapshot({ schema_version: "1.0.0" }),
		);
		expect(warnings.some((w) => /different major/.test(w))).toBe(true);
	});

	it("flags a missing schema_version", () => {
		const warnings = validateSnapshot(
			validSnapshot({ schema_version: undefined as never }),
		);
		expect(warnings.some((w) => /Missing schema_version/.test(w))).toBe(true);
	});

	it("flags a missing generated_at", () => {
		const warnings = validateSnapshot(
			validSnapshot({ generated_at: undefined as never }),
		);
		expect(warnings.some((w) => /Missing generated_at/.test(w))).toBe(true);
	});

	it("flags a missing projects array and stops", () => {
		const warnings = validateSnapshot(
			validSnapshot({ projects: undefined as never }),
		);
		expect(warnings.some((w) => /Missing projects array/.test(w))).toBe(true);
	});

	it("flags a project missing a required block", () => {
		const broken = validSnapshot();
		// drop the risk block from the only project
		delete (broken.projects[0] as unknown as Record<string, unknown>).risk;
		const warnings = validateSnapshot(broken);
		expect(warnings.some((w) => /missing a required block/.test(w))).toBe(true);
	});

	it("flags an unknown risk_tier value", () => {
		const warnings = validateSnapshot(
			validSnapshot({ projects: [validProject("Beta", "critical") as never] }),
		);
		expect(
			warnings.some((w) => /Unknown risk_tier/.test(w) && /critical/.test(w)),
		).toBe(true);
	});

	it("does not throw on a non-object snapshot", () => {
		expect(validateSnapshot(null)).toHaveLength(1);
		expect(validateSnapshot("nope")).toHaveLength(1);
	});

	it("does not warn on a valid empty-but-present projects array", () => {
		// 0 projects is legitimate (filtered workspace) — must not be noise.
		expect(validateSnapshot(validSnapshot({ projects: [] }))).toEqual([]);
	});
});
