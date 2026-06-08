import { invoke } from "@tauri-apps/api/core";
import type {
	HistoryPoint,
	PortfolioTruthSnapshot,
	ProposalsFile,
	RunMode,
	RunStatus,
	SecurityBurndown,
	WeeklyDigest,
} from "./types";

/** Optional override of the auditor output directory; null → Rust default. */
function args(outputDir: string | null): Record<string, unknown> {
	return outputDir && outputDir.trim() ? { outputDir: outputDir.trim() } : {};
}

export async function loadPortfolioTruth(
	outputDir: string | null = null,
): Promise<PortfolioTruthSnapshot> {
	return invoke<PortfolioTruthSnapshot>(
		"load_portfolio_truth",
		args(outputDir),
	);
}

export async function loadWeeklyDigest(
	outputDir: string | null = null,
): Promise<WeeklyDigest> {
	return invoke<WeeklyDigest>("load_weekly_digest", args(outputDir));
}

export async function loadSecurityBurndown(
	outputDir: string | null = null,
): Promise<SecurityBurndown> {
	return invoke<SecurityBurndown>("load_security_burndown", args(outputDir));
}

export async function loadTruthHistory(
	outputDir: string | null = null,
): Promise<HistoryPoint[]> {
	return invoke<HistoryPoint[]>("load_truth_history", args(outputDir));
}

/** Spawn the auditor (fast = truth+security, full = clone+analyze+burndown). */
export async function runAuditor(
	mode: RunMode,
	outputDir: string | null = null,
): Promise<void> {
	return invoke<void>("run_auditor", { mode, ...args(outputDir) });
}

/** Poll the in-flight (or most recent) auditor run. */
export async function auditorStatus(): Promise<RunStatus> {
	return invoke<RunStatus>("auditor_status");
}

// ── Launchpad actions (drill-down drawer) ───────────────────────────────────

/** Open a project's directory in Finder. */
export async function revealInFinder(path: string): Promise<void> {
	return invoke<void>("reveal_in_finder", { path });
}

/** Open an http(s) URL in the default browser. */
export async function openExternal(url: string): Promise<void> {
	return invoke<void>("open_external", { url });
}

/** Resolve a project's GitHub web URL from its `origin` remote, or null. */
export async function repoWebUrl(path: string): Promise<string | null> {
	return invoke<string | null>("repo_web_url", { path });
}

// ── Bounded-automation proposal triage (Arc D queue) ────────────────────────

/** Read the durable proposal queue; a missing file → an empty queue. */
export async function loadAutomationProposals(
	outputDir: string | null = null,
): Promise<ProposalsFile> {
	return invoke<ProposalsFile>("load_automation_proposals", args(outputDir));
}

/** Approve a pending proposal (PENDING → APPROVED). Returns the CLI output. */
export async function approveProposal(
	proposalId: string,
	outputDir: string | null = null,
): Promise<string> {
	return invoke<string>("approve_proposal", { proposalId, ...args(outputDir) });
}

/** Reject a pending proposal (PENDING → REJECTED). Returns the CLI output. */
export async function rejectProposal(
	proposalId: string,
	outputDir: string | null = null,
): Promise<string> {
	return invoke<string>("reject_proposal", { proposalId, ...args(outputDir) });
}

/**
 * Spawn the gated executor over approved proposals. `apply=false` is a dry-run
 * (no PRs, no catalog seeds); `apply=true` opens PRs + writes catalog seeds.
 * Returns immediately — poll `executeProposalsStatus` for progress.
 */
export async function executeProposals(
	apply: boolean,
	outputDir: string | null = null,
): Promise<void> {
	return invoke<void>("execute_proposals", { apply, ...args(outputDir) });
}

/** Poll the in-flight (or most recent) proposal-executor run. */
export async function executeProposalsStatus(): Promise<RunStatus> {
	return invoke<RunStatus>("execute_proposals_status");
}
