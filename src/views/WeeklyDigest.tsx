import { useMemo } from "react";
import type { PortfolioProject, WeeklyDigest } from "../types";
import {
	ProjectDrawer,
	rowActivation,
	useProjectDrawer,
} from "./projectDrawer";

export function WeeklyDigestView({
	digest,
	projects,
	workspaceRoot,
}: {
	digest: WeeklyDigest | null;
	projects: PortfolioProject[];
	workspaceRoot: string;
}) {
	const drawer = useProjectDrawer();

	// Digest rows key by a bare `repo` string. Resolve one to a full project by
	// trying project_key (the authoritative match in the verified data) then
	// display_name. The two namespaces are kept separate so a display_name can
	// never be shadowed by a *different* project's project_key. Roughly a third
	// of digest repos resolve to nothing — transient/branch-named entries
	// filtered out of the snapshot, or projects added/removed since the digest
	// was generated — and those rows stay non-interactive (no dead-end clicks).
	const resolve = useMemo(() => {
		const byKey = new Map<string, PortfolioProject>();
		const byName = new Map<string, PortfolioProject>();
		for (const p of projects) {
			if (p.identity.project_key) byKey.set(p.identity.project_key, p);
			if (p.identity.display_name) byName.set(p.identity.display_name, p);
		}
		return (repo: string) => byKey.get(repo) ?? byName.get(repo);
	}, [projects]);

	if (digest === null) {
		return (
			<div className="panel">
				<p className="muted">
					No weekly digest found. Run the weekly command center in the auditor.
				</p>
			</div>
		);
	}

	const pathAttention = digest.path_attention ?? [];
	const topElevated = digest.risk_posture?.top_elevated ?? [];
	const topAlerts = digest.security_posture?.top_alerts ?? [];

	// The drillable subset of a digest table, in table order — the list ←/→
	// steps through (unresolved rows are skipped, so navigation never lands on a
	// row that can't open).
	const resolveList = (items: { repo: string }[]) =>
		items
			.map((i) => resolve(i.repo))
			.filter((p): p is PortfolioProject => p !== undefined);

	// Props for a digest row's <tr>: clickable + highlightable when the repo
	// resolves to a project, empty (plain, non-interactive) when it doesn't.
	const rowProps = (repo: string, items: { repo: string }[]) => {
		const proj = resolve(repo);
		if (!proj) return {};
		return {
			className:
				drawer.selected?.identity.project_key === proj.identity.project_key
					? "row-clickable is-selected"
					: "row-clickable",
			...rowActivation(() => drawer.open(proj, resolveList(items))),
		};
	};

	return (
		<>
			{/* ── Header ──────────────────────────────────────────────────────────── */}
			<div className="panel">
				<h2>{digest.headline}</h2>
				<table>
					<tbody>
						<tr>
							<td style={{ width: 140 }}>
								<span className="muted">Decision</span>
							</td>
							<td>{digest.decision}</td>
						</tr>
						<tr>
							<td>
								<span className="muted">Why this week</span>
							</td>
							<td>{digest.why_this_week}</td>
						</tr>
						<tr>
							<td>
								<span className="muted">Next step</span>
							</td>
							<td>{digest.next_step}</td>
						</tr>
					</tbody>
				</table>
			</div>

			{/* ── Path Attention ──────────────────────────────────────────────────── */}
			<div className="panel">
				<h2>Path Attention</h2>
				{pathAttention.length === 0 ? (
					<p className="muted">No path clarifications surfaced.</p>
				) : (
					<table>
						<thead>
							<tr>
								<th>Repo</th>
								<th>Headline</th>
								<th>Status / Context</th>
							</tr>
						</thead>
						<tbody>
							{pathAttention.map((item, i) => (
								<tr
									key={`${item.repo}-${i}`}
									{...rowProps(item.repo, pathAttention)}
								>
									<td>{item.repo}</td>
									<td>{item.headline}</td>
									<td className="muted" style={{ fontSize: 12 }}>
										{item.registry_status} / {item.context_quality}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* ── Risk ────────────────────────────────────────────────────────────── */}
			<div className="panel">
				<h2>Risk</h2>
				<p style={{ fontSize: 13, margin: "0 0 12px" }}>
					<strong>{digest.risk_posture?.elevated_count ?? 0}</strong> elevated
				</p>
				{topElevated.length === 0 ? (
					<p className="muted">No elevated repos surfaced in digest.</p>
				) : (
					<table>
						<thead>
							<tr>
								<th>Repo</th>
								<th>Tier</th>
								<th>Summary</th>
							</tr>
						</thead>
						<tbody>
							{topElevated.map((item, i) => (
								<tr
									key={`${item.repo}-${i}`}
									{...rowProps(item.repo, topElevated)}
								>
									<td>{item.repo}</td>
									<td>
										<span className={`pill pill--${item.risk_tier}`}>
											{item.risk_tier}
										</span>
									</td>
									<td>{item.risk_summary}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* ── Security ────────────────────────────────────────────────────────── */}
			<div className="panel">
				<h2>Security</h2>
				<p style={{ fontSize: 13, margin: "0 0 12px" }}>
					<span style={{ marginRight: 16 }}>
						Scanned:{" "}
						<strong>{digest.security_posture?.scanned_count ?? 0}</strong>
					</span>
					<span style={{ marginRight: 16 }}>
						With open high/crit:{" "}
						<strong>
							{digest.security_posture?.repos_with_open_high_critical ?? 0}
						</strong>
					</span>
					<span style={{ marginRight: 16 }}>
						Total critical:{" "}
						<strong>{digest.security_posture?.total_open_critical ?? 0}</strong>
					</span>
					<span>
						Total high:{" "}
						<strong>{digest.security_posture?.total_open_high ?? 0}</strong>
					</span>
				</p>
				{topAlerts.length === 0 ? (
					<p className="muted">No security alerts surfaced in digest.</p>
				) : (
					<table>
						<thead>
							<tr>
								<th>Repo</th>
								<th>Tier</th>
								<th>Critical</th>
								<th>High</th>
							</tr>
						</thead>
						<tbody>
							{topAlerts.map((item, i) => (
								<tr
									key={`${item.repo}-${i}`}
									{...rowProps(item.repo, topAlerts)}
								>
									<td>{item.repo}</td>
									<td>
										<span className={`pill pill--${item.risk_tier}`}>
											{item.risk_tier}
										</span>
									</td>
									<td>{item.dependabot_critical ?? 0}</td>
									<td>{item.dependabot_high ?? 0}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<ProjectDrawer nav={drawer} workspaceRoot={workspaceRoot} />
		</>
	);
}
