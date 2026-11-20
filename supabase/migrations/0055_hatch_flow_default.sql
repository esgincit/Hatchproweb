-- 0055: fresh-install fix. seed.sql runs after the migrations, so its hatchery settings got full_hatch_flow = true
-- (0044's back-fill only touched rows that existed then) and the legacy one-form hatch broke on a new install.
-- The column now defaults to false; every setting a signed-in user creates is still forced to full flow by
-- batch_flow_guard (0047), so only service/seed rows get the legacy flow.
alter table batch alter column full_hatch_flow set default false;
