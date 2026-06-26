-- Invoice numbering for CMO Consulting Sdn. Bhd.
-- A per-year counter + a register (audit log) of every issued invoice,
-- with an atomic "issue" function that bumps the counter, formats the
-- number (CMO-YYYY-NNNN), records it, and returns it — duplicate-proof.

create table if not exists invoice_counters (
  year       int primary key,
  last_seq   int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists invoice_register (
  id           uuid primary key default gen_random_uuid(),
  invoice_no   text unique not null,
  year         int  not null,
  seq          int  not null,
  client_name  text,
  invoice_date date,
  amount       numeric(12,2),
  created_at   timestamptz not null default now(),
  unique (year, seq)
);

-- 20 invoices were already issued manually for 2026, so the next one is 0021.
insert into invoice_counters (year, last_seq) values (2026, 20)
  on conflict (year) do nothing;

-- Atomically issue the next number for a year and log it to the register.
create or replace function issue_invoice_number(
  p_year   int,
  p_client text,
  p_date   date,
  p_amount numeric
) returns text
language plpgsql
as $$
declare
  v_seq int;
  v_no  text;
begin
  insert into invoice_counters (year, last_seq) values (p_year, 0)
    on conflict (year) do nothing;

  update invoice_counters
     set last_seq = last_seq + 1, updated_at = now()
   where year = p_year
   returning last_seq into v_seq;

  v_no := 'CMO-' || p_year::text || '-' || lpad(v_seq::text, 4, '0');

  insert into invoice_register (invoice_no, year, seq, client_name, invoice_date, amount)
  values (v_no, p_year, v_seq, p_client, p_date, p_amount);

  return v_no;
end;
$$;
