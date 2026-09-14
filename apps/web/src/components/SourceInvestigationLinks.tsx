import { ArrowUpRight, GitCompareArrows, MapPin } from "lucide-react";
import type { SourceInvestigationLink } from "../lib/api";

export default function SourceInvestigationLinks({ links = [], onOpenEvent, onOpenMap }: {
  links?: SourceInvestigationLink[];
  onOpenEvent?: (id: string) => void;
  onOpenMap?: () => void;
}) {
  return <section className="mt-4 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3" aria-label="Investigation connections">
    <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--shell-ink)]"><GitCompareArrows className="h-4 w-4" />Put this source in context</div>
    <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">{links.length ? "Open the investigation to compare reporting, observations, and claims before using them in a conclusion." : "No investigation has been matched yet. Explore the map for related evidence; this source alone does not establish an event."}</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {links.slice(0, 4).map((link) => <button key={link.id} title={link.rationale} type="button" onClick={() => onOpenEvent?.(link.id)} className="flex min-h-12 items-center gap-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-left hover:border-[color:var(--shell-accent)]">
        <MapPin className="h-4 w-4 shrink-0 text-[color:var(--shell-accent)]" />
        <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{link.title}</span><span className="mt-1 block text-[11px] text-[color:var(--shell-muted)]">Open investigation{link.country_iso2 ? ` · ${link.country_iso2}` : ""}</span></span>
        <ArrowUpRight className="h-4 w-4 shrink-0" />
      </button>)}
    </div>
    {!links.length && onOpenMap && <button type="button" onClick={onOpenMap} className="mt-2 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[color:var(--shell-ink)]">Explore the signal map <ArrowUpRight className="h-4 w-4" /></button>}
  </section>;
}
