import type { KeyboardEvent } from "react";
import { useCallback, useState } from "react";
import type { PortfolioProject } from "../types";
import { ProjectDetail } from "./ProjectDetail";

/** Props that make a non-button element (e.g. a clickable table `<tr>`) behave
 *  like a button for keyboard users: reachable by Tab and activated by Enter or
 *  Space. Keeps the row's native table semantics (no `role` override that would
 *  drop it from the grid a11y tree); pair with a `:focus-visible` style so the
 *  focused row is visible. Spread onto the element alongside its `className`. */
export function rowActivation(onActivate: () => void) {
	return {
		tabIndex: 0,
		onClick: onActivate,
		onKeyDown: (e: KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onActivate();
			}
		},
	};
}

/** The open project plus the ordered list it was opened from — prev/next step
 *  through this captured list, so each call site (the Portfolio table, either
 *  Risk + Security table, …) navigates within its own ordering. */
interface DrawerState {
	list: PortfolioProject[];
	project: PortfolioProject;
}

function indexOf(state: DrawerState | null): number {
	if (!state) return -1;
	return state.list.findIndex(
		(p) => p.identity.project_key === state.project.identity.project_key,
	);
}

export interface ProjectDrawerNav {
	selected: PortfolioProject | null;
	/** Open the drawer on `project`, navigating within `list`. */
	open: (project: PortfolioProject, list: PortfolioProject[]) => void;
	close: () => void;
	/** Step to the previous project, wrapping from the first to the last;
	 *  undefined only when the list has a single project (nowhere to step). */
	onPrev: (() => void) | undefined;
	/** Step to the next project, wrapping from the last to the first;
	 *  undefined only when the list has a single project (nowhere to step). */
	onNext: (() => void) | undefined;
	position: { index: number; total: number };
}

/** Drawer selection + ←/→ navigation, reusable across any tab that lists
 *  projects. The list travels with `open()`, so one hook instance serves
 *  multiple tables on the same tab (it tracks whichever was opened last). */
export function useProjectDrawer(): ProjectDrawerNav {
	const [state, setState] = useState<DrawerState | null>(null);

	const open = useCallback(
		(project: PortfolioProject, list: PortfolioProject[]) =>
			setState({ project, list }),
		[],
	);
	const close = useCallback(() => setState(null), []);

	// Recompute the index from current state inside the updater so the stepper
	// has no stale-closure dependency and stays referentially stable. Wraps
	// around the ends (modulo length) so ←/→ loop instead of dead-ending.
	const step = useCallback(
		(delta: number) =>
			setState((s) => {
				if (!s) return s;
				const len = s.list.length;
				const cur = indexOf(s);
				if (cur < 0 || len === 0) return s;
				const next = s.list[(cur + delta + len) % len];
				return next ? { list: s.list, project: next } : s;
			}),
		[],
	);
	// Stable step handlers so the consumer's keydown effect only re-subscribes
	// when crossing the single-item boundary (defined ↔ undefined), not on every
	// step — they're referentially stable for any list with >1 project.
	const goPrev = useCallback(() => step(-1), [step]);
	const goNext = useCallback(() => step(1), [step]);

	const index = indexOf(state);
	const total = state?.list.length ?? 0;
	// Stepping wraps, so prev/next are live for any multi-item list and only go
	// undefined when there's a single project (or none open).
	const canStep = index >= 0 && total > 1;

	return {
		selected: state?.project ?? null,
		open,
		close,
		onPrev: canStep ? goPrev : undefined,
		onNext: canStep ? goNext : undefined,
		position: { index, total },
	};
}

/** Renders the drill-down drawer for a `useProjectDrawer` instance, or nothing
 *  when no project is open. Collapses the wiring to a single line per tab. */
export function ProjectDrawer({
	nav,
	workspaceRoot,
}: {
	nav: ProjectDrawerNav;
	workspaceRoot: string;
}) {
	if (!nav.selected) return null;
	return (
		<ProjectDetail
			project={nav.selected}
			workspaceRoot={workspaceRoot}
			onClose={nav.close}
			onPrev={nav.onPrev}
			onNext={nav.onNext}
			position={nav.position}
		/>
	);
}
