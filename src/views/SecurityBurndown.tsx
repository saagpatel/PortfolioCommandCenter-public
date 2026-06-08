import type { SecurityBurndown as Burndown } from "../types";

/**
 * Advisory-grouped remediation list: each row is one advisory whose fix clears
 * N repos at once. Entries arrive pre-ranked from the auditor (critical first,
 * then affected-repo-count descending), so we render them in order.
 */
export function SecurityBurndown({ burndown }: { burndown: Burndown | null }) {
	if (burndown === null) {
		return (
			<div className="panel">
				<h2>Security Burndown</h2>
				<p className="muted">
					No burndown artifact present. Generate one in the auditor with{" "}
					<code>python -m src.cli security-burndown &lt;user&gt;</code> (requires
					a prior <code>--ghas-alerts</code> run that captured per-alert detail).
				</p>
			</div>
		);
	}

	const { entries, distinct_advisories, total_repo_instances, repos_touched } =
		burndown;

	return (
		<div className="panel">
			<h2>Security Burndown</h2>
			<p className="stat-row">
				<span>
					Advisories: <strong>{distinct_advisories}</strong>
				</span>
				<span>
					Repos affected: <strong>{repos_touched}</strong>
				</span>
				<span>
					Total fixes: <strong>{total_repo_instances}</strong>
				</span>
			</p>
			<p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
				Each advisory below is one fix that clears every listed repo —
				runtime-scope, fixable, high/critical only.
			</p>

			{entries.length === 0 ? (
				<p className="muted">
					No runtime, fixable high/critical advisories outstanding. Clear.
				</p>
			) : (
				<table>
					<thead>
						<tr>
							<th>Package</th>
							<th>Severity</th>
							<th>Fix version</th>
							<th>Clears</th>
							<th>Repos</th>
						</tr>
					</thead>
					<tbody>
						{entries.map((e, i) => (
							// Index tiebreaker: two advisories for the same package can
							// both lack a ghsa_id, which would otherwise collide.
							<tr key={`${e.ecosystem}:${e.package}:${e.ghsa_id ?? ""}:${i}`}>
								<td>
									{e.package}
									<br />
									<span className="muted" style={{ fontSize: 11 }}>
										{e.ecosystem}
										{e.ghsa_id ? ` · ${e.ghsa_id}` : ""}
									</span>
								</td>
								<td>
									<span className={`pill pill--${e.severity}`}>
										{e.severity}
									</span>
								</td>
								<td>{e.first_patched_version || "—"}</td>
								<td>
									<strong>{e.affected_repo_count}</strong>{" "}
									<span className="muted">
										repo{e.affected_repo_count === 1 ? "" : "s"}
									</span>
								</td>
								<td>
									<div className="repo-chips">
										{e.affected_repos.map((r) => (
											<span key={r} className="repo-chip">
												{r}
											</span>
										))}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
