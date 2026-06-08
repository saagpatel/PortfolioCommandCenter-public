import { useEffect, useState } from "react";
import {
	approveProposal,
	executeProposals,
	executeProposalsStatus,
	rejectProposal,
} from "../api";
import type { AutomationProposal, RunStatus } from "../types";

/**
 * Bounded-automation proposal triage (Arc D's durable queue, surfaced on the
 * desktop). The operator approves/rejects pending proposals (metadata-only, no
 * repo is touched), dry-runs the gated executor to preview an `--apply`, and —
 * behind an explicit confirmation — runs the real `--apply` that opens context
 * PRs and writes catalog seeds. Execution is spawned and polled (a fresh
 * workspace+Notion snapshot precedes it when proposals are approved, so it can
 * take minutes and must not block the UI). Every state transition is driven
 * through the auditor CLI, so the Arc D approval gate + git/gh rails remain the
 * single source of truth.
 */

// Pending first (the actionable rows), then approved/executed, rejected last.
const STATUS_ORDER: Record<string, number> = {
	pending: 0,
	approved: 1,
	executed: 2,
	rejected: 3,
};

interface Props {
	proposals: AutomationProposal[];
	outputDir: string;
	/** Re-fetch the queue after a mutation so the table reflects the new state. */
	onChanged: () => void;
}

export function Automation({ proposals, outputDir, onChanged }: Props) {
	const [busyId, setBusyId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [exec, setExec] = useState<RunStatus | null>(null);
	const [execErr, setExecErr] = useState<string | null>(null);
	const [confirmApply, setConfirmApply] = useState(false);
	// True only during the spawn IPC round-trip — disables the execute buttons so a
	// double-click can't fire a second run before `exec` reflects the live one. We
	// set `exec` *after* the await (not optimistically) so the poll never observes
	// a run that hasn't spawned yet; `starting` covers the gap in between.
	const [starting, setStarting] = useState(false);

	const dir = outputDir.trim() || null;
	const pendingCount = proposals.filter((p) => p.status === "pending").length;
	const approvedCount = proposals.filter((p) => p.status === "approved").length;
	const execActive = (exec?.running ?? false) || starting;

	const sorted = [...proposals].sort(
		(a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
	);

	async function mutate(id: string, fn: () => Promise<string>) {
		setBusyId(id);
		setActionError(null);
		try {
			await fn();
			onChanged();
		} catch (e) {
			setActionError(String(e));
		} finally {
			setBusyId(null);
		}
	}

	// Spawn the executor (dry-run or apply), then let the poll effect take over.
	async function startExec(apply: boolean) {
		setConfirmApply(false);
		setExecErr(null);
		setStarting(true);
		try {
			await executeProposals(apply, dir);
			setExec({
				running: true,
				mode: apply ? "apply" : "dry-run",
				exit_code: null,
				log_tail: "",
				error: null,
			});
		} catch (e) {
			setExecErr(String(e));
		} finally {
			setStarting(false);
		}
	}

	// While an execution is live, poll its status; on success, reload the queue
	// once (an apply flips approved proposals to executed).
	useEffect(() => {
		if (!exec?.running) return;
		let cancelled = false;
		const id = setInterval(async () => {
			try {
				const status = await executeProposalsStatus();
				if (cancelled) return;
				setExec(status);
				if (!status.running) {
					clearInterval(id);
					if (status.exit_code === 0) onChanged();
				}
			} catch {
				// transient IPC hiccup — keep polling.
			}
		}, 1500);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [exec?.running, onChanged]);

	if (proposals.length === 0) {
		return (
			<div className="panel">
				<h2>Automation</h2>
				<p className="muted">
					No bounded-automation proposals in the queue. Generate them in the
					auditor with{" "}
					<code>
						python -m src.cli report &lt;user&gt; --propose-automation
					</code>{" "}
					— eligible repos (trusted decision quality + high path confidence) get
					a context-PR and catalog-seed proposal you can approve here.
				</p>
			</div>
		);
	}

	return (
		<div className="panel">
			<h2>Automation</h2>
			<p className="stat-row">
				<span>
					Pending: <strong>{pendingCount}</strong>
				</span>
				<span>
					Approved: <strong>{approvedCount}</strong>
				</span>
				<span>
					Total: <strong>{proposals.length}</strong>
				</span>
			</p>
			<p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
				Approve or reject below (metadata only — no repo is touched). Dry-run
				previews what an apply would do; <strong>Apply</strong> opens real PRs
				and writes catalog seeds (it asks for confirmation first).
			</p>

			{actionError && (
				<div className="banner banner--error">
					<strong>Action failed.</strong> {actionError}
				</div>
			)}
			{execErr && (
				<div className="banner banner--error">
					<strong>Couldn't start the executor.</strong> {execErr}
				</div>
			)}

			<div className="drawer__actions" style={{ margin: "0 0 12px" }}>
				<button
					onClick={() => void startExec(false)}
					disabled={execActive || approvedCount === 0}
					title={
						approvedCount === 0
							? "Approve at least one proposal first"
							: "Dry-run the executor over approved proposals (no --apply)"
					}
				>
					{execActive && exec?.mode === "dry-run"
						? "Running dry-run…"
						: "Execute approved (dry-run)"}
				</button>
				<button
					onClick={() => setConfirmApply(true)}
					disabled={execActive || approvedCount === 0}
					title={
						approvedCount === 0
							? "Approve at least one proposal first"
							: "Apply approved proposals — opens PRs / writes catalog seeds"
					}
				>
					{execActive && exec?.mode === "apply"
						? "Applying…"
						: "Apply approved (open PRs)"}
				</button>
			</div>

			{exec && (
				<div
					className={`banner ${
						exec.running
							? "banner--info"
							: exec.exit_code === 0
								? "banner--ok"
								: "banner--error"
					}`}
				>
					<div className="run-banner__head">
						<span>
							{exec.running ? (
								<>
									<span className="spinner" /> Running {exec.mode}…{" "}
									{exec.mode === "apply"
										? "opening PRs and rebuilding the snapshot can take a few minutes."
										: "rebuilding the snapshot to preview what apply would do — can take a few minutes."}
								</>
							) : exec.exit_code === 0 ? (
								<>
									✓ Executor {exec.mode} complete
									{exec.mode === "apply"
										? " — PRs opened / seeds written."
										: "."}
								</>
							) : (
								<>
									✗ Executor {exec.mode} failed (exit {exec.exit_code ?? "?"})
									{exec.error ? `: ${exec.error}` : ""}.
								</>
							)}
						</span>
						{!exec.running && (
							<button
								className="run-banner__dismiss"
								onClick={() => setExec(null)}
							>
								Dismiss
							</button>
						)}
					</div>
					{exec.log_tail && <pre className="run-log">{exec.log_tail}</pre>}
				</div>
			)}

			<table>
				<thead>
					<tr>
						<th>Status</th>
						<th>Action</th>
						<th>Repo</th>
						<th>Description</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{sorted.map((p) => (
						<tr key={p.proposal_id}>
							<td>
								<span className={`pill pill--${p.status}`}>{p.status}</span>
							</td>
							<td>{p.action_type}</td>
							<td>
								{p.display_name}
								{p.repo_full_name && (
									<>
										<br />
										<span className="muted" style={{ fontSize: 11 }}>
											{p.repo_full_name}
										</span>
									</>
								)}
							</td>
							<td>{p.description}</td>
							<td>
								{p.status === "pending" ? (
									<div className="drawer__actions">
										<button
											disabled={busyId === p.proposal_id || execActive}
											onClick={() =>
												void mutate(p.proposal_id, () =>
													approveProposal(p.proposal_id, dir),
												)
											}
										>
											{busyId === p.proposal_id ? "…" : "Approve"}
										</button>
										<button
											disabled={busyId === p.proposal_id || execActive}
											onClick={() =>
												void mutate(p.proposal_id, () =>
													rejectProposal(p.proposal_id, dir),
												)
											}
										>
											Reject
										</button>
									</div>
								) : (
									<span className="muted">—</span>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{confirmApply && (
				<div className="modal-backdrop" onClick={() => setConfirmApply(false)}>
					<div
						className="modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="apply-modal-title"
						onClick={(e) => e.stopPropagation()}
					>
						<h3 id="apply-modal-title" className="modal__title">
							Apply {approvedCount} approved proposal
							{approvedCount === 1 ? "" : "s"}?
						</h3>
						<p className="modal__body">
							This runs the gated executor with <code>--apply</code> — it opens
							real pull requests and writes catalog seeds on GitHub for every
							approved proposal. It acts on live repositories and can't be
							undone from here. Use the dry-run first if you're unsure.
						</p>
						<div className="modal__actions">
							<button onClick={() => setConfirmApply(false)}>Cancel</button>
							<button
								className="btn-danger"
								onClick={() => void startExec(true)}
							>
								Apply {approvedCount} proposal
								{approvedCount === 1 ? "" : "s"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
