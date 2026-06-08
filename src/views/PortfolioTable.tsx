import { useMemo, useState } from "react";
import type { PortfolioProject, RiskTier } from "../types";
import {
	attentionState,
	openHighCritical,
	receivesDefaultAttention,
} from "../types";
import {
	ProjectDrawer,
	rowActivation,
	useProjectDrawer,
} from "./projectDrawer";

const TIER_RANK: Record<RiskTier, number> = {
	elevated: 0,
	moderate: 1,
	baseline: 2,
	deferred: 3,
};

type SortKey =
	| "name"
	| "risk"
	| "attention"
	| "context"
	| "status"
	| "tool"
	| "security";
type SortDir = "asc" | "desc";

function distinct(values: string[]): string[] {
	return Array.from(new Set(values)).sort();
}

function projectValue(p: PortfolioProject, key: SortKey): string | number {
	switch (key) {
		case "name":
			return p.identity.display_name.toLowerCase();
		case "risk":
			return TIER_RANK[p.risk.risk_tier];
		case "attention":
			return attentionState(p).toLowerCase();
		case "context":
			return p.derived.context_quality.toLowerCase();
		case "status":
			return p.derived.registry_status.toLowerCase();
		case "tool":
			return p.declared.tool_provenance.toLowerCase();
		case "security":
			return openHighCritical(p.security);
	}
}

export function PortfolioTable({
	projects,
	workspaceRoot,
}: {
	projects: PortfolioProject[];
	workspaceRoot: string;
}) {
	const [search, setSearch] = useState("");
	const [filterAttention, setFilterAttention] = useState("all");
	const [filterStatus, setFilterStatus] = useState("all");
	const [filterTier, setFilterTier] = useState("all");
	const [filterTool, setFilterTool] = useState("all");
	const [filterCategory, setFilterCategory] = useState("all");
	const [sortKey, setSortKey] = useState<SortKey>("risk");
	const [sortDir, setSortDir] = useState<SortDir>("asc");
	const drawer = useProjectDrawer();

	const attentionOptions = useMemo(
		() => distinct(projects.map((p) => attentionState(p))),
		[projects],
	);
	const statusOptions = useMemo(
		() => distinct(projects.map((p) => p.derived.registry_status)),
		[projects],
	);
	const tierOptions = useMemo(
		() => distinct(projects.map((p) => p.risk.risk_tier)),
		[projects],
	);
	const toolOptions = useMemo(
		() => distinct(projects.map((p) => p.declared.tool_provenance)),
		[projects],
	);
	const categoryOptions = useMemo(
		() => distinct(projects.map((p) => p.declared.category)),
		[projects],
	);

	const filtered = useMemo(() => {
		const q = search.toLowerCase();
		return projects.filter((p) => {
			if (q && !p.identity.display_name.toLowerCase().includes(q)) return false;
			if (filterAttention !== "all" && attentionState(p) !== filterAttention)
				return false;
			if (filterStatus !== "all" && p.derived.registry_status !== filterStatus)
				return false;
			if (filterTier !== "all" && p.risk.risk_tier !== filterTier) return false;
			if (filterTool !== "all" && p.declared.tool_provenance !== filterTool)
				return false;
			if (filterCategory !== "all" && p.declared.category !== filterCategory)
				return false;
			return true;
		});
	}, [
		projects,
		search,
		filterAttention,
		filterStatus,
		filterTier,
		filterTool,
		filterCategory,
	]);

	const sorted = useMemo(() => {
		return [...filtered].sort((a, b) => {
			const av = projectValue(a, sortKey);
			const bv = projectValue(b, sortKey);
			let cmp = 0;
			if (typeof av === "number" && typeof bv === "number") {
				cmp = av - bv;
			} else {
				cmp = String(av).localeCompare(String(bv));
			}
			// Secondary sort by name for stable ordering
			if (cmp === 0) {
				cmp = a.identity.display_name.localeCompare(b.identity.display_name);
			}
			return sortDir === "asc" ? cmp : -cmp;
		});
	}, [filtered, sortKey, sortDir]);

	function handleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDir("asc");
		}
	}

	function sortIndicator(key: SortKey): string {
		if (sortKey !== key) return "";
		return sortDir === "asc" ? " ▲" : " ▼";
	}

	return (
		<div className="panel">
			<h2>Portfolio</h2>
			<div className="filters">
				<input
					type="text"
					placeholder="Filter by name…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<select
					value={filterAttention}
					onChange={(e) => setFilterAttention(e.target.value)}
				>
					<option value="all">All attention</option>
					{attentionOptions.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
				<select
					value={filterStatus}
					onChange={(e) => setFilterStatus(e.target.value)}
				>
					<option value="all">All statuses</option>
					{statusOptions.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
				<select
					value={filterTier}
					onChange={(e) => setFilterTier(e.target.value)}
				>
					<option value="all">All tiers</option>
					{tierOptions.map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
				<select
					value={filterTool}
					onChange={(e) => setFilterTool(e.target.value)}
				>
					<option value="all">All tools</option>
					{toolOptions.map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
				<select
					value={filterCategory}
					onChange={(e) => setFilterCategory(e.target.value)}
				>
					<option value="all">All categories</option>
					{categoryOptions.map((c) => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
			</div>
			<p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
				Showing {sorted.length} of {projects.length} projects
			</p>
			<table>
				<thead>
					<tr>
						<th onClick={() => handleSort("name")}>
							Project{sortIndicator("name")}
						</th>
						<th onClick={() => handleSort("risk")}>
							Risk{sortIndicator("risk")}
						</th>
						<th onClick={() => handleSort("attention")}>
							Attention{sortIndicator("attention")}
						</th>
						<th onClick={() => handleSort("context")}>
							Context{sortIndicator("context")}
						</th>
						<th onClick={() => handleSort("status")}>
							Status{sortIndicator("status")}
						</th>
						<th onClick={() => handleSort("tool")}>
							Tool{sortIndicator("tool")}
						</th>
						<th onClick={() => handleSort("security")}>
							Security{sortIndicator("security")}
						</th>
					</tr>
				</thead>
				<tbody>
					{sorted.map((p) => {
						const hc = openHighCritical(p.security);
						const state = attentionState(p);
						return (
							<tr
								key={p.identity.project_key}
								className={
									drawer.selected?.identity.project_key ===
									p.identity.project_key
										? "row-clickable is-selected"
										: "row-clickable"
								}
								{...rowActivation(() => drawer.open(p, sorted))}
							>
								<td>
									{p.identity.display_name}
									<br />
									<span className="muted" style={{ fontSize: 11 }}>
										{p.identity.path}
									</span>
								</td>
								<td>
									<span className={`pill pill--${p.risk.risk_tier}`}>
										{p.risk.risk_tier}
									</span>
								</td>
								<td>
									{receivesDefaultAttention(p) ? (
										<strong>{state}</strong>
									) : (
										<span className="muted">{state}</span>
									)}
								</td>
								<td>{p.derived.context_quality}</td>
								<td>{p.derived.registry_status}</td>
								<td>{p.declared.tool_provenance}</td>
								<td>
									{hc > 0 ? (
										<strong>{hc} high/crit</strong>
									) : (
										<span className="muted">—</span>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<ProjectDrawer nav={drawer} workspaceRoot={workspaceRoot} />
		</div>
	);
}
