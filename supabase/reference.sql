-- CRAVE reference data required in EVERY environment (production included): country, launch city, platform settings.
-- Contains no demo content. Idempotent.

-- Reference data -----------------------------------------------------------------
insert into public.countries (code, name, currency, tax_name, tax_rate_bps, prices_include_tax)
values ('AU', 'Australia', 'AUD', 'GST', 1000, true) on conflict do nothing;

insert into public.cities (id, country_code, name, region, timezone, is_active, centre_lat, centre_lng)
values (md5('city-brisbane')::uuid, 'AU', 'Brisbane', 'QLD', 'Australia/Brisbane', true, -27.4698, 153.0251)
on conflict do nothing;

insert into public.platform_settings (key, value, description) values
  ('default_commission_bps', '1000', 'Default restaurant commission in basis points (1000 = 10%).'),
  ('service_fee', '{"percent_bps": 0, "fixed_cents": 99, "min_cents": 99, "max_cents": 299}',
   'Customer service fee (GST-inclusive). Review with accountant/legal before launch.'),
  ('ranking_weights', '{}', 'Overrides for recommendation weights; empty = engine defaults.'),
  ('privacy_policy_version', '"2026-11-draft"', 'Current privacy policy version shown at consent.')
on conflict (key) do nothing;

