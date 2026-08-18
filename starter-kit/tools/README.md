# Starter kit — Tools

## ado-bootstrap

Copy `tools/ado-bootstrap/` from the reference implementation. This script is fully app-agnostic — it detects the ADO process template and adapts automatically.

The only changes needed are the sample backlog items (work item titles and descriptions), which the `bootstrap.ps1` script creates. Edit the work item creation section at the bottom of the script to match your project.

Usage:
```powershell
.\tools\ado-bootstrap\bootstrap.ps1 `
    -Organization <your-ado-org> `
    -Project "<your-project>"
```

## ado-github-bridge

Copy `tools/ado-github-bridge/` from the reference implementation. The bridge is fully app-agnostic — all configuration is via environment variables.

Required environment variables:

| Variable | Purpose |
|---|---|
| `ADO_ORG` | Azure DevOps organisation name |
| `ADO_PROJECT` | Azure DevOps project name |
| `GH_OWNER` | GitHub organisation or user |
| `GH_REPO` | GitHub repository name |
| `GITHUB_TOKEN` | GitHub PAT (repo + issues scopes) |

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `ADO_PAT` | (uses Entra ID) | ADO Personal Access Token |
| `BRIDGE_READY_TAG` | `ai-ready` | Tag that marks items ready to sync |
| `BRIDGE_SYNCED_TAG` | `synced-to-github` | Tag applied after successful sync |
| `BRIDGE_ASSIGN_COPILOT` | `true` | Assign GitHub Copilot coding agent |
| `BRIDGE_STATE_AFTER_SYNC` | `Committed` | ADO state after sync |
| `BRIDGE_MAX_ITEMS` | `25` | Maximum items per run |
| `BRIDGE_DRY_RUN` | `false` | Preview without writing |

Usage:
```powershell
# Check connectivity
node tools/ado-github-bridge/dist/cli.js doctor

# Dry run
node tools/ado-github-bridge/dist/cli.js sync --dry-run

# Sync all ai-ready items
node tools/ado-github-bridge/dist/cli.js sync

# Sync specific items
node tools/ado-github-bridge/dist/cli.js sync 42 43
```
