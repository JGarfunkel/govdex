-- Generic body categories. Codes referenced by ingestion (t04 derives
-- 'official_elected' bodies) and by the scribe UI when triaging spider
-- candidates into a new body.

insert into body_categories (code, label) values
  ('official_elected',    'Elected governing body'),
  ('chief_executive',     'Chief executive'),          -- Governor/County Executive/Mayor: the single office, split out from the legislative body it shares top-level status with (see apps/api/src/lib/geoPayload.ts)
  ('official_appointed',  'Appointed governing or advisory body'),
  ('advisory',            'Advisory board or commission'),
  ('party_committee',     'Political party committee'),
  ('affinity',            'Affinity or identity group'),
  ('interest_group',      'Civic or interest group')
on conflict (code) do nothing;
