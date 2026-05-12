alter table public.settings
  add column if not exists zar_per_point integer not null default 500;

comment on column public.settings.zar_per_point is
  'ZAR value of one sprint point, used to calculate Delivery Yield in the Delivery tab. Default 500.';
