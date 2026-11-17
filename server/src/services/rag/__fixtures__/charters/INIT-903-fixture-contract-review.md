---
initiativeId: INIT-903
name: Fixture Contract Review Assistant
businessUnit: Legal
---

# Fixture Contract Review Assistant

TEST FIXTURE ONLY. Not project data. The Scope section is deliberately long so ingestion has to split it on paragraph boundaries.

## Objective

Flag unusual clauses in supplier contracts for legal review.

## Scope

The assistant reviews supplier contracts written in English, including master service agreements, statements of work and non-disclosure agreements. It highlights clauses that differ from the approved legal templates, such as unlimited liability, automatic renewal without notice, unusual payment terms and jurisdiction outside approved regions. Each highlighted clause links back to the template clause it differs from, so a lawyer can compare the two quickly.

Out of scope for the first phase are customer contracts, employment contracts and any contract written in a language other than English. The assistant does not approve or reject contracts; it only prepares a review list. Final decisions stay with the legal team, and every suggestion is recorded so that the team can see which suggestions were accepted or overridden.

The pilot covers the procurement team in one region. If lawyers find the highlighted clauses useful, the scope will extend to other regions and contract types. Integration with the document management system is required before any wider rollout, because lawyers currently download contracts by hand before review.

### Data handling

Contracts are processed inside the company network. No contract text is sent to external services without approval from the data protection office.

## Risks

Lawyers may not trust automated clause detection without seeing the reasoning behind each flag.
