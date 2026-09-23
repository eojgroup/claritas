# Reviewing signal connections

Web and iOS use the same review pattern: investigation summary, signal-type overview, source detail. The overview separates news, transport, podcasts, markets, Earth observations, model interpretation and social claims. Counts and bars show the composition of available evidence, not confidence. Selecting a type filters the evidence thread. Each source retains its own provenance and matching rationale.

Matching dimensions are disclosed separately: named place, nearby area, shared entity, explicit financial instrument, event topic and timing. Geography is not required for entity/instrument connections. News and podcast extraction recognizes explicit cashtags and exchange-qualified tickers; plain uppercase words are not automatically stock symbols. Matching a broad topic, country or time alone does not create an evidence connection.

Different event topics remain distinct investigations. Strong place-and-proximity or entity/instrument matches can create reciprocal related-event links. Interpretive sources may attach as qualified context; they cannot replace the canonical investigation description. Replaying a source preserves its event identity and re-evaluates related investigations.

Importance retains source and domain diversity, severity, freshness and physical-observation inputs. Related active event types add at most 0.06 relevance (0.02 per distinct type), without raising confidence or severity. Model interpretations and coverage assessments are excluded from independent-source diversity. Context evidence does not raise aggregate confidence. Unverified social claims remain separately labelled and do not count as independent corroboration.

## Nearby reporting

This separate discovery section searches accepted news in the event's subject country within 24 hours either side of its start. It prefers whole-word mentions of the named place among the 100 most recent candidates and shows up to six distinct headlines. The scope label distinguishes “Same named location” from the broader “Same country”; publisher location is not used as article geography. Source chronology may be publication time or discovery time. Already linked articles are excluded. Nearby reporting is never persisted as linked evidence and contributes nothing to importance or confidence.

## Airport review

The Bristol change uses general whole-word location matching and catalogued airport coordinates. Its existing migration is intentionally a narrowly targeted historical repair. Runtime context now uses the shared aggregation policy for all catalogued airports and also supports storms, fire, flood and security investigations anchored at airports. Flights remain bounded to 10 km and six hours either side of the report. Observed traffic does not establish a cancellation or delay. Coverage still depends on the location catalogue and available tracking samples; this change does not introduce a worldwide airport-catalogue import.
