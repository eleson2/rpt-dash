import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rptdash-model-"));

const { meta } = await import("../src/db/metadata.js");
const { getDatasetModel, setDatasetModel, seedDatasetDefaults } = await import("../src/ingest/model.js");

function seedDatasetRow(name: string) {
  meta
    .prepare(
      `INSERT INTO datasets (id, name, source_path, format, kind, columns, row_estimate)
       VALUES (@id, @name, '/x.parquet', 'parquet', 'table', '[]', 0)`,
    )
    .run({ id: name, name });
}

const smf70Cols = [
  { name: "system_id", type: "VARCHAR" },
  { name: "sysplex_name", type: "VARCHAR" },
  { name: "interval_start_ts", type: "TIMESTAMP" },
  { name: "smf_timestamp", type: "TIMESTAMP" },
  { name: "cp_count", type: "UINTEGER" },
];

test("seedDatasetDefaults infers family, description, and conformed keys", () => {
  seedDatasetRow("SMF70");
  seedDatasetDefaults("SMF70", smf70Cols);

  const m = getDatasetModel("SMF70");
  assert.equal(m.family, "CPU");
  assert.match(m.description!, /CPU activity/i);
  assert.deepEqual(
    m.keys.map((k) => `${k.column}:${k.role}`).sort(),
    ["interval_start_ts:interval", "smf_timestamp:time", "sysplex_name:sysplex", "system_id:system"],
  );
});

test("seedDatasetDefaults does not overwrite admin edits", () => {
  seedDatasetRow("SMF72");
  setDatasetModel("SMF72", {
    description: "my custom description",
    family: "Workload",
    keys: [{ column: "system_id", role: "system" }],
  });

  // A later registration re-seeds; existing values must be preserved.
  seedDatasetDefaults("SMF72", smf70Cols);

  const m = getDatasetModel("SMF72");
  assert.equal(m.description, "my custom description");
  assert.equal(m.family, "Workload");
  assert.deepEqual(m.keys, [{ column: "system_id", role: "system", label: "system_id" }]);
});

test("unknown datasets default to family Other with no record description", () => {
  seedDatasetRow("my_upload");
  seedDatasetDefaults("my_upload", [{ name: "amount", type: "DOUBLE" }]);
  const m = getDatasetModel("my_upload");
  assert.equal(m.family, "Other");
  assert.equal(m.description, null);
  assert.deepEqual(m.keys, []); // none of the conformed columns are present
});

test("setDatasetModel round-trips description, family, and keys", () => {
  seedDatasetRow("SMF30");
  setDatasetModel("SMF30", {
    description: "jobs",
    family: "Address space",
    keys: [
      { column: "system_id", role: "system" },
      { column: "smf_timestamp", role: "time" },
    ],
  });
  const m = getDatasetModel("SMF30");
  assert.equal(m.description, "jobs");
  assert.equal(m.family, "Address space");
  assert.equal(m.keys.length, 2);
});
