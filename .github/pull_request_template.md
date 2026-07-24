## What this changes

-

## UI changes: the five-question design test (product law, CLAUDE.md)

Every screen must answer at least one of the following. If this PR touches UI, state which:

- [ ] How am I?
- [ ] What matters today?
- [ ] What should I do next?
- [ ] What is Riley noticing?
- [ ] What has helped me before?

A screen that answers none of these does not ship. The dashboard should feel like a decision
has already been made for the member - never like a checklist requiring energy to organize.

## Checks

- [ ] `node scripts/check-messaging.js` passes
- [ ] Hyphens only in member-facing copy; no urgency language; no streak shame
- [ ] Crisis suppression respected on any new surface
