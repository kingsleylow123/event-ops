create table if not exists user_approvals (
  email text primary key,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_admin boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  notes text
);

create index if not exists user_approvals_status_idx on user_approvals (status);

create or replace function public.handle_new_user_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_email text := 'wowo.vs.wawa@gmail.com';
  v_is_admin boolean := lower(new.email) = lower(v_admin_email);
begin
  insert into public.user_approvals (email, status, is_admin, decided_at, decided_by)
  values (
    lower(new.email),
    case when v_is_admin then 'approved' else 'pending' end,
    v_is_admin,
    case when v_is_admin then now() else null end,
    case when v_is_admin then 'system (auto-admin)' else null end
  )
  on conflict (email) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_approval();
