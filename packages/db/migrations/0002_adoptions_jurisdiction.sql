-- An adoption is usually the *jurisdiction's* (it's the jurisdiction that
-- licenses the software); the body is optional, for the rarer case of one body
-- running its own tool (a planning board's permit tracker).
--   jurisdiction_id  not null — who adopted it
--   body_id          nullable — narrows to one body of that jurisdiction

alter table adoptions add column jurisdiction_id uuid references jurisdictions(id) on delete cascade;

update adoptions a set jurisdiction_id = b.jurisdiction_id from bodies b where b.id = a.body_id;

alter table adoptions alter column jurisdiction_id set not null;
alter table adoptions alter column body_id drop not null;

-- The body, when set, must belong to the adoption's jurisdiction.
alter table bodies add constraint bodies_id_jurisdiction_key unique (id, jurisdiction_id);
alter table adoptions drop constraint adoptions_body_id_fkey;
alter table adoptions add constraint adoptions_body_jurisdiction_fkey
  foreign key (body_id, jurisdiction_id) references bodies(id, jurisdiction_id) on delete cascade;

alter table adoptions drop constraint adoptions_body_id_product_id_key;
create unique index adoptions_jurisdiction_product_key
  on adoptions (jurisdiction_id, product_id) where body_id is null;
create unique index adoptions_body_product_key
  on adoptions (body_id, product_id) where body_id is not null;

create index idx_adoptions_jurisdiction on adoptions(jurisdiction_id);

create or replace function row_jurisdiction(p_table text, p_row jsonb) returns uuid
language sql stable as $$
  select case p_table
    when 'jurisdictions'            then (p_row->>'id')::uuid
    when 'jurisdiction_identifiers' then (p_row->>'jurisdiction_id')::uuid
    when 'bodies'                   then (p_row->>'jurisdiction_id')::uuid
    when 'seats'    then (select jurisdiction_id from bodies where id = (p_row->>'body_id')::uuid)
    when 'channels' then (select jurisdiction_id from bodies where id = (p_row->>'body_id')::uuid)
    when 'adoptions'then (p_row->>'jurisdiction_id')::uuid
    when 'contracts'then (p_row->>'holder_jurisdiction_id')::uuid
    when 'roles'    then (select b.jurisdiction_id from seats s
                          join bodies b on b.id = s.body_id
                          where s.id = (p_row->>'seat_id')::uuid)
    else null
  end;
$$;
