-- Allow a 'refunded' attendee payment status. A refunded deposit-holder is no
-- longer a paid or pending customer, so flipping the attendee to 'refunded'
-- drops them out of every revenue/pending calculation across the app at once
-- (Revenue page, Finance dashboard, Month-End, Jarvis, etc.).
alter table attendees drop constraint if exists attendees_payment_status_check;
alter table attendees add constraint attendees_payment_status_check
  check (payment_status in ('paid', 'pending', 'free', 'refunded'));
