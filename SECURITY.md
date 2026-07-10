# Security Policy

## Supported versions

Modlane is pre-alpha. Security fixes are applied to the `main` branch. There are no released versions yet.

## Reporting a vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Please report privately using GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability), or email **piagasistemas@gmail.com**.

Include:

- a description of the issue and its impact,
- steps to reproduce,
- affected component (gateway, protocol adapter, provider adapter, etc.),
- any suggested fix.

We aim to acknowledge reports within a few days and will keep you updated on remediation.

## Scope notes

Modlane handles model requests that may contain source code and prompts. By default it stores **metadata only** — not code, prompts, or responses. Reports about accidental content persistence, secret leakage, or gateway exposure beyond `127.0.0.1` are in scope.
