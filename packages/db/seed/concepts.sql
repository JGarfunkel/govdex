-- Generic, portable jurisdiction concepts. Cross-state; no local vocabulary here.
-- Every profile (US-NY, and later others) names and configures these in its own pack.

insert into type_concepts (code, level, description) values
  ('state',                       'state',            'Top-level state government'),
  ('county',                      'county',           'County-level area'),
  ('city',                        'municipal',        'Incorporated city'),
  ('town',                        'municipal',        'Town or township'),
  ('village',                     'sub_municipal',    'Incorporated village within a town'),
  ('school_district',             'special_district', 'Independent public school district'),
  ('educational_region',          'regional',         'Regional educational service agency'),
  ('scholastic_athletic_region',  'regional',         'High-school athletic region'),
  ('state_house_district',        'regional',         'Lower-chamber legislative district'),
  ('state_senate_district',       'regional',         'Upper-chamber legislative district'),
  ('us_house_district',           'regional',         'US House congressional district'),
  ('judicial_region',             'regional',         'Trial-court judicial region'),
  ('special_district',            'special_district', 'Single-purpose district (fire, sewer, water)')
on conflict (code) do nothing;
