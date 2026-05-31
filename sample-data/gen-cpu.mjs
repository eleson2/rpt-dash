// Generates sample-data/cpu_by_service_class.csv:
//   ts, lpar, service_class, cpu   (hourly samples, two LPARs)
// Deterministic (no RNG) so tests and demos are stable. Run: node gen-cpu.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const LPARS = ["PRODA", "PRODB"];
const CLASSES = ["SYSTEM", "STC", "TSO", "ONLINE", "BATCH", "DDF"];
const DAYS = 3; // 2026-05-01 .. 2026-05-03
const START = Date.UTC(2026, 4, 1, 0, 0, 0); // month is 0-based

// Per-class CPU shape as a function of hour-of-day; diurnal patterns differ.
function cpuFor(cls, lpar, hour) {
  const biz = hour >= 8 && hour <= 18 ? 1 : 0; // business hours
  const night = hour < 6 || hour >= 22 ? 1 : 0;
  const lparBoost = lpar === "PRODA" ? 1.0 : 0.7; // PRODA is busier
  let base;
  switch (cls) {
    case "SYSTEM": base = 4 + (hour % 3); break;
    case "STC": base = 6 + 2 * Math.sin(hour / 4); break;
    case "TSO": base = 2 + 10 * biz; break;
    case "ONLINE": base = 5 + 25 * biz + 3 * Math.sin((hour - 8) / 3); break;
    case "BATCH": base = 8 + 30 * night + 6 * (1 - biz); break;
    case "DDF": base = 3 + 14 * biz; break;
    default: base = 5;
  }
  return Math.max(0, Math.round(base * lparBoost * 100) / 100);
}

const rows = ["ts,lpar,service_class,cpu"];
for (let d = 0; d < DAYS; d++) {
  for (let h = 0; h < 24; h++) {
    const t = new Date(START + (d * 24 + h) * 3600_000);
    const ts = t.toISOString().slice(0, 19).replace("T", " ");
    for (const lpar of LPARS) {
      for (const cls of CLASSES) {
        rows.push(`${ts},${lpar},${cls},${cpuFor(cls, lpar, h)}`);
      }
    }
  }
}

const out = join(import.meta.dirname, "cpu_by_service_class.csv");
writeFileSync(out, rows.join("\n") + "\n");
console.log(`Wrote ${rows.length - 1} rows to ${out}`);
