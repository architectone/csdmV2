# Validated Hypothetical CMDB Model

Use this file in the app:

`hypothetical_cmdb_model_VALIDATED_app_compatible.json`

Do not load the full-fidelity reference file unless the application schema is extended first.

## Fix applied

The previous app-compatible model used `Depends on` for the roll-up links from `Application Service` to generated `Infrastructure CI` component islands. The current app schema allows `Application Service --Runs on--> Infrastructure CI`, so those roll-up links were changed to `Runs on`.

## Counts

- Source rows: 1433
- Unique CMDB classes mocked: 347
- App-compatible nodes: 351
- App-compatible edges: 1415
- Component roll-up links: 19
- Validation errors against current app schema: 0

## Relationship label counts in validated app-compatible model

- Connects to: 136
- Contains: 474
- Depends on: 291
- Routes to: 10
- Runs on: 234
- Uses: 267
