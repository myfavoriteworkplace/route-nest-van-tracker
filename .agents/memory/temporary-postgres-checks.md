---
name: Temporary PostgreSQL checks
description: Container-specific detail for disposable local PostgreSQL validation.
---

When starting a throwaway PostgreSQL cluster in this workspace, explicitly set its Unix socket directory to the cluster's temporary directory. The default `/run/postgresql` directory is absent here and prevents startup.

**Why:** A disposable migration test failed at startup because PostgreSQL could not create its default socket lock file; using a temporary socket directory allowed the cluster to start.

**How to apply:** Set PostgreSQL's socket directory (for example, with `-k "$CHECKDIR"`) whenever initializing a temporary local cluster. Keep the cluster and its data under a temporary path, not the project or any managed/production database.
