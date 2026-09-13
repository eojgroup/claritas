import { query, withTransaction } from "../db";
import { matchSocialEvent, socialTopicWords } from "./social-matching";

export type SocialEventContext = {
  event_id: string; signal_id: number; platform: string; text: string; url: string;
  author: string; posted_at: string; matched_terms: string[];
  classification: "unverified_social_claim"; assessment_boundary: string;
};

const NOTICE = "Attributed social claim, not independent corroboration. Topic and time alignment does not establish truth, causation, or the author's location. Do not raise event confidence from this post.";

async function recentEvents() {
  return (await query<{ id: string; title: string; start_time: string; last_activity_time: string; country_name: string | null; location_name: string | null }>(
    `SELECT event.id,event.title,event.start_time,event.last_activity_time,country.name AS country_name,location.canonical_name AS location_name
     FROM intelligence_event event LEFT JOIN country ON country.iso2=event.primary_country_iso2
     LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     WHERE event.status IN ('active','emerging','monitoring') AND event.last_activity_time > now()-interval '7 days'
     ORDER BY event.relevance_score DESC,event.last_activity_time DESC LIMIT 100`,
  )).rows;
}

export async function socialEventDiscoveryQueries(): Promise<string[]> {
  return [...new Set((await recentEvents()).slice(0, 8)
    .map((event) => socialTopicWords(event.title).slice(0, 5).join(" "))
    .filter((value) => value.split(" ").length >= 3))];
}

export async function refreshSocialEventContext(): Promise<number> {
  const [events, posts] = await Promise.all([
    recentEvents(),
    query<{ id: string; content_text: string; posted_at: string }>(
      `SELECT id,content_text,posted_at FROM social_signal
       WHERE expires_at > now() AND posted_at > now()-interval '7 days'
       ORDER BY posted_at DESC LIMIT 5000`,
    ),
  ]);
  const links = events.flatMap((event) => posts.rows.flatMap((post) => {
    const terms = matchSocialEvent({ text: post.content_text, postedAt: post.posted_at }, {
      title: event.title, startTime: event.start_time, lastActivityTime: event.last_activity_time,
      countryName: event.country_name, locationName: event.location_name,
    });
    return terms.length ? [{ event_id: event.id, signal_id: post.id, matched_terms: terms }] : [];
  }));
  await withTransaction(async (client) => {
    // Replace the evaluated set so edited posts/titles cannot retain stale links.
    await client.query(`DELETE FROM social_event_context WHERE event_id=ANY($1::uuid[])`, [events.map((event) => event.id)]);
    await client.query(`INSERT INTO social_event_context(event_id,signal_id,matched_terms)
      SELECT event_id,signal_id,matched_terms FROM jsonb_to_recordset($1::jsonb)
      AS link(event_id uuid,signal_id bigint,matched_terms jsonb)
      ON CONFLICT (event_id,signal_id) DO UPDATE SET matched_terms=EXCLUDED.matched_terms`, [JSON.stringify(links)]);
  });
  return links.length;
}

export async function getSocialEventContexts(eventIds: string[]): Promise<SocialEventContext[]> {
  if (!eventIds.length) return [];
  const { rows } = await query<Omit<SocialEventContext, "classification" | "assessment_boundary">>(
    `SELECT event_id,signal_id,platform,content_text AS text,url,
            responsible_party_name AS author,posted_at,matched_terms
     FROM (SELECT link.*,ss.platform,ss.content_text,ss.url,ss.responsible_party_name,ss.posted_at,
             row_number() OVER (PARTITION BY link.event_id ORDER BY ss.posted_at DESC,ss.id DESC) AS rank
           FROM social_event_context link JOIN social_signal ss ON ss.id=link.signal_id
           WHERE link.event_id=ANY($1::uuid[]) AND ss.expires_at > now()) ranked
     WHERE rank <= 5 ORDER BY event_id,posted_at DESC`, [eventIds],
  );
  return rows.map((row) => ({ ...row, text: row.text.slice(0, 1200), classification: "unverified_social_claim", assessment_boundary: NOTICE }));
}
