-- Keep read receipts attached to the account when its login username changes.
ALTER TABLE activity_reads DROP CONSTRAINT activity_reads_account_fkey;
ALTER TABLE activity_reads ADD CONSTRAINT activity_reads_account_fkey
 FOREIGN KEY(account) REFERENCES accounts(username) ON UPDATE CASCADE ON DELETE CASCADE;
