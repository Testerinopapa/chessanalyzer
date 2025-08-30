"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function ReportById(props: { params: Promise<{ id: string }> }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      // Await dynamic params per Next.js guidance
      if (!reportId) {
        try { const p = await props.params; setReportId(p.id); } catch { setReportId(null); }
      }
      if (!reportId) return;
      try {
        const res = await fetch(`/api/report/${reportId}`);
        setOk(res.ok);
      } catch { setOk(false); }
    })();
  }, [props.params, reportId]);
  if (ok === null) return <div className="p-6">Loading…</div>;
  if (ok === false) return <div className="p-6">Report not found. <Link className="underline" href="/report/latest">Go to latest</Link></div>;
  if (ok) {
    // Reuse latest page but param-driven; simple redirect client-side
    if (typeof window !== 'undefined') window.location.href = "/report/latest";
    return <div className="p-6">Opening report…</div>;
  }
  return null;
}


