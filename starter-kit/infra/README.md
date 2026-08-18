# Starter kit — Infrastructure

Copy the `infra/` directory from the reference implementation root into your repository.

The Bicep is parameterised and app-agnostic. The following items require customer-specific configuration.

## Parameters to update

Update `infra/main.parameters.json` (dev) and `infra/main.parameters.prod.json` (prod):

| Parameter | Default | Description |
|---|---|---|
| `namePrefix` | `contoso` | Replace with your prefix (max 10 chars) |
| `alertEmailAddress` | `ops-team@example.com` | Replace with your ops team email |
| `location` | `eastus` | Replace with your Azure region |

## Application settings

In `infra/modules/appservice.bicep`, the `appSettings` array includes settings specific to the Contoso Claims application. Update these for your application:
- `APPLICATIONINSIGHTS_CONNECTION_STRING` — keep this (emitted as an output)
- `NODE_ENV` — keep this
- `LOG_LEVEL` — keep this
- `ADMIN_ENABLED` — remove this (it is Contoso Claims specific)

## What does not need changing

- The App Service Plan (B1/S1), staging slot logic, and SKU auto-promotion for slots
- The Log Analytics workspace and Application Insights module
- The Azure Monitor alert rules (5xx and P95 latency)
- The user-assigned managed identity pattern
- The `deploy.ps1` and `teardown.ps1` scripts
- The SRE Agent module

## Parameters reference

| Parameter | Values | Notes |
|---|---|---|
| `namePrefix` | String, max 10 chars | Used in all resource names |
| `environmentName` | `dev` or `prod` | Used in resource names and tags |
| `sku` | `B1`, `S1`, `P1v3` | Overridden to S1 when `enableSlots=true` |
| `enableSlots` | `true` / `false` | Enables staging slot (requires S1+) |
| `adminEnabled` | `true` / `false` | Enable admin endpoint (Contoso-specific — remove) |
| `enableSreAgent` | `true` / `false` | Deploy the Azure SRE Agent |
| `sreAgentMode` | `Review` / `Automatic` | Default: `Review` |

## Reference

See `docs/06-sre-runbook.md` in the reference implementation for SRE Agent deployment documentation.
