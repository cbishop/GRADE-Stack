# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public
issue or PR for a suspected vulnerability.

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  on this repository ("Security" → "Report a vulnerability"), **or**
- Email **security@clarkebishop.com** with a description and reproduction steps.

Please include enough detail to reproduce: affected version/commit, environment,
and impact. We aim to acknowledge reports within a few business days.

## Scope

GRADE-Stack is a reference stack under active, in-public development. Of
particular interest:

- Secret/credential handling (the stack injects credentials via environment
  variables and must never persist them).
- The provider abstraction and any future gateway/guardrail bypasses.

## No secrets in the repo

Credentials are never committed. If you find a committed secret, treat it as a
vulnerability and report it privately so it can be rotated and removed.
