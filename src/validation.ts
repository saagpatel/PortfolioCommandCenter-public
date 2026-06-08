// Runtime validation + freshness for the portfolio-truth snapshot (F6 + F10).
//
// The Rust side returns the parsed JSON verbatim with no schema enforcement, and
// TypeScript types are erased at runtime — so a malformed, stale, or
// version-skewed truth file would otherwise render as silently-wrong UI rather
// than surfacing the problem. These pure helpers give the app a loud-but-
// non-fatal signal: the snapshot still renders, but the operator is told when it
// is stale or shaped unexpectedly.
//
// Schema policy (F4): gate on `>=` a minimum, never `==`. Additive minor/patch
// bumps from the producer are safe; a major bump or a below-minimum version is a
// real compatibility break worth flagging.

import type { PortfolioTruthSnapshot, RiskTier } from "./types";

export const AGING_HOURS = 48; // amber beyond this
export const STALE_HOURS = 24 * 7; // red beyond a week

export const EXPECTED_SCHEMA_MAJOR = 0;
export const MIN_SCHEMA_VERSION = "0.5.0";

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

const KNOWN_RISK_TIERS: ReadonlySet<RiskTier> = new Set<RiskTier>([
	"elevated",
	"moderate",
	"baseline",
	"deferred",
]);

/** Hours between `generated_at` and `now`, or null if missing/unparseable. */
export function snapshotAgeHours(
	generatedAt: string | undefined | null,
	now: Date,
): number | null {
	if (!generatedAt) return null;
	const then = Date.parse(generatedAt);
	if (Number.isNaN(then)) return null;
	return (now.getTime() - then) / 3_600_000;
}

/** Map an age in hours to a freshness band (null age → "unknown"). */
export function freshnessLevel(ageHours: number | null): Freshness {
	if (ageHours === null) return "unknown";
	if (ageHours <= AGING_HOURS) return "fresh";
	if (ageHours <= STALE_HOURS) return "aging";
	return "stale";
}

/** Compact human label for an age in hours: "12h", "3d", or "unknown". */
export function formatAge(ageHours: number | null): string {
	if (ageHours === null) return "unknown";
	if (ageHours < AGING_HOURS) return `${Math.round(ageHours)}h`;
	return `${Math.round(ageHours / 24)}d`;
}

/** Parse "0.5.0" → [0,5,0]; non-numeric segments become 0; missing → null. */
function parseVersion(
	v: string | undefined | null,
): [number, number, number] | null {
	if (!v) return null;
	const parts = v.split(".").map((p) => Number.parseInt(p, 10));
	if (parts.length === 0 || Number.isNaN(parts[0])) return null;
	return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function cmpVersion(
	a: [number, number, number],
	b: [number, number, number],
): number {
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return 0;
}

/**
 * Structural + version validation. Returns human-readable warning strings;
 * an empty array means the snapshot is well-formed and version-compatible.
 * Never throws — a malformed snapshot yields warnings, not a crash.
 */
export function validateSnapshot(snap: unknown): string[] {
	const warnings: string[] = [];
	if (snap === null || typeof snap !== "object") {
		return ["Snapshot is not an object — the truth file is malformed."];
	}
	const s = snap as Partial<PortfolioTruthSnapshot> & Record<string, unknown>;

	// ── Version gate (F4: >= minimum, flag major skew) ──
	const version = parseVersion(s.schema_version);
	const min = parseVersion(MIN_SCHEMA_VERSION)!;
	if (version === null) {
		warnings.push("Missing schema_version — cannot confirm compatibility.");
	} else if (version[0] !== EXPECTED_SCHEMA_MAJOR) {
		warnings.push(
			`schema_version ${s.schema_version} has a different major than ${MIN_SCHEMA_VERSION} — PCC may render this incorrectly.`,
		);
	} else if (cmpVersion(version, min) < 0) {
		warnings.push(
			`schema_version ${s.schema_version} is below PCC's minimum ${MIN_SCHEMA_VERSION}.`,
		);
	}

	// ── Required top-level fields ──
	if (!s.generated_at)
		warnings.push("Missing generated_at — freshness unknown.");
	if (!Array.isArray(s.projects)) {
		warnings.push("Missing projects array — nothing to render.");
		return warnings; // can't inspect projects further
	}

	// ── Per-project required blocks + risk_tier vocabulary ──
	const REQUIRED_BLOCKS = ["identity", "declared", "derived", "risk"] as const;
	let missingBlockCount = 0;
	const unknownTiers = new Set<string>();
	for (const p of s.projects as unknown[]) {
		if (p === null || typeof p !== "object") {
			missingBlockCount++;
			continue;
		}
		const proj = p as Record<string, unknown>;
		if (REQUIRED_BLOCKS.some((b) => !proj[b] || typeof proj[b] !== "object")) {
			missingBlockCount++;
		}
		const risk = proj.risk as Record<string, unknown> | undefined;
		const tier = risk?.risk_tier;
		if (typeof tier === "string" && !KNOWN_RISK_TIERS.has(tier as RiskTier)) {
			unknownTiers.add(tier);
		}
	}
	if (missingBlockCount > 0) {
		warnings.push(
			`${missingBlockCount} project(s) missing a required block (identity/declared/derived/risk) — the producer schema may have changed.`,
		);
	}
	if (unknownTiers.size > 0) {
		warnings.push(
			`Unknown risk_tier value(s): ${[...unknownTiers].sort().join(", ")} — risk views may misclassify these.`,
		);
	}

	return warnings;
}
