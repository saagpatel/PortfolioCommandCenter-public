import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioTruthSnapshot } from "./types";

// Mock the entire IPC boundary. App and all child views import from this module
// (resolved to src/api.ts), so one factory covers the whole tree.
vi.mock("./api", () => ({
	loadPortfolioTruth: vi.fn(),
	loadWeeklyDigest: vi.fn(),
	loadSecurityBurndown: vi.fn(),
	loadTruthHistory: vi.fn(),
	runAuditor: vi.fn(),
	auditorStatus: vi.fn(),
	revealInFinder: vi.fn(),
	openExternal: vi.fn(),
	repoWebUrl: vi.fn(),
	loadAutomationProposals: vi.fn(),
	approveProposal: vi.fn(),
	rejectProposal: vi.fn(),
	executeProposals: vi.fn(),
	executeProposalsStatus: vi.fn(),
}));

import { App } from "./App";
import {
	auditorStatus,
	loadAutomationProposals,
	loadPortfolioTruth,
	loadSecurityBurndown,
	loadTruthHistory,
	loadWeeklyDigest,
	runAuditor,
} from "./api";

function snapshot(
	overrides: Partial<PortfolioTruthSnapshot> = {},
): PortfolioTruthSnapshot {
	return {
		schema_version: "0.5.0",
		generated_at: "2026-06-06T00:00:00Z",
		workspace_root: "/workspace/projects",
		projects: [],
		...overrides,
	};
}

function project(
	name: string,
	overrides: {
		registryStatus?: string;
		attentionState?: string;
	} = {},
) {
	return {
		identity: {
			project_key: name,
			display_name: name,
			path: `/workspace/projects/${name}`,
			section_marker: "",
			has_git: true,
		},
		declared: {
			operating_path: "",
			category: "",
			tool_provenance: "",
			lifecycle_state: "",
			purpose: "",
		},
		derived: {
			context_quality: "full",
			registry_status: overrides.registryStatus ?? "active",
			attention_state: overrides.attentionState,
			stack: [],
		},
		risk: {
			risk_tier: "baseline" as const,
			risk_factors: [],
			risk_summary: "",
			security_risk: false,
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(loadPortfolioTruth).mockResolvedValue(snapshot());
	// Optional artifacts default to "missing" — App must degrade gracefully.
	vi.mocked(loadWeeklyDigest).mockRejectedValue("no digest");
	vi.mocked(loadSecurityBurndown).mockRejectedValue("no burndown");
	vi.mocked(loadAutomationProposals).mockResolvedValue({
		contract_version: "automation_proposals_v1",
		proposals: [],
	});
	vi.mocked(loadTruthHistory).mockResolvedValue([]);
	vi.mocked(runAuditor).mockResolvedValue(undefined);
	vi.mocked(auditorStatus).mockResolvedValue({
		running: false,
		mode: "fast",
		exit_code: 0,
		log_tail: "done",
		error: null,
	});
});

describe("App — load orchestration", () => {
	it("renders the portfolio summary after a successful load", async () => {
		vi.mocked(loadPortfolioTruth).mockResolvedValue(
			snapshot({ projects: [project("Alpha"), project("Beta")] }),
		);
		render(<App />);

		// "schema 0.5.0" is unique to the header meta; the project count also
		// appears in the table, so anchor on the header and check its text.
		const meta = await screen.findByText(/schema 0\.5\.0/);
		expect(meta).toHaveTextContent("2 projects");
	});

	it("shows an error banner when the truth snapshot fails to load", async () => {
		vi.mocked(loadPortfolioTruth).mockRejectedValue("boom");
		render(<App />);

		expect(
			await screen.findByText(/Could not load truth snapshot/i),
		).toBeInTheDocument();
	});

	it("degrades gracefully when optional digest/burndown are missing", async () => {
		// Defaults already reject digest + burndown; the portfolio must still render.
		vi.mocked(loadPortfolioTruth).mockResolvedValue(
			snapshot({ projects: [project("Solo")] }),
		);
		render(<App />);

		const meta = await screen.findByText(/schema 0\.5\.0/);
		expect(meta).toHaveTextContent("1 projects");
		expect(
			screen.queryByText(/Could not load truth snapshot/i),
		).not.toBeInTheDocument();
	});

	it("renders attention state separately from registry status", async () => {
		vi.mocked(loadPortfolioTruth).mockResolvedValue(
			snapshot({
				projects: [
					project("InventoryOnly", { registryStatus: "active" }),
					project("NeedsDecision", {
						registryStatus: "parked",
						attentionState: "decision-needed",
					}),
				],
			}),
		);
		render(<App />);

		expect(await screen.findByText("InventoryOnly")).toBeInTheDocument();
		expect(screen.getAllByText("unspecified")).toHaveLength(2);
		expect(screen.getAllByText("decision-needed")).toHaveLength(2);
	});
});

describe("App — navigation", () => {
	it("switches to the Automation tab on click", async () => {
		const user = userEvent.setup();
		render(<App />);
		await screen.findByText(/0 projects/);

		await user.click(screen.getByRole("tab", { name: "Automation" }));

		expect(
			screen.getByRole("heading", { name: "Automation" }),
		).toBeInTheDocument();
	});

	it("lazy-loads snapshot history only when the Trends tab opens", async () => {
		const user = userEvent.setup();
		render(<App />);
		await screen.findByText(/0 projects/);
		expect(loadTruthHistory).not.toHaveBeenCalled();

		await user.click(screen.getByRole("tab", { name: "Trends" }));

		await waitFor(() => expect(loadTruthHistory).toHaveBeenCalledTimes(1));
	});
});

describe("App — reload + auditor run", () => {
	it("re-fetches the snapshot when Reload is clicked", async () => {
		const user = userEvent.setup();
		render(<App />);
		await screen.findByText(/0 projects/);
		expect(loadPortfolioTruth).toHaveBeenCalledTimes(1);

		await user.click(screen.getByRole("button", { name: "Reload" }));

		await waitFor(() => expect(loadPortfolioTruth).toHaveBeenCalledTimes(2));
	});

	it("runs the auditor (fast) and reloads data on successful completion", async () => {
		const user = userEvent.setup();
		render(<App />);
		await screen.findByText(/0 projects/);

		await user.click(screen.getByRole("button", { name: "Run auditor" }));

		expect(runAuditor).toHaveBeenCalledWith("fast", null);
		// Poll loop (1.5s) sees a completed run and triggers exactly one reload.
		await waitFor(() => expect(auditorStatus).toHaveBeenCalled(), {
			timeout: 4000,
		});
		await waitFor(() => expect(loadPortfolioTruth).toHaveBeenCalledTimes(2), {
			timeout: 4000,
		});
	});
});

describe("App — freshness + validation (F6/F10)", () => {
	it("shows a stale banner for an old snapshot", async () => {
		vi.mocked(loadPortfolioTruth).mockResolvedValue(
			snapshot({
				generated_at: "2020-01-01T00:00:00Z",
				projects: [project("Old")],
			}),
		);
		render(<App />);

		expect(
			await screen.findByText(/Stale portfolio truth/i),
		).toBeInTheDocument();
	});

	it("warns when a project carries an unknown risk_tier", async () => {
		const bad = project("Weird");
		(bad.risk as { risk_tier: string }).risk_tier = "critical";
		vi.mocked(loadPortfolioTruth).mockResolvedValue(
			snapshot({ projects: [bad] }),
		);
		render(<App />);

		expect(
			await screen.findByText(/Truth file shape looks off/i),
		).toBeInTheDocument();
		expect(screen.getByText(/Unknown risk_tier/i)).toBeInTheDocument();
	});

	it("shows no shape warning for a clean snapshot", async () => {
		vi.mocked(loadPortfolioTruth).mockResolvedValue(
			snapshot({ projects: [project("OK")] }),
		);
		render(<App />);

		await screen.findByText(/schema 0\.5\.0/);
		expect(
			screen.queryByText(/Truth file shape looks off/i),
		).not.toBeInTheDocument();
	});
});
