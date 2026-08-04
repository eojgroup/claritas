import { query } from "../db";

const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active";

type NwsFeature = {
  id?: string;
  properties?: {
    id?: string; senderName?: string; event?: string; severity?: string; urgency?: string; certainty?: string;
    effective?: string; onset?: string; expires?: string; ends?: string; headline?: string;
    description?: string; instruction?: string; areaDesc?: string; affectedZones?: string[];
  };
};

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('nws', 'https://api.weather.gov', 'none', $1::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url=EXCLUDED.api_base_url, metadata=EXCLUDED.metadata
     RETURNING id`,
    [JSON.stringify({
      provider: "nws", source_kind: "official_weather_alerts", country_scope: "US",
      attribution: "NOAA/National Weather Service", attribution_url: "https://www.weather.gov/",
      license: "U.S. government public domain unless specifically noted",
      terms_url: "https://www.weather.gov/disclaimer/",
    })]
  );
  return rows[0].id;
}

export async function ingestNwsAlerts(): Promise<Record<string, unknown>> {
  const userAgent = process.env.NWS_USER_AGENT?.trim() || process.env.SEC_EDGAR_USER_AGENT?.trim() || "Claritas contact@claritas.info";
  const response = await fetch(NWS_ALERTS_URL, {
    headers: { accept: "application/geo+json", "user-agent": userAgent },
  });
  if (!response.ok) throw new Error(`NWS alerts API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as { features?: NwsFeature[] };
  const sourceId = await ensureSource();
  await query(`INSERT INTO country (iso2,name) VALUES ('US','United States') ON CONFLICT (iso2) DO NOTHING`);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const feature of data.features ?? []) {
    const props = feature.properties ?? {};
    const externalId = props.id || feature.id;
    if (!externalId || !props.event) { skipped += 1; continue; }
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO weather_alert (
         source_id,external_id,country_iso2,sender_name,event,severity,urgency,certainty,
         starts_at,ends_at,headline,description,instruction,area,payload
       ) VALUES ($1,$2,'US',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (source_id,external_id,country_iso2) DO UPDATE SET
         sender_name=EXCLUDED.sender_name,event=EXCLUDED.event,severity=EXCLUDED.severity,
         urgency=EXCLUDED.urgency,certainty=EXCLUDED.certainty,starts_at=EXCLUDED.starts_at,
         ends_at=EXCLUDED.ends_at,headline=EXCLUDED.headline,description=EXCLUDED.description,
         instruction=EXCLUDED.instruction,area=EXCLUDED.area,payload=EXCLUDED.payload,updated_at=now()
       RETURNING (xmax = 0) AS inserted`,
      [sourceId,externalId,props.senderName ?? "National Weather Service",props.event,props.severity ?? null,
       props.urgency ?? null,props.certainty ?? null,props.onset ?? props.effective ?? new Date().toISOString(),
       props.ends ?? props.expires ?? null,props.headline ?? props.event,props.description ?? null,
       props.instruction ?? null,props.areaDesc ?? null,
       JSON.stringify({ provider: "nws", affected_zones: props.affectedZones ?? [], attribution: "NOAA/National Weather Service" })]
    );
    if (result.rows[0]?.inserted) inserted += 1; else updated += 1;
  }
  return { provider: "nws", inserted, updated, skipped, alerts_received: data.features?.length ?? 0 };
}
