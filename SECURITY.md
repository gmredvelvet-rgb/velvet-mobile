# Security Policy

## Supported versions

Only the **latest released version** of Velvet Mobile receives security fixes.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue.

- Preferred: [GitHub private vulnerability reporting](https://github.com/gmredvelvet-rgb/velvet-mobile/security/advisories/new)
- Email: gmredvelvet@gmail.com

Include the Foundry version, module version, and reproduction steps. You'll get an acknowledgement within a reasonable time, and we'll coordinate a fix and disclosure with you.

## Scope

Velvet Mobile talks to a licence server (`vnd-license.gmredvelvet.workers.dev`) for Patreon-based authorisation. Server responses are verified with an embedded RSA public key; the private key never ships with the module. Reports about the licence-verification flow, token handling, or the embedded key are in scope.

Please **do not** publish licence-bypass techniques publicly — report them privately instead.
