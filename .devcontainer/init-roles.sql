-- Local test roles; no production credentials or public service ports.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
