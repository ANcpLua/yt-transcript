# Repository instructions

- At the start of repository work, check the recorded credential expiry dates
  and known release blockers. Follow [Publishing maintenance](README.md#publishing-maintenance)
  when anything is due, a store needs attention, or publishing is requested.
  Carry out routine next steps within the user's authorization without asking
  "should I?"; surface actionable reminders and ask only for information or
  access that cannot be obtained independently.
- Before changing code, read the [development rules](README.md#development).
- For releases, store retries, listing edits, or credential renewal, read
  [Release](README.md#release), [Stores](README.md#stores), and
  [Expiry dates](README.md#expiry-dates). Follow their preflight checks and
  report each store's outcome separately.
- Store IDs and version paths belong in `store.config.json`; workflow inputs
  belong in `.github/workflows/`. Keep the README aligned when either changes.
