import { useMemo } from "react";
import type { PortfolioProject, RiskTier, WeeklyDigest } from "../types";
import { openHighCritical } from "../types";
import {
	ProjectDrawer,
	rowActivation,
	useProjectDrawer,
} from "./projectDrawer";

const TIERS: RiskTier[] = ["elevated", "moderate", "baseline", "deferred"];

export function RiskSecurity({
	projects,
	digest,
	workspaceRoot,
}: {
	projects: PortfolioProject[];
	digest: WeeklyDigest | null;
	workspaceRoot: string;
}) {
	const drawer = useProjectDrawer();
	// ── Risk posture ────────────────────────────────────────────────────────────
	const elevated = useMemo(
		() =>
			projects
				.filter((p) => p.risk.risk_tier === "elevated")
				.sort((a, b) =>
					a.identity.display_name.localeCompare(b.identity.display_name),
				),
		[projects],
	);

	const tierCounts = useMemo(() => {
		const counts: Record<RiskTier, number> = {
			elevated: 0,
			moderate: 0,
			baseline: 0,
			deferred: 0,
		};
		for (const p of projects) counts[p.risk.risk_tier]++;
		return counts;
	}, [projects]);

	// ── Security posture ────────────────────────────────────────────────────────
	const secStats = useMemo(() => {
		let scanned = 0;
		let withOpen = 0;
		let totalCritical = 0;
		let totalHigh = 0;
		for (const p of projects) {
			if (!p.security?.alerts_available) continue;
			scanned++;
			const hc = openHighCritical(p.security);
			if (hc > 0) withOpen++;
			totalCritical += p.security.dependabot_critical ?? 0;
			totalHigh += p.security.dependabot_high ?? 0;
		}
		return { scanned, withOpen, totalCritical, totalHigh };
	}, [projects]);

	const openRepos = useMemo(
		() =>
			projects
				.filter((p) => openHighCritical(p.security) > 0)
				.sort((a, b) => {
					const dc =
						(b.security?.dependabot_critical ?? 0) -
						(a.security?.dependabot_critical ?? 0);
					if (dc !== 0) return dc;
					const dh =
						(b.security?.dependabot_high ?? 0) -
						(a.security?.dependabot_high ?? 0);
					if (dh !== 0) return dh;
					return a.identity.display_name.localeCompare(b.identity.display_name);
				}),
		[projects],
	);

	// Both tables share the highlight rule; the list each row navigates within
	// is supplied at the click site (elevated vs. openRepos).
	const rowClass = (p: PortfolioProject) =>
		drawer.selected?.identity.project_key === p.identity.project_key
			? "row-clickable is-selected"
			: "row-clickable";

	return (
		<>
			{/* ── Risk Posture ────────────────────────────────────────────────────── */}
			<div className="panel">
				<h2>Risk Posture</h2>
				<p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
					{TIERS.map((t) => (
						<span key={t} style={{ marginRight: 12 }}>
							<span className={`pill pill--${t}`}>{t}</span> {tierCounts[t]}
						</span>
					))}
				</p>
				{elevated.length === 0 ? (
					<p className="muted">No elevated-risk repos.</p>
				) : (
					<table>
						<thead>
							<tr>
								<th>Project</th>
								<th>Tier</th>
								<th>Summary</th>
								<th>Factors</th>
							</tr>
						</thead>
						<tbody>
							{elevated.map((p) => (
								<tr
									key={p.identity.project_key}
									className={rowClass(p)}
									{...rowActivation(() => drawer.open(p, elevated))}
								>
									<td>{p.identity.display_name}</td>
									<td>
										<span className={`pill pill--${p.risk.risk_tier}`}>
											{p.risk.risk_tier}
										</span>
									</td>
									<td>{p.risk.risk_summary}</td>
									<td className="muted">
										{p.risk.risk_factors.join(", ") || "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* ── Security Posture ────────────────────────────────────────────────── */}
			<div className="panel">
				<h2>Security Posture</h2>
				{secStats.scanned === 0 ? (
					<p className="muted">
						Security overlay not present in this snapshot (re-run the auditor
						with --portfolio-truth-include-security).
					</p>
				) : (
					<>
						<p style={{ fontSize: 13, margin: "0 0 12px" }}>
							<span style={{ marginRight: 16 }}>
								Scanned: <strong>{secStats.scanned}</strong>
							</span>
							<span style={{ marginRight: 16 }}>
								With open high/crit: <strong>{secStats.withOpen}</strong>
							</span>
							<span style={{ marginRight: 16 }}>
								Total critical: <strong>{secStats.totalCritical}</strong>
							</span>
							<span>
								Total high: <strong>{secStats.totalHigh}</strong>
							</span>
						</p>
						{digest !== null && (
							<p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
								Digest corroboration:{" "}
								{digest.security_posture?.repos_with_open_high_critical ?? 0}{" "}
								repos with open high/critical (weekly digest).
							</p>
						)}
						{secStats.withOpen === 0 ? (
							<p className="muted">
								All {secStats.scanned} scanned repos clear of open
								high/critical.
							</p>
						) : (
							<table>
								<thead>
									<tr>
										<th>Project</th>
										<th>Tier</th>
										<th>Critical</th>
										<th>High</th>
									</tr>
								</thead>
								<tbody>
									{openRepos.map((p) => (
										<tr
											key={p.identity.project_key}
											className={rowClass(p)}
											{...rowActivation(() => drawer.open(p, openRepos))}
										>
											<td>{p.identity.display_name}</td>
											<td>
												<span className={`pill pill--${p.risk.risk_tier}`}>
													{p.risk.risk_tier}
												</span>
											</td>
											<td>{p.security?.dependabot_critical ?? 0}</td>
											<td>{p.security?.dependabot_high ?? 0}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</>
				)}
			</div>

			<ProjectDrawer nav={drawer} workspaceRoot={workspaceRoot} />
		</>
	);
}
