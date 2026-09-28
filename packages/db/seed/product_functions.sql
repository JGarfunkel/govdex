-- Generic product/tool functions, for cataloguing what civic-tech products a
-- body has adopted (the `products` + `adoptions` tables).

insert into product_functions (code, label) values
  ('agenda_minutes',    'Agenda and minutes publishing'),
  ('website_cms',       'Website content management'),
  ('permitting',        'Permitting and licensing'),
  ('gis',               'GIS / mapping'),
  ('notification',      'Public notification / alerts'),
  ('video_streaming',   'Meeting video streaming'),
  ('crm',               'Constituent relationship management'),
  ('procurement',       'Procurement and solicitation')
on conflict (code) do nothing;
