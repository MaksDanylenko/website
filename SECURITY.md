# Security Policy

Foojay.io is a static site built from this repository by GitHub Actions, plus
a small first-party Cloudflare Worker for the read counter. If you find a
security vulnerability in the site's code, build pipeline, or infrastructure —
as opposed to a typo or bad advice in an *article*, which is just a normal
pull request — please report it privately rather than opening a public issue.

## Reporting a vulnerability

Two ways to reach us privately — either is fine:

- Use GitHub's **[Report a vulnerability](https://github.com/foojayio/website/security/advisories/new)**
  button (Security tab → Advisories → Report a vulnerability). This opens a
  private advisory that only maintainers can see.
- Email **[hello@foojay.io](mailto:hello@foojay.io)** with a subject line
  starting with **"SECURITY:"**.

Either way, please include:

- What the vulnerability is and where it lives (a URL, a file in this repo,
  a workflow).
- Steps to reproduce it, or a proof of concept if you have one.
- What you think the impact is.

We'll acknowledge your report, and let you know once it's fixed. Please give
us a reasonable amount of time to fix an issue before disclosing it publicly.

## Scope

This covers the code in this repository (Hugo templates, layouts, build
scripts, GitHub Actions workflows) and the infrastructure that serves
foojay.io from it. It does not cover third-party services embedded in
articles (videos, playgrounds, slide decks) — report those to the service
that hosts them.

See the [Code of Conduct](CODE_OF_CONDUCT.md) for how we handle other kinds
of reports.
