# License Generator

This CLI creates a signed `license.json` file that unlocks the controller's Safe action.

## Generate

```bash
cd license-generator
npm run generate -- --name "Customer Name" --out ../license.json --expires 2027-12-31
npm run generate -- --name "PIStar" --out ../license.json --expires 2027-12-31
```

## Format

The app verifies these fields:

- `appId`
- `issuedTo`
- `issuedAt`
- `expiresAt`
- `features`
- `signature`

The `safe` feature must be present for the Safe quadrant to become active.
