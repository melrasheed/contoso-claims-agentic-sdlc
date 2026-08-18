# Starter kit — Pipelines

Copy the `pipelines/` directory from the reference implementation root into your repository.

The pipeline YAML is app-agnostic. The following items require customer-specific configuration:

## Required changes

### Variable group names
The pipeline references three variable groups. Rename them to match your project, or keep the names from the reference implementation:
- `agentic-sdlc-common`
- `agentic-sdlc-dev`
- `agentic-sdlc-prod`

### Service connection name
The pipeline references `azure-svc-connection`. Create this in Azure DevOps Project Settings → Service connections, or rename it in `azure-pipelines.yml`.

### Node version
The pipeline uses Node 20. Change the `nodeVersion` variable if your application requires a different version.

### Build commands
The Build stage runs `npm ci && npm run lint && npm run typecheck && npm test && npm run build`. Adjust these for your application's build process.

### Application-specific app settings
The DeployDev and DeployProd templates set application settings on the App Service. Update these to match your application's environment variable requirements.

## What does not need changing

- The six-stage structure (Build → SecurityScan → DeployDev → VerifyDev → DeployProd → PostDeploy)
- The gate configuration (Business Hours, Exclusive Lock, Query Work Items, Approvals)
- The staging slot → health check → swap → rollback pattern
- The OIDC service connection approach

## Reference

See `docs/04-release-gates.md` in the reference implementation for the full pipeline documentation.
