-- Which printout is the practice's normal one (Nastavitve → Podatki za
-- račune → Privzeto tiskanje): the invoice page makes that print button the
-- prominent one, and "Izdaj in natisni" prints it right after issuing. A web
-- page can't pick the printer itself (the browser's print dialog does), so
-- this guards against the wrong FORMAT by habit, not the wrong printer.
begin;

alter table public.invoice_settings
  add column default_print_format text not null default 'a4'
    check (default_print_format in ('a4', 'receipt'));

commit;
