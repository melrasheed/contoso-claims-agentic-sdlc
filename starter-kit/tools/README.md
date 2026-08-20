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
