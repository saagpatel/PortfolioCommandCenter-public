# Portfolio Command Center

[![CI](https://github.com/saagpatel/PortfolioCommandCenter/actions/workflows/ci.yml/badge.svg)](https://github.com/saagpatel/PortfolioCommandCenter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A desktop command center (Tauri 2 + React + TypeScript) over the
[GithubRepoAuditor](../GithubRepoAuditor) portfolio truth snapshot. Normal
browsing is a **read-only consumer** of the auditor's output artifacts; explicit
header actions can spawn the auditor CLI to refresh those artifacts in place.

## What it shows

- **Portfolio** — filterable, sortable table of every project: risk tier,
  attention state, context quality, registry status, tool, and open
  high/critical Dependabot alert count.
- **Risk + Security** — elevated-risk repos with their factors, plus the security
  posture (scanned / with-open-high-critical / critical / high), driven by the
  per-project `security` fields from truth schema 0.5.0.
- **Burndown** — the advisory-grouped `security-burndown` fix list: each runtime
  high/critical advisory and the repos a single package bump would clear.
- **Trends** — risk-tier and security drift charted across every timestamped
  truth snapshot on disk.
- **Weekly Digest** — headline, decision, why-this-week, next-step, path attention,
  and risk/security posture from the latest weekly-command-center digest.

A **Run auditor** / **Full re-audit** action in the header regenerates the
artifacts in place (fast = truth + security overlay; full = clone + analyze +
GHAS + burndown) and reloads the views on completion.

## Data source

The Rust side exposes read-only load commands (`load_portfolio_truth`,
`load_weekly_digest`, `load_security_burndown`, `load_truth_history`) that read
from a configurable auditor output directory
(default `~/Projects/GithubRepoAuditor/output`):

- `portfolio-truth-latest.json` — the canonical truth snapshot.
- `weekly-command-center-<user>-<date>.json` — newest is used.
- `security-burndown-<user>-<date>.json` — newest is used.
- every `portfolio-truth-*.json` — aggregated into the trend series.

The one producer path, `run_auditor`/`auditor_status`, spawns the auditor to
regenerate these artifacts (see the **Run auditor** action above).

Generate/refresh them from the auditor:

```sh
# in GithubRepoAuditor — flags FIRST, then username, run via `python -m`
python -m src.cli --portfolio-truth --portfolio-truth-include-security <user>
```

Two gotchas this exact form sidesteps:

- `--portfolio-truth-include-security` is a **top-level** flag. Passing the
  username first (`audit <user> --portfolio-truth …`) makes the CLI's
  legacy-argv rewriter route into the `report` subcommand, which does not
  carry that flag — so it errors with "unrecognized arguments". Leading with
  the flags keeps parsing on the top-level parser.
- The `audit` console script may be editable-linked to a *different* checkout
  (e.g. `GithubRepoAuditor-public`) that predates the security overlay. Run
  `python -m src.cli` from the working repo to guarantee the current code.

The security overlay also requires a prior `ghas-alerts-<user>-*.json` (from an
`--ghas-alerts` run); the newest one on disk is picked up automatically.

The output-dir field in the app header overrides the default at runtime.

Registry status is inventory/activity truth; attention state is operator-focus
truth. Default operator attention is limited to `active-product`,
`active-infra`, and `decision-needed`, so a broad `active` registry status alone
does not make a repo urgent.

## Public-safe fixture demo

Use this path for public screenshots, recordings, demos, and docs. It runs the
desktop app against fixture-generated GitHub Repo Auditor artifacts instead of
the private live portfolio.

```sh
# in ../GithubRepoAuditor
make demo
python scripts/validate_proof_package.py docs/demo-proof/public-fixture/proof-package.json

# in this repo
pnpm install
pnpm demo:desktop
```

When the app opens, set the output directory field to:

```text
../GithubRepoAuditor/output/demo
```

Use `../GithubRepoAuditor/DEMO-PLAN.md` for the public recording script and
redaction checklist. The fixture proof package is
`../GithubRepoAuditor/docs/demo-proof/public-fixture/`.

## Local live demo

Refresh local producer artifacts first, then launch the desktop shell:

```sh
# in ../GithubRepoAuditor
python -m src.cli --portfolio-truth --portfolio-truth-include-security <user>
python -m src.cli triage <user> --control-center

# in this repo
pnpm install
pnpm demo:desktop
```

The first command updates the canonical truth snapshot and security overlay. The
second updates the operator control-center and the weekly command-center digest
that powers the Weekly Digest tab. The demo command uses a Tauri dev config with
a distinct demo product/window title, so a previously opened packaged app cannot
steal focus during the smoke pass. Use `pnpm dev` only for frontend-only Vite
work; the full demo needs the Tauri shell so IPC can read the auditor artifacts.

## Develop

```sh
pnpm install         # first run — creates the lockfile
pnpm demo:desktop    # run the desktop demo; choose live or fixture output in the header
pnpm tauri dev       # normal Tauri dev shell
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest run
pnpm build           # tsc + production Vite bundle
```

## Build a distributable app

```sh
pnpm tauri build     # release build → double-clickable .app + .dmg
```

Artifacts land in `src-tauri/target/release/bundle/`:

- `macos/PortfolioCommandCenter.app` — the double-clickable app.
- `dmg/PortfolioCommandCenter_<version>_aarch64.dmg` — the drag-to-install image.

The bundle is configured for Developer ID signing in `src-tauri/tauri.conf.json`.
Notarization still depends on the local Apple credentials available at build
time.

## Stack

Tauri 2 (Rust shell, `serde_json` file reads) · React 18 + TypeScript (strict) ·
Vite 6. The frontend owns the typed shapes in `src/types.ts`; the Rust commands
return the auditor's JSON verbatim.

## Roadmap

Phase 1 + 2 (shipped): live run-auditor action, snapshot history/trends, the
`security-burndown` tab, per-project drill-down, automation proposal triage,
executor dry-run/apply controls, and a bundled signed `.app` + `.dmg`.

Next:

- Keep demo docs and portfolio truth aligned with the latest auditor CLI shape.
- Decide whether CI and license signals should be added so portfolio truth can
  mark the project beyond the current local-app baseline.
