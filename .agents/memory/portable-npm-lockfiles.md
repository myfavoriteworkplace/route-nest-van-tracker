---
name: Portable npm lockfiles
description: Dependency-lockfile portability rule for the Render migration.
---

Keep committed npm lockfiles portable: package tarball URLs must use the public npm registry, never `package-firewall.replit.internal`.

**Why:** Render cannot resolve Replit's internal package host, and an install that works inside Replit can hide that deployment failure.

**How to apply:** After dependency changes, inspect `package-lock.json` for Replit-internal URLs and run `npm ci`. Treat the target Render build as a separate verification gate rather than inferring it from the Replit install.
