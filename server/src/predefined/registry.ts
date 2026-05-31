import { cpuByServiceClass } from "./cpuByServiceClass.js";
import type { PredefinedReport } from "./types.js";

/** All predefined parameterized reports, keyed by id. */
export const predefinedReports: PredefinedReport[] = [cpuByServiceClass];

export function getPredefinedReport(id: string): PredefinedReport | undefined {
  return predefinedReports.find((r) => r.id === id);
}
