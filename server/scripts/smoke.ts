/**
 * Standalone smoke test of the DuckDB pipeline (no HTTP):
 * register a CSV as a view, create a parameterized metric, run it.
 * Run with: npm run smoke
 */
import { resolve } from "node:path";
import { registerDataset, listDatasets } from "../src/ingest/upload.js";
import { createMetric } from "../src/metrics/store.js";
import { runMetric } from "../src/metrics/run.js";

const csv = resolve(import.meta.dirname, "../../sample-data/sales.csv");

const dataset = await registerDataset({ name: "sales", format: "csv", absPath: csv });
console.log("registered dataset:", dataset.name, "cols:", dataset.columns.map((c) => c.name).join(","), "rows:", dataset.rowEstimate);
console.log("catalog:", listDatasets().map((d) => d.name));

const metric = createMetric({
  name: "Monthly sales by region",
  sql: `SELECT date_trunc('month', CAST(ts AS DATE)) AS month, sum(amount) AS total
        FROM sales
        WHERE region = $region
        GROUP BY 1 ORDER BY 1`,
  params: [{ name: "region", type: "string", required: true }],
  viz: { type: "line", xField: "month", yFields: ["total"] },
});
console.log("created metric:", metric.id, metric.name);

const result = await runMetric(metric, { region: "North" });
console.log("run result (region=North):");
console.table(result.rows);
console.log("truncated:", result.truncated);

process.exit(0);
