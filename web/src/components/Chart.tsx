import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { RunResult, Viz } from "../api/types";

/** Build an ECharts option from a metric result + its viz config. */
function buildOption(result: RunResult, viz: Viz): echarts.EChartsOption {
  const xField = viz.xField ?? result.columns[0];
  const yFields = viz.yFields.length
    ? viz.yFields
    : result.columns.filter((c) => c !== xField);

  const categories = result.rows.map((r) => String(r[xField ?? ""] ?? ""));
  const series: echarts.SeriesOption[] = yFields.map((field) => ({
    name: field,
    type: viz.type === "bar" ? "bar" : "line",
    data: result.rows.map((r) => Number(r[field] ?? 0)),
    smooth: viz.type === "line",
  }));

  return {
    tooltip: { trigger: "axis" },
    legend: { show: yFields.length > 1, top: 0 },
    grid: { left: 48, right: 16, top: 32, bottom: 40 },
    xAxis: { type: "category", data: categories },
    yAxis: { type: "value" },
    series,
  };
}

export function Chart({ result, viz }: { result: RunResult; viz: Viz }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(buildOption(result, viz), true);
  }, [result, viz]);

  return <div ref={ref} style={{ width: "100%", height: 280 }} />;
}

/** Fallback tabular rendering for table viz or when no chart fields apply. */
export function ResultTable({ result }: { result: RunResult }) {
  return (
    <div style={{ overflow: "auto", maxHeight: 280 }}>
      <table className="data-table">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {result.columns.map((c) => (
                <td key={c}>{String(row[c] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
