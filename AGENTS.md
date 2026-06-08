# Agent Notes

PortfolioCommandCenter is a Tauri 2 + React + TypeScript desktop app that reads
GithubRepoAuditor output artifacts from a user-selected local directory.

## Local Workflow

- Install dependencies with `pnpm install`.
- Run the desktop demo with `pnpm demo:desktop`.
- Use `pnpm dev` only for frontend-only Vite work where Tauri IPC is not needed.
- Verify changes with `pnpm typecheck`, `pnpm test`, `pnpm build`, and
  `cargo check --manifest-path src-tauri/Cargo.toml` when Rust/Tauri code is
  touched.

## Public Demo Safety

- Prefer fixture-generated GithubRepoAuditor artifacts for screenshots,
  recordings, docs, and public proof packages.
- Do not commit live portfolio artifacts, private repo names, local absolute
  paths, account data, security advisory details, env files, tokens, or desktop
  screenshots that include private machine state.
- Treat generated proof packages from private/local portfolios as private unless
  they have been explicitly redacted and reviewed.
