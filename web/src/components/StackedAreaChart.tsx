import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { ReportOutput } from "../api/types";

/** Renders a ReportOutput as a stacked area (or line/bar) chart. */
export function StackedAreaChart({
  output,
  height = 380,
  onPointClick,
}: {
  output: ReportOutput;
  height?: number;
  /** Fired when a data point is clicked; enables drilldown when provided. */
  onPointClick?: (p: { category: string; series: string }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Keep the latest handler in a ref so the click listener (bound once) always
  // calls the current closure without re-binding.
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    chart.on("click", (e: { name?: unknown; seriesName?: unknown }) => {
      clickRef.current?.({ category: String(e.name ?? ""), series: String(e.seriesName ?? "") });
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    const stacked = output.chart === "stacked-area";
    const series: echarts.SeriesOption[] = output.series.map((s) => ({
      name: s.name,
      type: output.chart === "bar" ? "bar" : "line",
      stack: stacked || output.chart === "bar" ? "total" : undefined,
      areaStyle: stacked ? {} : undefined,
      emphasis: { focus: "series" },
      showSymbol: false,
      lineStyle: { width: stacked ? 1 : 2 },
      data: s.data,
    }));

    chartRef.current?.setOption(
      {
        tooltip: { trigger: "axis" },
        legend: { top: 0, type: "scroll" },
        grid: { left: 56, right: 20, top: 36, bottom: 60 },
        xAxis: {
          type: "category",
          boundaryGap: output.chart === "bar",
          data: output.categories,
          axisLabel: { hideOverlap: true },
        },
        yAxis: { type: "value", name: output.unit },
        dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 16 }],
        series,
      },
      true,
    );
  }, [output]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
