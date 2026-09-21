import { query } from "../db";

/** Bounded observed flight context; never infer a cancellation from absent ADS-B samples. */
export async function attachAirportTransportContext(eventId: string): Promise<number> {
  const result = await query(`INSERT INTO intelligence_event_evidence (
      event_id,domain,evidence_type,source_record_type,source_record_id,
      observed_at,location_id,confidence,relationship,provenance,attribution,correlation_score,correlation_factors,metadata)
    SELECT event.id,'transport','nearby_flight_observation','airport_flight',flight.id::text,
      flight.observed_at,location.id,0.6,'context',
      jsonb_build_object('provider',flight.source_name,'entity_id',flight.entity_id),
      flight.source_name,0.6,
      jsonb_build_object('decision','attached','association_type','contextual','rationale',
        'Flight observed within 10 km of the named airport and six hours of the report; not cancellation confirmation.'),
      jsonb_build_object('title','Flight activity near ' || location.canonical_name,
        'description',concat_ws(' ',COALESCE(flight.callsign,flight.flight_number,flight.entity_id),
          'was observed near the airport.',
          'Tracking coverage cannot establish whether a flight was cancelled or delayed.'),
        'radius_km',10,'window_hours',6,'source_name',flight.source_name)
    FROM intelligence_event event
    JOIN intelligence_location location ON location.id=event.primary_location_id AND location.location_type='airport'
    CROSS JOIN LATERAL (
      SELECT snapshot.* FROM transport_snapshot snapshot
      WHERE snapshot.mode='aviation'
        AND snapshot.observed_at BETWEEN event.start_time-interval '6 hours' AND event.start_time+interval '6 hours'
        AND snapshot.latitude IS NOT NULL AND snapshot.longitude IS NOT NULL
        AND snapshot.latitude BETWEEN location.latitude-0.1 AND location.latitude+0.1
        AND ST_DWithin(ST_SetSRID(ST_MakePoint(snapshot.longitude,snapshot.latitude),4326)::geography,location.center,10000)
      ORDER BY snapshot.observed_at DESC, snapshot.id LIMIT 10
    ) flight
    WHERE event.id=$1::uuid AND event.event_type='aviation_disruption' AND event.status <> 'dismissed'
    ON CONFLICT (event_id,domain,source_record_type,source_record_id) DO NOTHING
    RETURNING id`, [eventId]);
  // Context must not increase confidence, severity or claim cancellation counts.
  if (result.rows.length) await query(`UPDATE intelligence_event SET domain_count=(
    SELECT count(DISTINCT domain) FROM intelligence_event_evidence WHERE event_id=$1::uuid
  ),updated_at=now() WHERE id=$1::uuid`, [eventId]);
  return result.rows.length;
}
