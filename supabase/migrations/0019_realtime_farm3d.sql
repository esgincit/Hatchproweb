-- Live 3D farm: browsers subscribe to daily_shed_log changes (RLS still filters rows per tenant).
alter publication supabase_realtime add table daily_shed_log;
