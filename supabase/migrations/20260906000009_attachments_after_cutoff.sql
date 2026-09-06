-- Crew Intake · 0009 · photos may arrive after the edit window
--
-- A photo taken offline at 01:00 may not reach Storage until the next afternoon, and a
-- backfilled report is past its 06:00 cutoff from the start. Inserting an attachment on
-- one's OWN submission is therefore allowed at any time; deleting one stays inside the
-- edit window; sync columns remain service-role only.

drop policy if exists attachments_insert_own on public.attachments;
create policy attachments_insert_own on public.attachments for insert to authenticated
  with check (
    (submission_id is not null and exists (
      select 1 from public.submissions s where s.id = attachments.submission_id and s.user_id = auth.uid()
    ))
    or (invoice_id is not null and public.invoice_editable(invoice_id))
  );
