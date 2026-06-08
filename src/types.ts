// Data contract mirroring GithubRepoAuditor portfolio truth schema 0.6.0.
// The Rust commands return the parsed JSON verbatim; these types describe the
// subset the UI consumes. Unknown/extra keys are ignored.

// Fields below the original table subset are marked optional: the drill-down
// surfaces them, but older snapshots (or a user-pointed pre-0.5.0 file) may omit
// them, so the detail view renders every one defensively.

export interface IdentityFields {
	project_key: string;
	display_name: string;
	path: string;
	section_marker: string;
	has_git: boolean;
	top_level_dir?: string;
	group_key?: string;
	group_label?: string;
	section_label?: string;
}

export interface DeclaredFields {
	operating_path: string;
	category: string;
	tool_provenance: string;
	lifecycle_state: string;
	purpose: string;
	owner?: string;
	team?: string;
	criticality?: string;
	review_cadence?: string;
	intended_disposition?: string;
	maturity_program?: string;
	target_maturity?: string;
	notes?: string;
	doctor_standard?: string;
	automation_eligible?: boolean;
}

export interface DerivedFields {
	context_quality: string; // full | standard | minimum-viable | boilerplate | none
	registry_status: string; // active | recent | parked | archived
	attention_state?: string; // active-product | active-infra | decision-needed | manual-only | experiment | parked | archived
	stack: string[];
	context_files?: string[];
	context_file_count?: number;
	primary_context_file?: string;
	project_summary_present?: boolean;
	current_state_present?: boolean;
	stack_present?: boolean;
	run_instructions_present?: boolean;
	known_risks_present?: boolean;
	next_recommended_move_present?: boolean;
	last_meaningful_activity_at?: string;
	activity_status?: string;
	path_override?: string;
	path_confidence?: string;
	path_rationale?: string;
	has_tests?: boolean;
	has_ci?: boolean;
	has_license?: boolean;
	readme_char_count?: number;
	release_count?: number | null;
}

export type RiskTier = "elevated" | "moderate" | "baseline" | "deferred";

export interface RiskFields {
	risk_tier: RiskTier;
	risk_factors: string[];
	risk_summary: string;
	security_risk: boolean;
	doctor_gap?: boolean;
	context_risk?: boolean;
	path_risk?: boolean;
}

export interface SecurityFields {
	alerts_available: boolean;
	dependabot_critical: number;
	dependabot_high: number;
	dependabot_medium: number;
	dependabot_low: number;
	secret_scanning_open: number;
	code_scanning_critical?: number;
	code_scanning_high?: number;
}

// Advisory / legacy reconciliation hints — mostly empty on fresh catalogs.
export interface AdvisoryFields {
	notion_portfolio_call?: string;
	notion_momentum?: string;
	notion_current_state?: string;
	legacy_status?: string;
	legacy_context_quality?: string;
	legacy_category?: string;
	legacy_tool_provenance?: string;
}

export interface PortfolioProject {
	identity: IdentityFields;
	declared: DeclaredFields;
	derived: DerivedFields;
	risk: RiskFields;
	// Optional: pre-0.5.0 truth snapshots (generated without
	// --portfolio-truth-include-security) omit this section entirely.
	security?: SecurityFields;
	advisory?: AdvisoryFields;
}

export const DEFAULT_ATTENTION_STATES = new Set([
	"active-product",
	"active-infra",
	"decision-needed",
]);

export function attentionState(project: PortfolioProject): string {
	return project.derived.attention_state?.trim() || "unspecified";
}

export function receivesDefaultAttention(project: PortfolioProject): boolean {
	return DEFAULT_ATTENTION_STATES.has(attentionState(project));
}

export interface PortfolioTruthSnapshot {
	schema_version: string;
	generated_at: string;
	workspace_root: string;
	projects: PortfolioProject[];
}

// ── Weekly command-center digest ────────────────────────────────────────────

export interface RiskPosture {
	elevated_count: number;
	risk_tier_counts: Record<string, number>;
	top_elevated: { repo: string; risk_tier: string; risk_summary: string }[];
}

export interface SecurityPosture {
	scanned_count: number;
	repos_with_open_high_critical: number;
	total_open_critical: number;
	total_open_high: number;
	top_alerts: {
		repo: string;
		risk_tier: string;
		dependabot_critical: number;
		dependabot_high: number;
	}[];
}

export interface PathAttentionItem {
	repo: string;
	headline: string;
	registry_status: string;
	context_quality: string;
}

export interface WeeklyDigest {
	username: string;
	generated_at: string;
	headline: string;
	decision: string;
	why_this_week: string;
	next_step: string;
	risk_posture: RiskPosture;
	security_posture: SecurityPosture;
	path_attention: PathAttentionItem[];
}

// ── Security burndown (advisory-grouped fix list) ───────────────────────────
// Mirrors GithubRepoAuditor's BurndownReport.to_dict() (security-burndown-*.json).

export interface BurndownEntry {
	package: string;
	ecosystem: string;
	severity: "critical" | "high";
	ghsa_id: string | null;
	first_patched_version: string;
	affected_repos: string[];
	affected_repo_count: number;
}

export interface SecurityBurndown {
	distinct_advisories: number;
	total_repo_instances: number;
	repos_touched: number;
	entries: BurndownEntry[];
}

// ── Snapshot history (trend series) ─────────────────────────────────────────
// Mirrors the Rust HistoryPoint emitted by the load_truth_history command — one
// compact summary per timestamped portfolio-truth snapshot.

export interface HistoryPoint {
	generated_at: string;
	schema_version: string;
	elevated: number;
	moderate: number;
	baseline: number;
	deferred: number;
	total: number;
	repos_open_high_crit: number;
	total_high_crit: number;
	has_security: boolean;
}

// ── Auditor run status ──────────────────────────────────────────────────────
// Mirrors the Rust RunStatus from the run_auditor/auditor_status producer path.

export type RunMode = "fast" | "full";

export interface RunStatus {
	running: boolean;
	mode: string;
	exit_code: number | null;
	log_tail: string;
	error: string | null;
}

// ── Bounded-automation proposals (Arc D queue) ──────────────────────────────
// Mirrors GithubRepoAuditor's AutomationProposal.to_dict() (pending-proposals.json).

export type ProposalStatus = "pending" | "approved" | "rejected" | "executed";

export interface AutomationProposal {
	proposal_id: string;
	action_type: string; // context-pr | catalog-seed
	display_name: string;
	repo_full_name: string;
	description: string;
	status: ProposalStatus;
	created_at: string;
	approved_at?: string | null;
	approved_by?: string | null;
	rejected_at?: string | null;
	executed_at?: string | null;
	execution_ref?: string | null;
}

export interface ProposalsFile {
	contract_version: string;
	proposals: AutomationProposal[];
}

// ── Derived helpers ─────────────────────────────────────────────────────────

/** Dependabot high + critical — the security-risk surface (mirrors the auditor). */
export function openHighCritical(s: SecurityFields | undefined): number {
	if (!s || !s.alerts_available) return 0;
	return (s.dependabot_high ?? 0) + (s.dependabot_critical ?? 0);
}
