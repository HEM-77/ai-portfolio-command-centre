# Ingestion test fixture (synthetic)

TEST DATA ONLY. Not Nimbus data and not from the evaluation material. Initiative IDs NMB-901..903
and NMB-999 do not exist in the official dataset.

The rows mirror the messy variants seen in the official files (ID spellings, four date formats,
month and quarter periods, `$60,000`-style values, blanks, EUR and "USD thousands", an exact
duplicate) and add one bad row of each kind ingestion must reject. Expected results are asserted
in `../ingest/records.test.ts` and `../ingest/ingest.test.ts`.
