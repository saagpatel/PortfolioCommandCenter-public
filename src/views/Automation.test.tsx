import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationProposal } from "../types";
import { Automation } from "./Automation";

// Mock the IPC boundary — these tests verify the component's behavior, not Tauri.
vi.mock("../api", () => ({
	approveProposal: vi.fn(),
	rejectProposal: vi.fn(),
	executeProposals: vi.fn(),
	executeProposalsStatus: vi.fn(),
}));

import {
	approveProposal,
	executeProposals,
	executeProposalsStatus,
	rejectProposal,
} from "../api";

function proposal(
	overrides: Partial<AutomationProposal> = {},
): AutomationProposal {
	return {
		proposal_id: "context-pr:Example",
		action_type: "context-pr",
		display_name: "Example",
		repo_full_name: "owner/example",
		description: "Open a context PR",
		status: "pending",
		created_at: "2026-06-01",
		...overrides,
	};
}

function renderTab(
	proposals: AutomationProposal[],
	onChanged = vi.fn(),
	outputDir = "",
) {
	render(
		<Automation
			proposals={proposals}
			outputDir={outputDir}
			onChanged={onChanged}
		/>,
	);
	return { onChanged };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(approveProposal).mockResolvedValue("approved");
	vi.mocked(rejectProposal).mockResolvedValue("rejected");
	vi.mocked(executeProposals).mockResolvedValue(undefined);
	vi.mocked(executeProposalsStatus).mockResolvedValue({
		running: false,
		mode: "dry-run",
		exit_code: 0,
		log_tail: "done",
		error: null,
	});
});

describe("Automation — empty state", () => {
	it("shows the generate-proposals hint when the queue is empty", () => {
		renderTab([]);
		expect(
			screen.getByText(/No bounded-automation proposals in the queue/i),
		).toBeInTheDocument();
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});
});

describe("Automation — row ordering", () => {
	it("orders rows pending → approved → rejected regardless of input order", () => {
		const { container } = render(
			<Automation
				proposals={[
					proposal({ proposal_id: "r", status: "rejected" }),
					proposal({ proposal_id: "p", status: "pending" }),
					proposal({ proposal_id: "a", status: "approved" }),
				]}
				outputDir=""
				onChanged={vi.fn()}
			/>,
		);
		const statuses = Array.from(container.querySelectorAll(".pill")).map(
			(el) => el.textContent,
		);
		expect(statuses).toEqual(["pending", "approved", "rejected"]);
	});
});

describe("Automation — approve / reject", () => {
	it("approves a pending proposal by id and refetches the queue", async () => {
		const user = userEvent.setup();
		const { onChanged } = renderTab([
			proposal({ proposal_id: "context-pr:Foo", status: "pending" }),
		]);

		await user.click(screen.getByRole("button", { name: "Approve" }));

		expect(approveProposal).toHaveBeenCalledWith("context-pr:Foo", null);
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
	});

	it("rejects a pending proposal by id", async () => {
		const user = userEvent.setup();
		renderTab([
			proposal({ proposal_id: "catalog-seed:Bar", status: "pending" }),
		]);

		await user.click(screen.getByRole("button", { name: "Reject" }));

		expect(rejectProposal).toHaveBeenCalledWith("catalog-seed:Bar", null);
		expect(approveProposal).not.toHaveBeenCalled();
	});

	it("threads the output dir through to the CLI call", async () => {
		const user = userEvent.setup();
		renderTab([proposal({ status: "pending" })], vi.fn(), "/custom/out");

		await user.click(screen.getByRole("button", { name: "Approve" }));

		expect(approveProposal).toHaveBeenCalledWith(
			"context-pr:Example",
			"/custom/out",
		);
	});
});

describe("Automation — execute gating", () => {
	it("disables both execute buttons when nothing is approved", () => {
		renderTab([proposal({ status: "pending" })]);
		expect(
			screen.getByRole("button", { name: "Execute approved (dry-run)" }),
		).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Apply approved (open PRs)" }),
		).toBeDisabled();
	});

	it("enables the execute buttons once a proposal is approved", () => {
		renderTab([proposal({ status: "approved" })]);
		expect(
			screen.getByRole("button", { name: "Execute approved (dry-run)" }),
		).toBeEnabled();
		expect(
			screen.getByRole("button", { name: "Apply approved (open PRs)" }),
		).toBeEnabled();
	});

	it("dry-run spawns the executor with apply=false and opens no modal", async () => {
		const user = userEvent.setup();
		renderTab([proposal({ status: "approved" })]);

		await user.click(
			screen.getByRole("button", { name: "Execute approved (dry-run)" }),
		);

		expect(executeProposals).toHaveBeenCalledWith(false, null);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});

describe("Automation — apply confirmation gate", () => {
	it("opening the confirm modal does not execute anything yet", async () => {
		const user = userEvent.setup();
		renderTab([proposal({ status: "approved" })]);

		await user.click(
			screen.getByRole("button", { name: "Apply approved (open PRs)" }),
		);

		const dialog = screen.getByRole("dialog");
		expect(dialog).toBeInTheDocument();
		// The warning must name the irreversible action and the --apply flag.
		expect(dialog).toHaveTextContent("--apply");
		expect(dialog).toHaveTextContent(/pull request/i);
		expect(executeProposals).not.toHaveBeenCalled();
	});

	it("cancelling the modal closes it without executing", async () => {
		const user = userEvent.setup();
		renderTab([proposal({ status: "approved" })]);

		await user.click(
			screen.getByRole("button", { name: "Apply approved (open PRs)" }),
		);
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Cancel",
			}),
		);

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(executeProposals).not.toHaveBeenCalled();
	});

	it("confirming the modal spawns the executor with apply=true", async () => {
		const user = userEvent.setup();
		renderTab([proposal({ status: "approved" })]);

		await user.click(
			screen.getByRole("button", { name: "Apply approved (open PRs)" }),
		);
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: /Apply 1 proposal/,
			}),
		);

		expect(executeProposals).toHaveBeenCalledWith(true, null);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});

describe("Automation — execute poll loop", () => {
	it("polls the executor status and refetches the queue on completion", async () => {
		const user = userEvent.setup();
		const { onChanged } = renderTab([proposal({ status: "approved" })]);

		await user.click(
			screen.getByRole("button", { name: "Execute approved (dry-run)" }),
		);

		// The poll interval (1.5s) fires executeProposalsStatus; a success result
		// triggers the one queue refetch.
		await waitFor(() => expect(executeProposalsStatus).toHaveBeenCalled(), {
			timeout: 4000,
		});
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1), {
			timeout: 4000,
		});
		await screen.findByText(/Executor dry-run complete/i);
	});
});
