"use client";
import { useEffect, useState } from "react";

type Report = {
  id: string;
  depth: number;
  elo: number | null;
  fens: string;
  sans: string;
  evals: string;
  tags: string;
  accuracy: number;
};

export default function LatestReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/report/latest');
        if (!res.ok) throw new Error('Not found');
        const json = await res.json();
        setReport(json);
      } catch (e: any) {
        setError(e?.message || 'Failed to load');
      }
    })();
  }, []);

  if (error) return <div className="p-6">{error}</div>;
  if (!report) return <div className="p-6">Loading…</div>;

  const sans = JSON.parse(report.sans) as string[];
  const evals = JSON.parse(report.evals) as number[];
  const tags = JSON.parse(report.tags) as string[];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Post-match report</h1>
      <div className="text-sm text-gray-600">Depth {report.depth}{report.elo ? ` • Elo ${report.elo}` : ''} • Accuracy {report.accuracy.toFixed(1)}%</div>
      <div className="border rounded p-3">
        <div className="font-medium mb-2">Annotated moves</div>
        <ol className="list-decimal pl-5 space-y-1">
          {sans.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="min-w-[4rem] text-xs text-gray-500">{(evals[i]/100).toFixed(2)}</span>
              <span>{s}</span>
              {tags[i] && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">{tags[i]}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}


