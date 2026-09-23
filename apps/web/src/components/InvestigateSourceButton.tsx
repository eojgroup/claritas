import { useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { resolveSourceInvestigation } from "../lib/api";

export default function InvestigateSourceButton({ domain, sourceRecordType, sourceRecordId, onOpen }: {
  domain: string; sourceRecordType: string; sourceRecordId: string; onOpen: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const investigate = async () => {
    if (pending) return;
    setPending(true); setNotice(null);
    try {
      const result = await resolveSourceInvestigation({ domain, source_record_type: sourceRecordType, source_record_id: sourceRecordId });
      if (result.status === "available" && result.event_id) onOpen(result.event_id);
      else setNotice(result.reason || (result.status === "pending" ? "This source is awaiting event assessment. Try again after the next update." : "This source does not yet contain enough event detail to open an investigation."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to open this investigation. Please retry.");
    } finally { setPending(false); }
  };
  return <div className="source-investigate-action"><button type="button" disabled={pending} onClick={() => void investigate()}>{pending ? <LoaderCircle className="animate-spin" size={14} /> : <ArrowUpRight size={14} />}{pending ? "Finding related signals…" : "Investigate this source"}</button>{notice && <p role="status">{notice}</p>}</div>;
}
