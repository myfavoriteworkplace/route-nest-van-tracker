---
name: Python tool auto-configuration
description: Workspace module changes caused by invoking Python during local checks.
---

Avoid invoking Python solely to parse or inspect a file when `yq` or Node tools are available; running `python3` during a YAML check added `python-base-3.13` to `.replit`.

**Why:** An environment auto-detection side effect changed workspace configuration during a read-only validation step.

**How to apply:** Prefer existing `yq` for YAML validation. If Python is needed, inspect `.replit` afterward and restore unintended module changes through the supported config flow.
