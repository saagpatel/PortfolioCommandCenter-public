//! Data commands over the GithubRepoAuditor output artifacts.
//!
//! The bulk of the shell is a read-only *consumer*: the load_* commands parse the
//! auditor's JSON verbatim and hand it back, owning no schema on the Rust side.
//! The run_auditor/auditor_status pair is the one *producer* path — it spawns the
//! auditor to regenerate its artifacts on demand (see the SAFETY note there).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

/// Default auditor output directory when the frontend doesn't override it.
fn default_output_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join("Projects/GithubRepoAuditor/output")
}

fn resolve_dir(output_dir: Option<String>) -> PathBuf {
    match output_dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => default_output_dir(),
    }
}

fn read_json(path: &PathBuf) -> Result<Value, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Could not read {}: {}", path.display(), e))?;
    serde_json::from_str(&text).map_err(|e| format!("Invalid JSON in {}: {}", path.display(), e))
}

/// Load the canonical portfolio truth snapshot (`portfolio-truth-latest.json`).
#[tauri::command]
fn load_portfolio_truth(output_dir: Option<String>) -> Result<Value, String> {
    let path = resolve_dir(output_dir).join("portfolio-truth-latest.json");
    read_json(&path)
}

/// Load the most recent `weekly-command-center-*.json` (lexicographically latest,
/// which matches newest date for the auditor's `-YYYY-MM-DD.json` naming).
#[tauri::command]
fn load_weekly_digest(output_dir: Option<String>) -> Result<Value, String> {
    let dir = resolve_dir(output_dir);
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("Could not read {}: {}", dir.display(), e))?;

    let mut latest: Option<String> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("weekly-command-center-") && name.ends_with(".json") {
            if latest.as_ref().map(|cur| name > *cur).unwrap_or(true) {
                latest = Some(name);
            }
        }
    }

    let name = latest
        .ok_or_else(|| format!("No weekly-command-center-*.json found in {}", dir.display()))?;
    read_json(&dir.join(name))
}

/// Load the most recent `security-burndown-*.json` (advisory-grouped fix list:
/// "fix package X → clears N repos"). Newest by name, matching the date suffix.
#[tauri::command]
fn load_security_burndown(output_dir: Option<String>) -> Result<Value, String> {
    let dir = resolve_dir(output_dir);
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("Could not read {}: {}", dir.display(), e))?;

    let mut latest: Option<String> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("security-burndown-")
            && name.ends_with(".json")
            && latest.as_ref().map(|cur| name > *cur).unwrap_or(true)
        {
            latest = Some(name);
        }
    }

    let name =
        latest.ok_or_else(|| format!("No security-burndown-*.json found in {}", dir.display()))?;
    read_json(&dir.join(name))
}

// ── Snapshot history ────────────────────────────────────────────────────────
// Lean deserialization targets — serde ignores the many fields we don't trend.

#[derive(Deserialize)]
struct SnapRisk {
    risk_tier: Option<String>,
}

#[derive(Deserialize)]
struct SnapSecurity {
    alerts_available: Option<bool>,
    dependabot_critical: Option<i64>,
    dependabot_high: Option<i64>,
}

#[derive(Deserialize)]
struct SnapProject {
    risk: Option<SnapRisk>,
    security: Option<SnapSecurity>,
}

#[derive(Deserialize)]
struct Snap {
    generated_at: Option<String>,
    schema_version: Option<String>,
    #[serde(default)]
    projects: Vec<SnapProject>,
}

/// One point in the portfolio's risk/security history.
#[derive(Serialize)]
struct HistoryPoint {
    generated_at: String,
    schema_version: String,
    elevated: u32,
    moderate: u32,
    baseline: u32,
    deferred: u32,
    total: u32,
    repos_open_high_crit: u32,
    total_high_crit: u64,
    has_security: bool,
}

/// Aggregate every timestamped `portfolio-truth-*.json` snapshot into a compact
/// chronological time-series (risk-tier distribution + security counts). The raw
/// snapshot bytes stay in this process — only the per-snapshot summary crosses to
/// the frontend, so 70+ ~1 MB snapshots collapse to a small array.
#[tauri::command]
fn load_truth_history(output_dir: Option<String>) -> Result<Vec<HistoryPoint>, String> {
    let dir = resolve_dir(output_dir);
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("Could not read {}: {}", dir.display(), e))?;

    let mut points: Vec<HistoryPoint> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Timestamped snapshots only — skip the `-latest.json` alias (dup of newest).
        if !(name.starts_with("portfolio-truth-") && name.ends_with(".json"))
            || name == "portfolio-truth-latest.json"
        {
            continue;
        }
        // Skip an unreadable/malformed snapshot rather than fail the whole series.
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(snap) = serde_json::from_str::<Snap>(&text) else {
            continue;
        };
        // A snapshot with no generated_at can't be placed on the time axis —
        // skip it rather than emit a phantom point that sorts to the origin.
        let Some(generated_at) = snap.generated_at.filter(|s| !s.is_empty()) else {
            continue;
        };

        let (mut elevated, mut moderate, mut baseline, mut deferred) = (0u32, 0u32, 0u32, 0u32);
        let mut repos_open_high_crit = 0u32;
        let mut total_high_crit = 0u64;
        let mut has_security = false;

        for p in &snap.projects {
            match p.risk.as_ref().and_then(|r| r.risk_tier.as_deref()) {
                Some("elevated") => elevated += 1,
                Some("moderate") => moderate += 1,
                Some("baseline") => baseline += 1,
                Some("deferred") => deferred += 1,
                _ => {}
            }
            if let Some(s) = &p.security {
                if s.alerts_available.unwrap_or(false) {
                    has_security = true;
                    let hc = s.dependabot_high.unwrap_or(0).max(0) as u64
                        + s.dependabot_critical.unwrap_or(0).max(0) as u64;
                    if hc > 0 {
                        repos_open_high_crit += 1;
                        total_high_crit += hc;
                    }
                }
            }
        }

        points.push(HistoryPoint {
            generated_at,
            schema_version: snap.schema_version.unwrap_or_default(),
            elevated,
            moderate,
            baseline,
            deferred,
            total: elevated + moderate + baseline + deferred,
            repos_open_high_crit,
            total_high_crit,
            has_security,
        });
    }

    // Chronological by generated_at (ISO8601 sorts lexicographically).
    points.sort_by(|a, b| a.generated_at.cmp(&b.generated_at));
    Ok(points)
}

// ── Auditor run (the one producer path) ─────────────────────────────────────
//
// SAFETY: no caller-controlled string is ever spliced into the shell. The
// command templates are fixed; the only interpolated value is the GitHub
// username, which is resolved from `gh` (not from frontend input) and validated
// to `[A-Za-z0-9-]`. The output directory reaches the child only as its working
// directory, never as shell text. Commands run under a login shell so mise's
// python (with the auditor's deps + editable install) is on PATH.

/// A spawned auditor process plus where its combined output is being logged.
struct AuditorRun {
    child: Child,
    mode: String,
    log_path: PathBuf,
}

#[derive(Default)]
struct RunState(Mutex<Option<AuditorRun>>);

/// Independent slot for the bounded-automation proposal executor, so an in-flight
/// `--execute-proposals` run is tracked (and polled) separately from an auditor
/// refresh — each tab observes only its own producer.
#[derive(Default)]
struct ExecState(Mutex<Option<AuditorRun>>);

#[derive(Serialize)]
struct RunStatus {
    running: bool,
    mode: String,
    exit_code: Option<i32>,
    log_tail: String,
    error: Option<String>,
}

/// The auditor repo root — parent of the output dir (`<repo>/output`), where
/// `python -m src.cli` must run from.
fn auditor_repo_dir(output_dir: Option<String>) -> Result<PathBuf, String> {
    let out = resolve_dir(output_dir);
    out.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| format!("cannot derive auditor repo from {}", out.display()))
}

/// Resolve the GitHub username via `gh` (the same auth the auditor uses). This is
/// the only value interpolated into a run command; gh logins are `[A-Za-z0-9-]`,
/// so there is no shell-injection surface. Run under a login shell for PATH.
fn resolve_username() -> Result<String, String> {
    let out = Command::new("zsh")
        .args(["-lc", "gh api user --jq .login"])
        .output()
        .map_err(|e| format!("could not run gh: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "gh api user failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let user = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if user.is_empty() || !user.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("gh returned an unexpected username: {user:?}"));
    }
    Ok(user)
}

/// Last `max_bytes` of a log file, trimmed to a char boundary.
fn tail_file(path: &PathBuf, max_bytes: usize) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    if text.len() <= max_bytes {
        return text;
    }
    let start = (text.len() - max_bytes..text.len())
        .find(|&i| text.is_char_boundary(i))
        .unwrap_or(text.len());
    text[start..].to_string()
}

/// Spawn `zsh <argv>` with `repo` as cwd, teeing stdout+stderr into `log_path`,
/// and store the handle in `guard` tagged with `mode`. Errors (without spawning)
/// if a run already tracked by `guard` is still live. Shared by the auditor-run
/// and proposal-executor producer paths so the spawn ceremony lives in one place.
fn spawn_into(
    guard: &mut Option<AuditorRun>,
    argv: &[String],
    repo: &PathBuf,
    log_path: PathBuf,
    mode: String,
) -> Result<(), String> {
    if is_live(guard) {
        let live = guard.as_ref().map(|r| r.mode.as_str()).unwrap_or("");
        return Err(format!("a {live} run is already in progress"));
    }

    let log = std::fs::File::create(&log_path)
        .map_err(|e| format!("could not open log {}: {e}", log_path.display()))?;
    let log_err = log
        .try_clone()
        .map_err(|e| format!("log clone failed: {e}"))?;

    let child = Command::new("zsh")
        .args(argv)
        .current_dir(repo)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn()
        .map_err(|e| format!("could not spawn: {e}"))?;

    *guard = Some(AuditorRun {
        child,
        mode,
        log_path,
    });
    Ok(())
}

/// Whether the run tracked by `guard` is still executing (vs finished or absent).
/// Used both to gate a fresh spawn and to cross-check the *other* producer's slot
/// so an auditor refresh and a proposal execution can't run heavy python over the
/// same workspace concurrently.
fn is_live(guard: &mut Option<AuditorRun>) -> bool {
    matches!(guard.as_mut().map(|r| r.child.try_wait()), Some(Ok(None)))
}

/// Snapshot the run tracked by `guard` as a `RunStatus` (no live run → an idle
/// status). Shared by the auditor-run and proposal-executor poll commands.
fn poll_run(guard: &mut Option<AuditorRun>) -> RunStatus {
    let Some(run) = guard.as_mut() else {
        return RunStatus {
            running: false,
            mode: String::new(),
            exit_code: None,
            log_tail: String::new(),
            error: None,
        };
    };

    let log_tail = tail_file(&run.log_path, 4000);
    match run.child.try_wait() {
        Ok(None) => RunStatus {
            running: true,
            mode: run.mode.clone(),
            exit_code: None,
            log_tail,
            error: None,
        },
        Ok(Some(status)) => RunStatus {
            running: false,
            mode: run.mode.clone(),
            exit_code: status.code(),
            log_tail,
            error: None,
        },
        Err(e) => RunStatus {
            running: false,
            mode: run.mode.clone(),
            exit_code: None,
            log_tail,
            error: Some(format!("wait failed: {e}")),
        },
    }
}

/// Spawn the auditor in `fast` (truth + security overlay, ~15s) or `full`
/// (clone + analyze + ghas + burndown + truth, ~30min) mode. Returns
/// immediately; poll `auditor_status` for progress. Errors if a run is live.
#[tauri::command]
fn run_auditor(
    mode: String,
    output_dir: Option<String>,
    state: State<'_, RunState>,
    exec: State<'_, ExecState>,
) -> Result<(), String> {
    // Refuse to start while a proposal execution is live — both run heavy python
    // over the same workspace/output dir (clone/analyze vs PR-open + snapshot) and
    // must not race. Acquire-check-release the other slot before taking our own, so
    // the two producers never hold both locks at once (no deadlock).
    {
        let mut eg = exec
            .0
            .lock()
            .map_err(|_| "exec state poisoned".to_string())?;
        if is_live(&mut eg) {
            return Err("a proposal-executor run is in progress; wait for it to finish".into());
        }
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "run state poisoned".to_string())?;

    let repo = auditor_repo_dir(output_dir.clone())?;
    let user = resolve_username()?;
    let log_path = resolve_dir(output_dir).join("pcc-auditor-run.log");

    let script = match mode.as_str() {
        "fast" => {
            format!("python -m src.cli --portfolio-truth --portfolio-truth-include-security {user}")
        }
        "full" => format!(
            "python -m src.cli report {user} --ghas-alerts && \
             python -m src.cli security-burndown {user} && \
             python -m src.cli --portfolio-truth --portfolio-truth-include-security {user}"
        ),
        other => return Err(format!("unknown run mode: {other}")),
    };

    let argv = vec!["-lc".to_string(), script];
    spawn_into(&mut guard, &argv, &repo, log_path, mode)
}

/// Poll the in-flight (or most recent) auditor run.
#[tauri::command]
fn auditor_status(state: State<'_, RunState>) -> RunStatus {
    match state.0.lock() {
        Ok(mut guard) => poll_run(&mut guard),
        Err(_) => RunStatus {
            running: false,
            mode: String::new(),
            exit_code: None,
            log_tail: String::new(),
            error: Some("run state poisoned".into()),
        },
    }
}

// ── Launchpad actions (act on the project where it lives) ────────────────────
//
// SAFETY: every path/URL reaches `open`/`git` as a single argv argument via
// Command::new(...).arg(...) — never spliced into a shell string — so there is
// no shell-injection surface even though the values originate from snapshot
// data. These commands launch external apps (Finder, the browser) but never
// write the auditor's artifacts, preserving the read-only-consumer contract.

/// Open a project's directory in Finder.
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("no path to open".into());
    }
    let status = Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| format!("could not open Finder: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open exited with {status}"))
    }
}

/// Open an http(s) URL in the default browser. Rejects any other scheme so a
/// snapshot value can't coerce `open` into launching an arbitrary handler.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let url = url.trim();
    let host = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    let Some(host) = host else {
        return Err("refusing to open a non-http(s) URL".into());
    };
    // Reject a bare scheme (`http://`) or an empty authority (`http:///x`) so a
    // hostless value can't be handed to `open`.
    if host.is_empty() || host.starts_with('/') {
        return Err("URL has no host".into());
    }
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| format!("could not open URL: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open exited with {status}"))
    }
}

/// Resolve a project's GitHub web URL from its `origin` remote, if it has one.
/// Returns `None` for a non-git path or a non-GitHub remote, so the UI can hide
/// the button. The normalization itself is pure and unit-tested below.
#[tauri::command]
fn repo_web_url(path: String) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", &path, "remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let remote = String::from_utf8_lossy(&out.stdout);
    github_web_url(&remote)
}

/// Normalize a git `origin` URL to its GitHub https web URL, or `None` if it is
/// not a recognizable github.com remote (scp-, https-, ssh-, git-form).
fn github_web_url(remote: &str) -> Option<String> {
    let remote = remote.trim().trim_end_matches('/');
    let rest = remote
        .strip_prefix("git@github.com:")
        .or_else(|| remote.strip_prefix("https://github.com/"))
        .or_else(|| remote.strip_prefix("ssh://git@github.com/"))
        .or_else(|| remote.strip_prefix("git://github.com/"))?;
    let slug = rest.strip_suffix(".git").unwrap_or(rest);
    if slug.is_empty() || slug.contains(char::is_whitespace) {
        return None;
    }
    Some(format!("https://github.com/{slug}"))
}

// ── Automation proposal triage (Arc D queue → desktop) ──────────────────────
//
// SAFETY: the dynamic values (GitHub username + proposal id) are NEVER spliced
// into the shell script. The script references fixed positionals ($1 = username,
// $2 = output dir, $3 = proposal id) and the values reach zsh as separate argv
// elements, so a proposal id containing shell metacharacters — display names like
// "Signal & Noise" produce ids like `context-pr:Signal & Noise` — is handed to
// python as a single inert string and cannot inject. The proposal layer + gated
// executor (Arc D) own every approval gate and git/gh rail; this is thin dispatch
// to the same `python -m src.cli report …` a human would run. Approve/reject are
// metadata-only and run synchronously. Execution (dry-run AND `--apply`) goes
// through the spawn+poll path because a fresh workspace+Notion snapshot precedes
// any work when proposals are approved; `--apply` (which opens PRs / writes
// catalog seeds) is gated behind an explicit operator confirmation in the UI.

#[derive(Clone, Copy)]
enum ProposalAction {
    Approve,
    Reject,
    ExecuteDryRun,
    ExecuteApply,
}

/// Build the `zsh -lc` argv for a proposal action. `$1` = username, `$2` = output
/// dir, `$3` = proposal id; all ride as positionals, never interpolated into the
/// script template. `--output-dir` is passed explicitly so the CLI writes the
/// queue to the same directory the read command reads from (the UI may override
/// it). The execute variants take no id and operate over the whole approved set;
/// ExecuteApply adds `--apply` so the auditor opens PRs / writes catalog seeds.
/// Pure + unit-tested below.
fn proposal_cli_args(
    action: &ProposalAction,
    username: &str,
    output_dir: &str,
    proposal_id: &str,
) -> Vec<String> {
    let script = match action {
        ProposalAction::Approve => {
            "python -m src.cli report \"$1\" --output-dir \"$2\" --approve-proposal \"$3\""
        }
        ProposalAction::Reject => {
            "python -m src.cli report \"$1\" --output-dir \"$2\" --reject-proposal \"$3\""
        }
        ProposalAction::ExecuteDryRun => {
            "python -m src.cli report \"$1\" --output-dir \"$2\" --execute-proposals"
        }
        ProposalAction::ExecuteApply => {
            "python -m src.cli report \"$1\" --output-dir \"$2\" --execute-proposals --apply"
        }
    };
    // $0 placeholder ("pcc"), $1 = username, $2 = output dir, $3 = id (approve/reject).
    let mut argv = vec![
        "-lc".to_string(),
        script.to_string(),
        "pcc".to_string(),
        username.to_string(),
        output_dir.to_string(),
    ];
    if matches!(action, ProposalAction::Approve | ProposalAction::Reject) {
        argv.push(proposal_id.to_string());
    }
    argv
}

/// Trim a frontend-supplied proposal id and reject an empty one before it reaches
/// the CLI (the CLI also validates existence; this catches the no-op early).
fn validated_proposal_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("no proposal id supplied".into());
    }
    Ok(trimmed.to_string())
}

/// Run an approve/reject proposal action by shelling to the same
/// `python -m src.cli report …` the operator would run by hand, under a login
/// shell (for mise's python + editable install) with the auditor repo as cwd.
/// Synchronous: approve/reject are metadata-only and short-circuit before any
/// heavy report/snapshot work. Username is resolved from `gh` and validated; the
/// id rides as a positional. (Execution uses the spawn+poll path instead.)
fn run_proposal_cli(
    action: ProposalAction,
    proposal_id: &str,
    output_dir: Option<String>,
) -> Result<String, String> {
    let dir = resolve_dir(output_dir.clone());
    let repo = auditor_repo_dir(output_dir)?;
    let user = resolve_username()?;
    let id = validated_proposal_id(proposal_id)?;
    let dir_str = dir.to_string_lossy().to_string();
    let out = Command::new("zsh")
        .args(proposal_cli_args(&action, &user, &dir_str, &id))
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("could not run auditor CLI: {e}"))?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .trim()
    .to_string();
    if out.status.success() {
        Ok(combined)
    } else {
        Err(format!(
            "auditor CLI exited with {}: {}",
            out.status.code().unwrap_or(-1),
            combined
        ))
    }
}

/// Read the durable bounded-automation proposal queue (Arc D's
/// `pending-proposals.json`). A missing file is a normal empty-queue state, not a
/// load error, so the tab shows its empty state rather than an error banner.
#[tauri::command]
fn load_automation_proposals(output_dir: Option<String>) -> Result<Value, String> {
    let path = resolve_dir(output_dir).join("pending-proposals.json");
    if !path.exists() {
        return Ok(serde_json::json!({
            "contract_version": "automation_proposals_v1",
            "proposals": [],
        }));
    }
    read_json(&path)
}

/// Approve a pending proposal (PENDING → APPROVED). Metadata-only; no repo is
/// touched until a separate execute step.
#[tauri::command]
fn approve_proposal(proposal_id: String, output_dir: Option<String>) -> Result<String, String> {
    run_proposal_cli(ProposalAction::Approve, &proposal_id, output_dir)
}

/// Reject a pending proposal (PENDING → REJECTED). Metadata-only.
#[tauri::command]
fn reject_proposal(proposal_id: String, output_dir: Option<String>) -> Result<String, String> {
    run_proposal_cli(ProposalAction::Reject, &proposal_id, output_dir)
}

/// Spawn the gated executor over approved proposals. `apply=false` is a dry-run
/// (reports what WOULD happen — no PRs open, no catalog seeds written);
/// `apply=true` passes `--apply` so the auditor actually opens context PRs and
/// writes catalog seeds. Execution is heavy when proposals are approved (a fresh
/// workspace+Notion snapshot precedes it), so this returns immediately — poll
/// `execute_proposals_status`. The UI gates `apply=true` behind an explicit
/// operator confirmation; the Arc D approval gate + git/gh rails remain the
/// source of truth either way.
#[tauri::command]
fn execute_proposals(
    apply: bool,
    output_dir: Option<String>,
    state: State<'_, ExecState>,
    run: State<'_, RunState>,
) -> Result<(), String> {
    // Refuse to start while an auditor refresh is live — both run heavy python over
    // the same workspace/output dir and must not race (acquire-check-release the
    // other slot first; never hold both locks → no deadlock).
    {
        let mut rg = run.0.lock().map_err(|_| "run state poisoned".to_string())?;
        if is_live(&mut rg) {
            return Err("an auditor run is in progress; wait for it to finish".into());
        }
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "exec state poisoned".to_string())?;

    let dir = resolve_dir(output_dir.clone());
    let repo = auditor_repo_dir(output_dir)?;
    let user = resolve_username()?;
    let action = if apply {
        ProposalAction::ExecuteApply
    } else {
        ProposalAction::ExecuteDryRun
    };
    let dir_str = dir.to_string_lossy().to_string();
    let argv = proposal_cli_args(&action, &user, &dir_str, "");
    let log_path = dir.join("pcc-executor-run.log");
    let mode = if apply { "apply" } else { "dry-run" }.to_string();
    spawn_into(&mut guard, &argv, &repo, log_path, mode)
}

/// Poll the in-flight (or most recent) proposal-executor run.
#[tauri::command]
fn execute_proposals_status(state: State<'_, ExecState>) -> RunStatus {
    match state.0.lock() {
        Ok(mut guard) => poll_run(&mut guard),
        Err(_) => RunStatus {
            running: false,
            mode: String::new(),
            exit_code: None,
            log_tail: String::new(),
            error: Some("exec state poisoned".into()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{github_web_url, proposal_cli_args, validated_proposal_id, ProposalAction};

    #[test]
    fn approve_passes_username_dir_and_id_as_positionals_not_spliced() {
        let id = "context-pr:Signal & Noise";
        let v = proposal_cli_args(&ProposalAction::Approve, "saagpatel", "/tmp/out dir", id);
        assert_eq!(v.len(), 6);
        assert_eq!(v[0], "-lc");
        assert_eq!(v[2], "pcc");
        assert_eq!(v[3], "saagpatel");
        assert_eq!(v[4], "/tmp/out dir");
        assert_eq!(v[5], id);
        assert!(v[1].contains("--approve-proposal"));
        assert!(v[1].contains("--output-dir"));
        assert!(v[1].contains("\"$1\""));
        assert!(v[1].contains("\"$2\""));
        assert!(v[1].contains("\"$3\""));
        // The dynamic values must never appear in the script element itself.
        assert!(!v[1].contains("saagpatel"));
        assert!(!v[1].contains("Signal & Noise"));
        assert!(!v[1].contains("/tmp/out dir"));
    }

    #[test]
    fn reject_uses_reject_flag_and_trails_the_id() {
        let v = proposal_cli_args(
            &ProposalAction::Reject,
            "u",
            "/o",
            "catalog-seed:owner/repo",
        );
        assert!(v[1].contains("--reject-proposal"));
        assert!(!v[1].contains("--approve-proposal"));
        assert_eq!(v[5], "catalog-seed:owner/repo");
    }

    #[test]
    fn execute_dry_run_has_no_apply_and_no_id_positional() {
        let v = proposal_cli_args(&ProposalAction::ExecuteDryRun, "u", "/o", "ignored");
        assert!(v[1].contains("--execute-proposals"));
        assert!(!v[1].contains("--apply"));
        assert_eq!(v.len(), 5); // -lc, script, $0, username, output-dir — no id
        assert_eq!(v[3], "u");
        assert_eq!(v[4], "/o");
        assert!(!v.iter().any(|a| a == "ignored"));
    }

    #[test]
    fn execute_apply_adds_apply_flag_and_no_id_positional() {
        let v = proposal_cli_args(&ProposalAction::ExecuteApply, "u", "/o", "ignored");
        assert!(v[1].contains("--execute-proposals"));
        assert!(v[1].contains("--apply"));
        assert_eq!(v.len(), 5); // -lc, script, $0, username, output-dir — no id
        assert_eq!(v[3], "u");
        assert_eq!(v[4], "/o");
        assert!(!v.iter().any(|a| a == "ignored"));
    }

    #[test]
    fn malicious_id_stays_inert_as_a_single_positional() {
        let id = "context-pr:x\"; rm -rf ~ #";
        let v = proposal_cli_args(&ProposalAction::Approve, "u", "/o", id);
        assert_eq!(v[5], id); // handed to zsh verbatim as one argv element
        assert!(!v[1].contains("rm -rf")); // never reaches the script text
    }

    #[test]
    fn validated_proposal_id_trims_and_rejects_empty() {
        assert_eq!(validated_proposal_id("  abc  ").unwrap(), "abc");
        assert!(validated_proposal_id("   ").is_err());
        assert!(validated_proposal_id("").is_err());
    }

    #[test]
    fn normalizes_scp_form() {
        assert_eq!(
            github_web_url("git@github.com:saagpatel/PortfolioCommandCenter.git"),
            Some("https://github.com/saagpatel/PortfolioCommandCenter".into())
        );
    }

    #[test]
    fn normalizes_https_form_with_or_without_git_suffix() {
        assert_eq!(
            github_web_url("https://github.com/owner/repo.git"),
            Some("https://github.com/owner/repo".into())
        );
        assert_eq!(
            github_web_url("https://github.com/owner/repo"),
            Some("https://github.com/owner/repo".into())
        );
    }

    #[test]
    fn normalizes_ssh_protocol_form() {
        assert_eq!(
            github_web_url("ssh://git@github.com/owner/repo.git"),
            Some("https://github.com/owner/repo".into())
        );
    }

    #[test]
    fn rejects_non_github_or_empty_remotes() {
        assert_eq!(github_web_url("git@gitlab.com:owner/repo.git"), None);
        assert_eq!(github_web_url("https://example.com/owner/repo"), None);
        assert_eq!(github_web_url(""), None);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RunState::default())
        .manage(ExecState::default())
        .invoke_handler(tauri::generate_handler![
            load_portfolio_truth,
            load_weekly_digest,
            load_security_burndown,
            load_truth_history,
            run_auditor,
            auditor_status,
            reveal_in_finder,
            open_external,
            repo_web_url,
            load_automation_proposals,
            approve_proposal,
            reject_proposal,
            execute_proposals,
            execute_proposals_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
