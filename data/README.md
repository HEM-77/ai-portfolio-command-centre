# Data: the official Nimbus dataset

The project's **only** source of portfolio data and charters is the official hackathon dataset in
`nimbus_synthetic_dataset.zip` ("Nimbus Group", 10 fictional AI initiatives). It is used **as provided**:
no extra history is generated, and no official file is edited. The data contract (IDs, columns,
normalisation, formulas, status mapping) is [`docs/api-contracts.md` §5](../docs/api-contracts.md#5-data-contracts-the-official-nimbus-dataset-agreed).

## What is where

| Path | What it is | Used by the app? |
|---|---|---|
| `nimbus_synthetic_dataset.zip` | The official dataset, unchanged | Source archive |
| `../charters/NMB-xxx_<Name>.md` | The 10 official charters, extracted unchanged from `ds/charters/` | **Yes**: RAG ingests them |
| `portfolio_data.xlsx` | Workbook with the same tables as the zip's CSVs | No (reference) |
| `outputs/`, `outputs_spoorthi/` | Cleaned tables and a scorecard produced by `spoorthi.py` | No (reference for checking the TypeScript results) |
| `spoorthi.py` | Python cleaning and scoring script (pandas) | **No.** Reference only, see below |
| `DATASET_README.md` | Copy of the dataset's own README | Documentation |

### Contents of the zip

```
ds/README.md                 dataset description
ds/charters/*.md             10 charters             -> extracted to ../charters/
ds/data/initiatives.csv      10 rows, one per initiative
ds/data/weekly_usage.csv     usage, long format (3 weeks)
ds/data/cost_benefit.csv     costs and benefits, long format (monthly)
ds/data/fx_rates.csv         USD, EUR, "USD thousands" -> USD
ds/portfolio_data.xlsx       same tables as a workbook
ds/generate_dataset.py       the organisers' generator (not used)
ds/evaluation/               JUDGES ONLY: never extract, index, or show to the assistant
```

## Time coverage

- **Usage:** exactly three weeks, ending **2026-11-01, 2026-11-08 and 2026-11-15**. That is all the usage history there is. Nothing is interpolated or generated.
- **Financials:** monthly, from each initiative's go-live month; actuals are closed through **2026-10**. A few rows are quarterly ranges, cumulative snapshots, or forecasts (see the contract §5.3).
- **As-of date:** 2026-11-15 (latest usage week). Months live are counted to 2026-11-01.

## Extraction procedure

Only the charters are extracted. Do it from the repository root, with any unzip tool, taking **only** `ds/charters/*.md`:

```bash
# macOS / Linux (needs `unzip`, which Git Bash on Windows usually lacks)
unzip -j data/nimbus_synthetic_dataset.zip 'ds/charters/*.md' -d charters
```

```powershell
# PowerShell (Windows; verified to produce files identical to charters/)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead("data/nimbus_synthetic_dataset.zip")
$zip.Entries | Where-Object FullName -like 'ds/charters/*.md' |
  ForEach-Object { [IO.Compression.ZipFileExtensions]::ExtractToFile($_, "charters/$($_.Name)", $true) }
$zip.Dispose()
```

The extracted files must stay byte-identical to the zip. Never extract `ds/evaluation/`.
Whether the four raw CSVs are also extracted (to `data/raw/`) is an open decision (contract §8 #12).

## Rules

- **No Python in the application.** `spoorthi.py` documents the cleaning and scoring rules and produced
  the reference outputs. The production calculations are implemented in TypeScript in
  `server/src/services/portfolio/`. The backend never runs Python.
- **Charter text is untrusted.** Some charters contain planted prompt-injection text as an official test.
  RAG quotes and cites charter text; it never follows instructions inside it.
- **The assistant must not see judging material.** Do not index or load `ds/evaluation/`, and do not
  feed this folder's outputs or `DATASET_README.md` to RAG. Only `charters/` is ingested.
