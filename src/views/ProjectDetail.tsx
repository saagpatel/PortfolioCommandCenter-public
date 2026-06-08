import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openExternal, repoWebUrl, revealInFinder } from "../api";
import type { PortfolioProject } from "../types";
import { attentionState, openHighCritical } from "../types";

function isBlank(v: unknown): boolean {
	return (
		v === undefined || v === null || (typeof v === "string" && v.trim() === "")
	);
}

/** A label/value row. Renders nothing when the value is blank, so the many
 *  empty catalog-contract fields don't litter the panel with dashes. */
function Field({ label, value }: { label: string; value: ReactNode }) {
	if (isBlank(value)) return null;
	return (
		<div className="kv">
			<span className="kv__key">{label}</span>
			<span className="kv__val">{value}</span>
		</div>
	);
}

/** A ✓/✗ presence indicator for a boolean doc-section or capability flag.
 *  An absent field (older/sparse snapshot) is "unknown", not "false" — so it
 *  renders nothing rather than a misleading ✗. */
function Check({ label, ok }: { label: string; ok: boolean | undefined }) {
	if (ok === undefined) return null;
	return (
		<span className={`check ${ok ? "check--yes" : "check--no"}`}>
			<span className="check__mark">{ok ? "✓" : "✗"}</span>
			{label}
		</span>
	);
}

function Chips({ items }: { items: string[] | undefined }) {
	if (!items || items.length === 0) return <span className="muted">—</span>;
	return (
		<div className="repo-chips">
			{items.map((it) => (
				<span key={it} className="repo-chip">
					{it}
				</span>
			))}
		</div>
	);
}

function formatTimestamp(iso: string | undefined): string | undefined {
	if (!iso) return undefined;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Right-side slide-over with the full per-project dossier. Closes on ESC,
 *  backdrop click, or the ✕ button. */
export function ProjectDetail({
	project,
	workspaceRoot,
	onClose,
	onPrev,
	onNext,
	position,
}: {
	project: PortfolioProject;
	workspaceRoot: string;
	onClose: () => void;
	/** Step to the previous project; undefined at the top of the list. */
	onPrev?: () => void;
	/** Step to the next project; undefined at the bottom of the list. */
	onNext?: () => void;
	/** 0-based slot of this project within the sorted list, for the counter. */
	position?: { index: number; total: number };
}) {
	// Snapshot paths are relative to workspace_root; resolve to absolute so the
	// launchpad actions (Finder / GitHub / copy) operate on the real directory.
	const relPath = project.identity.path;
	const absPath =
		relPath.startsWith("/") || !workspaceRoot
			? relPath
			: `${workspaceRoot.replace(/\/+$/, "")}/${relPath}`;

	const closeRef = useRef<HTMLButtonElement>(null);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ESC closes the drawer; ←/↑/k step to the previous project and →/↓/j to the
	// next, in place, without leaving it. Stepping wraps around the list ends, so
	// the handlers are live for any multi-item list (undefined only for a
	// single-item list). preventDefault stops the arrow keys from also scrolling
	// the underlying table. The drawer has no text inputs, so the j/k letter
	// bindings can't swallow typing. The listener lives only while mounted.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			const prevKey =
				e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k";
			const nextKey =
				e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j";
			if (prevKey && onPrev) {
				e.preventDefault();
				onPrev();
			} else if (nextKey && onNext) {
				e.preventDefault();
				onNext();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, onPrev, onNext]);

	// Move focus into the drawer on open, restore it to the trigger on close —
	// the dialog content is non-interactive, so focusing the close button is
	// the meaningful keyboard landing spot.
	useEffect(() => {
		const prev = document.activeElement as HTMLElement | null;
		closeRef.current?.focus();
		return () => prev?.focus();
	}, []);

	// Resolve the project's GitHub URL (if any) so the GitHub action can hide
	// itself for non-git / non-GitHub projects. Re-runs when the project changes.
	const [repoUrl, setRepoUrl] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setRepoUrl(null);
		setCopied(false);
		repoWebUrl(absPath)
			.then((u) => {
				if (!cancelled) setRepoUrl(u);
			})
			.catch((err) => {
				// Hidden GitHub button is an acceptable fallback; log the cause so a
				// broken IPC path is distinguishable from a project with no remote.
				// Only fires on a genuine command failure, so it isn't UI noise.
				console.warn("repo_web_url failed", err);
			});
		return () => {
			cancelled = true;
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
		};
	}, [absPath]);

	const copyPath = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(absPath);
			setCopied(true);
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
			copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard unavailable in this context — silently skip.
		}
	}, [absPath]);

	const { identity, declared, derived, risk, security, advisory } = project;
	const hc = openHighCritical(security);
	const factors = risk.risk_factors ?? [];
	const groupLabel = [identity.group_label, identity.section_label]
		.filter((s) => !isBlank(s))
		.join(" · ");
	const hasAdvisory =
		advisory != null && Object.values(advisory).some((v) => !isBlank(v));

	return (
		<div className="drawer-backdrop" onClick={onClose}>
			<aside
				className="drawer"
				role="dialog"
				aria-modal="true"
				aria-label={`${identity.display_name} detail`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="drawer__head">
					<div>
						<h2 className="drawer__title">{identity.display_name}</h2>
						<div className="muted drawer__path">{absPath}</div>
						{groupLabel && <div className="muted">{groupLabel}</div>}
					</div>
					<div className="drawer__nav">
						<button
							className="drawer__navbtn"
							onClick={onPrev}
							disabled={!onPrev}
							aria-label="Previous project"
							title="Previous project (← ↑ k)"
						>
							‹
						</button>
						{position && position.index >= 0 && (
							<span className="drawer__pos muted">
								{position.index + 1} / {position.total}
							</span>
						)}
						<button
							className="drawer__navbtn"
							onClick={onNext}
							disabled={!onNext}
							aria-label="Next project"
							title="Next project (→ ↓ j)"
						>
							›
						</button>
						<button
							ref={closeRef}
							className="drawer__close"
							onClick={onClose}
							aria-label="Close detail"
						>
							✕
						</button>
					</div>
				</div>

				<div className="drawer__tier">
					<span className={`pill pill--${risk.risk_tier}`}>
						{risk.risk_tier}
					</span>
					{hc > 0 && (
						<span className="pill pill--critical">{hc} high/crit</span>
					)}
				</div>

				<div className="drawer__actions">
					<button onClick={() => void revealInFinder(absPath)}>Finder</button>
					{repoUrl && (
						<button onClick={() => void openExternal(repoUrl)}>GitHub</button>
					)}
					<button onClick={() => void copyPath()}>
						{copied ? "Copied ✓" : "Copy path"}
					</button>
				</div>

				<section className="drawer__section">
					<h3>Risk</h3>
					<p className="drawer__summary">{risk.risk_summary}</p>
					{factors.length > 0 && (
						<div className="factor-chips">
							{factors.map((f) => (
								<span key={f} className="factor-chip">
									{f}
								</span>
							))}
						</div>
					)}
					<div className="check-row">
						<Check label="doctor gap" ok={risk.doctor_gap} />
						<Check label="context risk" ok={risk.context_risk} />
						<Check label="path risk" ok={risk.path_risk} />
						<Check label="security risk" ok={risk.security_risk} />
					</div>
				</section>

				<section className="drawer__section">
					<h3>Context quality</h3>
					<Field label="Quality" value={derived.context_quality} />
					<Field label="Primary file" value={derived.primary_context_file} />
					<Field
						label="README size"
						value={
							derived.readme_char_count != null
								? `${derived.readme_char_count.toLocaleString()} chars`
								: undefined
						}
					/>
					<Field
						label="Context files"
						value={
							derived.context_files && derived.context_files.length > 0 ? (
								<Chips items={derived.context_files} />
							) : undefined
						}
					/>
					<div className="check-row">
						<Check label="summary" ok={derived.project_summary_present} />
						<Check label="current state" ok={derived.current_state_present} />
						<Check label="stack" ok={derived.stack_present} />
						<Check label="run steps" ok={derived.run_instructions_present} />
						<Check label="known risks" ok={derived.known_risks_present} />
						<Check
							label="next move"
							ok={derived.next_recommended_move_present}
						/>
					</div>
					<div className="check-row">
						<Check label="tests" ok={derived.has_tests} />
						<Check label="CI" ok={derived.has_ci} />
						<Check label="license" ok={derived.has_license} />
					</div>
				</section>

				<section className="drawer__section">
					<h3>Activity</h3>
					<Field label="Attention state" value={attentionState(project)} />
					<Field label="Registry status" value={derived.registry_status} />
					<Field label="Activity status" value={derived.activity_status} />
					<Field
						label="Last activity"
						value={formatTimestamp(derived.last_meaningful_activity_at)}
					/>
					<Field
						label="Releases"
						value={
							derived.release_count != null ? derived.release_count : undefined
						}
					/>
				</section>

				<section className="drawer__section">
					<h3>Path</h3>
					<Field label="Operating path" value={declared.operating_path} />
					<Field label="Override" value={derived.path_override} />
					<Field label="Confidence" value={derived.path_confidence} />
					<Field label="Rationale" value={derived.path_rationale} />
				</section>

				<section className="drawer__section">
					<h3>Declared contract</h3>
					<Field label="Category" value={declared.category} />
					<Field label="Tool" value={declared.tool_provenance} />
					<Field label="Purpose" value={declared.purpose} />
					<Field label="Lifecycle" value={declared.lifecycle_state} />
					<Field label="Maturity program" value={declared.maturity_program} />
					<Field label="Target maturity" value={declared.target_maturity} />
					<Field label="Criticality" value={declared.criticality} />
					<Field label="Owner" value={declared.owner} />
					<Field label="Team" value={declared.team} />
					<Field label="Disposition" value={declared.intended_disposition} />
					<Field label="Review cadence" value={declared.review_cadence} />
					<Field
						label="Automation eligible"
						value={declared.automation_eligible ? "yes" : undefined}
					/>
					<Field label="Notes" value={declared.notes} />
				</section>

				<section className="drawer__section">
					<h3>Stack</h3>
					<Chips items={derived.stack} />
				</section>

				<section className="drawer__section">
					<h3>Security</h3>
					{security && security.alerts_available ? (
						<>
							<Field
								label="Dependabot critical"
								value={security.dependabot_critical}
							/>
							<Field label="Dependabot high" value={security.dependabot_high} />
							<Field
								label="Dependabot medium"
								value={security.dependabot_medium}
							/>
							<Field label="Dependabot low" value={security.dependabot_low} />
							<Field
								label="Code scanning critical"
								value={security.code_scanning_critical}
							/>
							<Field
								label="Code scanning high"
								value={security.code_scanning_high}
							/>
							<Field
								label="Secret scanning open"
								value={security.secret_scanning_open}
							/>
						</>
					) : (
						<p className="muted">
							No alert data in this snapshot. Run a full re-audit (with GHAS) to
							populate Dependabot, code-scanning, and secret-scanning counts.
						</p>
					)}
				</section>

				{hasAdvisory && (
					<section className="drawer__section">
						<h3>Advisory / legacy</h3>
						<Field
							label="Notion call"
							value={advisory?.notion_portfolio_call}
						/>
						<Field label="Notion momentum" value={advisory?.notion_momentum} />
						<Field
							label="Notion state"
							value={advisory?.notion_current_state}
						/>
						<Field label="Legacy status" value={advisory?.legacy_status} />
						<Field
							label="Legacy context"
							value={advisory?.legacy_context_quality}
						/>
						<Field label="Legacy category" value={advisory?.legacy_category} />
						<Field
							label="Legacy tool"
							value={advisory?.legacy_tool_provenance}
						/>
					</section>
				)}
			</aside>
		</div>
	);
}
