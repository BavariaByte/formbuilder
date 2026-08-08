# Contributing to GIRP Formbuilder

Thank you for your interest in contributing to the GIRP Platform!

## Workflow

- Development happens in an internal repository; this GitHub repository is a
  **snapshot mirror** of the latest release with a single `main` branch and no
  history.
- Open pull requests against `main`. Accepted changes are applied to the
  internal repository by the maintainers (with credit in the changelog) and
  appear here with the next release snapshot — your PR is closed once adopted,
  not merged directly.
- **Note:** every release replaces `main` (force push). Re-sync your fork
  before starting new work:
  `git fetch upstream && git reset --hard upstream/main`
- Use **conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, ...).
- Keep pull requests focused; one topic per PR.

## Commit Messages

Please use [Conventional Commits](https://www.conventionalcommits.org/), e.g.
`feat: add checkbox option ordering`, `fix: prevent duplicate node ids`,
`docs: clarify template format`.

## Development Setup

See the [README](README.md) for prerequisites and setup instructions. The dev
server runs at http://localhost:8080.

## License

GIRP is source-available under the
[Sustainable Use License](LICENSE.md). By contributing, you agree that your
contributions are provided under the same license.

## Security Vulnerabilities

Please do **not** open public issues for security problems. Report them by
email to **security@bavariabyte.com** — see [SECURITY.md](SECURITY.md).
