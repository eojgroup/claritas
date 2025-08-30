-- Seed a minimal set of countries needed for FK constraints
-- Safe to run multiple times thanks to ON CONFLICT DO NOTHING

INSERT INTO country (iso2, iso3, name, region, centroid, ext)
VALUES
  ('US', NULL, 'United States', 'Americas', NULL, '{}'::jsonb),
  ('GB', NULL, 'United Kingdom', 'Europe', NULL, '{}'::jsonb),
  ('FR', NULL, 'France', 'Europe', NULL, '{}'::jsonb),
  ('DE', NULL, 'Germany', 'Europe', NULL, '{}'::jsonb),
  ('ES', NULL, 'Spain', 'Europe', NULL, '{}'::jsonb),
  ('IT', NULL, 'Italy', 'Europe', NULL, '{}'::jsonb),
  ('SE', NULL, 'Sweden', 'Europe', NULL, '{}'::jsonb),
  ('NO', NULL, 'Norway', 'Europe', NULL, '{}'::jsonb),
  ('NL', NULL, 'Netherlands', 'Europe', NULL, '{}'::jsonb),
  ('BE', NULL, 'Belgium', 'Europe', NULL, '{}'::jsonb),
  ('PL', NULL, 'Poland', 'Europe', NULL, '{}'::jsonb),
  ('UA', NULL, 'Ukraine', 'Europe', NULL, '{}'::jsonb),
  ('RU', NULL, 'Russia', 'Europe/Asia', NULL, '{}'::jsonb),
  ('TR', NULL, 'Türkiye', 'Europe/Asia', NULL, '{}'::jsonb),
  ('CN', NULL, 'China', 'Asia', NULL, '{}'::jsonb),
  ('JP', NULL, 'Japan', 'Asia', NULL, '{}'::jsonb),
  ('KR', NULL, 'South Korea', 'Asia', NULL, '{}'::jsonb),
  ('IN', NULL, 'India', 'Asia', NULL, '{}'::jsonb),
  ('ID', NULL, 'Indonesia', 'Asia', NULL, '{}'::jsonb),
  ('AU', NULL, 'Australia', 'Oceania', NULL, '{}'::jsonb),
  ('NZ', NULL, 'New Zealand', 'Oceania', NULL, '{}'::jsonb),
  ('ZA', NULL, 'South Africa', 'Africa', NULL, '{}'::jsonb),
  ('EG', NULL, 'Egypt', 'Africa', NULL, '{}'::jsonb),
  ('NG', NULL, 'Nigeria', 'Africa', NULL, '{}'::jsonb),
  ('KE', NULL, 'Kenya', 'Africa', NULL, '{}'::jsonb),
  ('BR', NULL, 'Brazil', 'Americas', NULL, '{}'::jsonb),
  ('AR', NULL, 'Argentina', 'Americas', NULL, '{}'::jsonb),
  ('MX', NULL, 'Mexico', 'Americas', NULL, '{}'::jsonb),
  ('CA', NULL, 'Canada', 'Americas', NULL, '{}'::jsonb),
  ('SG', NULL, 'Singapore', 'Asia', NULL, '{}'::jsonb),
  ('AE', NULL, 'United Arab Emirates', 'Asia', NULL, '{}'::jsonb),
  ('SA', NULL, 'Saudi Arabia', 'Asia', NULL, '{}'::jsonb)
ON CONFLICT (iso2) DO NOTHING;

