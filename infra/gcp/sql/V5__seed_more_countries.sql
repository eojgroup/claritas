-- Seed additional countries referenced by backfill jobs
-- Safe to run multiple times

INSERT INTO country (iso2, iso3, name, region, centroid, ext) VALUES
  ('FI', NULL, 'Finland', 'Europe', NULL, '{}'::jsonb),
  ('IE', NULL, 'Ireland', 'Europe', NULL, '{}'::jsonb),
  ('DK', NULL, 'Denmark', 'Europe', NULL, '{}'::jsonb),
  ('CH', NULL, 'Switzerland', 'Europe', NULL, '{}'::jsonb),
  ('AT', NULL, 'Austria', 'Europe', NULL, '{}'::jsonb),
  ('CZ', NULL, 'Czechia', 'Europe', NULL, '{}'::jsonb),
  ('MY', NULL, 'Malaysia', 'Asia', NULL, '{}'::jsonb),
  ('PH', NULL, 'Philippines', 'Asia', NULL, '{}'::jsonb),
  ('TH', NULL, 'Thailand', 'Asia', NULL, '{}'::jsonb),
  ('CL', NULL, 'Chile', 'Americas', NULL, '{}'::jsonb)
ON CONFLICT (iso2) DO NOTHING;

