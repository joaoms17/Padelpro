-- Extra — reserva para impostos da atividade (secção 18, taxa configurável).
alter table settings
  add column if not exists tax_rate real not null default 0;
