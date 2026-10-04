import type { CountryLeadership } from "../lib/api";

export function electionDateLabel(election: NonNullable<CountryLeadership["elections"]>[number]) {
  const date = new Date(`${election.date}T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", timeZone: "UTC",
    ...(election.date_precision !== "year" ? { month: "short" as const } : {}),
    ...(election.date_precision === "day" ? { day: "numeric" as const } : {}),
  }).format(date);
}

export default function CountryElections({ profile }: { profile?: CountryLeadership | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const elections = [...(profile?.elections ?? [])].sort((a, b) => {
    const aPast = a.date < today; const bPast = b.date < today;
    return aPast !== bPast ? Number(aPast) - Number(bPast) : aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });
  return <section className="country-elections" aria-label="Election calendar">
    <h4>Election calendar</h4>
    <p>Reported election dates · schedules can change. A past date does not confirm a completed vote.</p>
    {elections.length ? <ol>{elections.slice(0, 12).map((election) => <li key={`${election.id}:${election.date}`}>
      <time dateTime={election.date_precision === "year" ? election.date.slice(0, 4) : election.date_precision === "month" ? election.date.slice(0, 7) : election.date}>{electionDateLabel(election)}</time>
      <div><a href={election.source_url} target="_blank" rel="noreferrer">{election.title}</a>
        <small>{election.election_type} · {election.date_precision !== "day" ? "Approximate date" : election.date === today ? "Scheduled today" : election.date > today ? "Upcoming" : "Past scheduled date"}</small>
      </div>
    </li>)}</ol> : <p className="product-state">{profile?.elections_retrieved_at ? "No election dates are listed in the current source window. This does not mean the country holds no elections." : "Election calendar has not been retrieved yet."}</p>}
    {profile?.elections_retrieved_at && <small>Wikidata · CC0 · Checked {new Date(profile.elections_retrieved_at).toLocaleDateString()}</small>}
  </section>;
}
