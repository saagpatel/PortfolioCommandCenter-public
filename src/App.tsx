import { useCallback, useEffect, useState } from "react";
import {
	auditorStatus,
	loadAutomationProposals,
	loadPortfolioTruth,
	loadSecurityBurndown,
	loadTruthHistory,
	loadWeeklyDigest,
	runAuditor,
} from "./api";
import type {
	AutomationProposal,
	HistoryPoint,
	PortfolioTruthSnapshot,
	RunMode,
	RunStatus,
	SecurityBurndown,
	WeeklyDigest,
} from "./types";
import {
	formatAge,
	freshnessLevel,
	snapshotAgeHours,
	validateSnapshot,
} from "./validation";
import { Automation } from "./views/Automation";
import { PortfolioTable } from "./views/PortfolioTable";
import { RiskSecurity } from "./views/RiskSecurity";
import { SecurityBurndown as SecurityBurndownView } from "./views/SecurityBurndown";
import { Trends } from "./views/Trends";
import { WeeklyDigestView } from "./views/WeeklyDigest";

type Tab =
	| "portfolio"
	| "risk"
	| "burndown"
	| "trends"
	| "weekly"
	| "automation";

const TABS: { id: Tab; label: string }[] = [
	{ id: "portfolio", label: "Portfolio" },
	{ id: "risk", label: "Risk + Security" },
	{ id: "burndown", label: "Burndown" },
	{ id: "trends", label: "Trends" },
	{ id: "weekly", label: "Weekly Digest" },
	{ id: "automation", label: "Automation" },
];

export function App() {
	const [tab, setTab] = useState<Tab>("portfolio");
	const [outputDir, setOutputDir] = useState<string>("");
	const [snapshot, setSnapshot] = useState<PortfolioTruthSnapshot | null>(null);
	const [digest, setDigest] = useState<WeeklyDigest | null>(null);
	const [burndown, setBurndown] = useState<SecurityBurndown | null>(null);
	const [history, setHistory] = useState<HistoryPoint[] | null>(null);
	const [proposals, setProposals] = useState<AutomationProposal[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [run, setRun] = useState<RunStatus | null>(null);
	const [runErr, setRunErr] = useState<string | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		const dir = outputDir.trim() || null;
		// Invalidate the lazily-loaded history so the Trends tab re-fetches.
		setHistory(null);
		try {
			const snap = await loadPortfolioTruth(dir);
			setSnapshot(snap);
			// Surface (non-fatally) any shape/version drift in the loaded truth.
			setWarnings(validateSnapshot(snap));
			// Digest + burndown are optional — a missing file must not blank the app.
			try {
				setDigest(await loadWeeklyDigest(dir));
			} catch {
				setDigest(null);
			}
			try {
				setBurndown(await loadSecurityBurndown(dir));
			} catch {
				setBurndown(null);
			}
			// Proposal queue is optional too — a missing file is an empty queue.
			try {
				setProposals((await loadAutomationProposals(dir)).proposals);
			} catch {
				setProposals([]);
			}
		} catch (e) {
			setError(String(e));
			setSnapshot(null);
			setWarnings([]);
		} finally {
			setLoading(false);
		}
	}, [outputDir]);

	// Re-fetch only the proposal queue after an approve/reject so the Automation
	// table reflects the new state without reloading the whole portfolio.
	const reloadProposals = useCallback(async () => {
		const dir = outputDir.trim() || null;
		try {
			setProposals((await loadAutomationProposals(dir)).proposals);
		} catch {
			// Keep the last-known queue on a transient IPC error.
		}
	}, [outputDir]);

	useEffect(() => {
		void load();
		// Load once on mount; manual refresh thereafter.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Lazy-load snapshot history the first time the Trends tab is opened — parsing
	// 70+ snapshots is too heavy to do on every mount.
	useEffect(() => {
		if (tab !== "trends" || history !== null || error) return;
		const dir = outputDir.trim() || null;
		loadTruthHistory(dir)
			.then(setHistory)
			.catch(() => setHistory([]));
	}, [tab, history, error, outputDir]);

	// Kick off an auditor run, then let the poll effect take over.
	const startRun = useCallback(
		async (mode: RunMode) => {
			setRunErr(null);
			try {
				await runAuditor(mode, outputDir.trim() || null);
				setRun({
					running: true,
					mode,
					exit_code: null,
					log_tail: "",
					error: null,
				});
			} catch (e) {
				setRunErr(String(e));
			}
		},
		[outputDir],
	);

	// While a run is live, poll its status; on completion, reload the data once.
	useEffect(() => {
		if (!run?.running) return;
		let cancelled = false;
		const id = setInterval(async () => {
			try {
				const status = await auditorStatus();
				if (cancelled) return;
				setRun(status);
				if (!status.running) {
					clearInterval(id);
					if (status.exit_code === 0) void load();
				}
			} catch {
				// transient IPC hiccup — keep polling.
			}
		}, 1500);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [run?.running, load]);

	const projects = snapshot?.projects ?? [];
	const runActive = run?.running ?? false;
	// Freshness of the loaded truth, recomputed each render against wall-clock now.
	const ageHours = snapshot
		? snapshotAgeHours(snapshot.generated_at, new Date())
		: null;
	const freshness = freshnessLevel(ageHours);
	const stale = freshness === "stale";
	const aging = freshness === "aging";

	return (
		<div className="app">
			<header className="app__header">
				<div className="app__title">
					<h1>Portfolio Command Center</h1>
					{snapshot && (
						<span className="app__meta">
							schema {snapshot.schema_version} · {projects.length} projects ·{" "}
							{snapshot.generated_at?.slice(0, 10)}
							{(aging || stale) && (
								<span className={`app__fresh app__fresh--${freshness}`}>
									{" "}
									· {freshness} ({formatAge(ageHours)})
								</span>
							)}
						</span>
					)}
				</div>
				<div className="app__source">
					<input
						type="text"
						placeholder="auditor output dir (default: ~/Projects/GithubRepoAuditor/output)"
						value={outputDir}
						onChange={(e) => setOutputDir(e.target.value)}
						aria-label="Auditor output directory"
					/>
					<button onClick={() => void load()} disabled={loading || runActive}>
						{loading ? "Loading…" : "Reload"}
					</button>
					<button
						onClick={() => void startRun("fast")}
						disabled={runActive}
						title="Regenerate truth + security overlay (~15s)"
					>
						Run auditor
					</button>
					<button
						onClick={() => void startRun("full")}
						disabled={runActive}
						title="Clone + analyze all repos, fetch GHAS, rebuild burndown (~30 min)"
					>
						Full re-audit
					</button>
				</div>
			</header>

			<nav className="app__tabs" role="tablist">
				{TABS.map((t) => (
					<button
						key={t.id}
						role="tab"
						aria-selected={tab === t.id}
						className={tab === t.id ? "tab tab--active" : "tab"}
						onClick={() => setTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</nav>

			<main className="app__main">
				{runErr && (
					<div className="banner banner--error">
						<strong>Couldn't start the auditor.</strong> {runErr}
					</div>
				)}
				{run && (
					<div
						className={`banner ${
							run.running
								? "banner--info"
								: run.exit_code === 0
									? "banner--ok"
									: "banner--error"
						}`}
					>
						<div className="run-banner__head">
							<span>
								{run.running ? (
									<>
										<span className="spinner" /> Running{" "}
										{run.mode === "full" ? "full re-audit" : "auditor refresh"}…
										this{" "}
										{run.mode === "full" ? "can take ~30 min" : "takes ~15s"}.
									</>
								) : run.exit_code === 0 ? (
									<>
										✓{" "}
										{run.mode === "full" ? "Full re-audit" : "Auditor refresh"}{" "}
										complete — data reloaded.
									</>
								) : (
									<>
										✗ Auditor {run.mode} run failed (exit {run.exit_code ?? "?"}
										){run.error ? `: ${run.error}` : ""}.
									</>
								)}
							</span>
							{!run.running && (
								<button
									className="run-banner__dismiss"
									onClick={() => setRun(null)}
								>
									Dismiss
								</button>
							)}
						</div>
						{run.log_tail &&
							(run.mode === "full" ||
								(!run.running && run.exit_code !== 0)) && (
								<pre className="run-log">{run.log_tail}</pre>
							)}
					</div>
				)}
				{error && (
					<div className="banner banner--error">
						<strong>Could not load truth snapshot.</strong> {error}
						<div className="banner__hint">
							Run{" "}
							<code>
								python -m src.cli --portfolio-truth
								--portfolio-truth-include-security &lt;user&gt;
							</code>{" "}
							in the auditor, or point the output dir above at the right folder.
						</div>
					</div>
				)}
				{!error && (aging || stale) && snapshot && (
					<div className={`banner ${stale ? "banner--error" : "banner--warn"}`}>
						<strong>
							{stale ? "Stale portfolio truth." : "Aging portfolio truth."}
						</strong>{" "}
						Generated {formatAge(ageHours)} ago (
						{snapshot.generated_at?.slice(0, 10)}). Run the auditor to refresh.
					</div>
				)}
				{!error && warnings.length > 0 && (
					<div className="banner banner--warn">
						<strong>Truth file shape looks off.</strong>
						<ul className="banner__list">
							{warnings.map((w) => (
								<li key={w}>{w}</li>
							))}
						</ul>
					</div>
				)}
				{!error && tab === "portfolio" && (
					<PortfolioTable
						projects={projects}
						workspaceRoot={snapshot?.workspace_root ?? ""}
					/>
				)}
				{!error && tab === "risk" && (
					<RiskSecurity
						projects={projects}
						digest={digest}
						workspaceRoot={snapshot?.workspace_root ?? ""}
					/>
				)}
				{!error && tab === "burndown" && (
					<SecurityBurndownView burndown={burndown} />
				)}
				{!error && tab === "trends" && <Trends history={history} />}
				{!error && tab === "weekly" && (
					<WeeklyDigestView
						digest={digest}
						projects={projects}
						workspaceRoot={snapshot?.workspace_root ?? ""}
					/>
				)}
				{!error && tab === "automation" && (
					<Automation
						proposals={proposals}
						outputDir={outputDir}
						// Pass the memoized callback directly (not an inline arrow) so its
						// identity is stable — Automation's poll effect depends on it.
						onChanged={reloadProposals}
					/>
				)}
			</main>
		</div>
	);
}
