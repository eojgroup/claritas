import { useState } from "react";
import { Activity, Database, Users } from "lucide-react";
import AdminIngestionPanel from "./AdminIngestionPanel";
import AdminIntelligencePanel from "./AdminIntelligencePanel";
import AdminUserManagementPanel from "./AdminUserManagementPanel";

type Props = { dark: boolean };
type Section = "health" | "ingestion" | "access";

const sections: Array<{ id: Section; label: string; description: string; icon: typeof Activity }> = [
  { id: "health", label: "System health", description: "Signals, imagery, providers, and delivery", icon: Activity },
  { id: "ingestion", label: "Data feeds", description: "Scheduled and manual source ingestion", icon: Database },
  { id: "access", label: "Users & access", description: "Roles, accounts, and subscriptions", icon: Users },
];

export default function AdminWorkspace({ dark }: Props) {
  const [section, setSection] = useState<Section>("health");
  return (
    <div className="workspace-page control-room-page min-w-0 space-y-4">
      <section className="control-room-intro">
        <div><span>Admin</span><strong>Operate one area at a time.</strong></div>
        <div className="control-room-state"><span className="live-dot" />Authenticated administrator</div>
      </section>
      <nav className="grid gap-2 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-2 md:grid-cols-3" aria-label="Administration sections">
        {sections.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return <button key={item.id} type="button" onClick={() => setSection(item.id)} aria-current={active ? "page" : undefined} className={`flex items-start gap-3 rounded-lg p-3 text-left ${active ? "bg-[color:var(--shell-bg)] text-[color:var(--shell-ink)] shadow-sm" : "text-[color:var(--shell-muted)] hover:bg-[color:var(--shell-bg)]"}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><span><strong className="block text-sm">{item.label}</strong><small className="mt-1 block text-xs font-normal">{item.description}</small></span></button>;
        })}
      </nav>
      {section === "health" && <AdminIntelligencePanel />}
      {section === "ingestion" && <AdminIngestionPanel dark={dark} />}
      {section === "access" && <AdminUserManagementPanel />}
    </div>
  );
}
