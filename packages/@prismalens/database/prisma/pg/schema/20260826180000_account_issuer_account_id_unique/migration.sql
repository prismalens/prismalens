-- Check for duplicate (issuer, accountId) pairs before creating unique index
DO $$
DECLARE
    dup_record RECORD;
    dup_details TEXT := '';
BEGIN
    FOR dup_record IN
        SELECT "issuer", "accountId", string_agg("id"::text, ', ' ORDER BY "id") AS ids, count(*) AS cnt
        FROM "account"
        GROUP BY "issuer", "accountId"
        HAVING count(*) > 1
    LOOP
        dup_details := dup_details || format(E'\n  - issuer="%s", accountId="%s" (rows: %s, count: %s)', dup_record."issuer", dup_record."accountId", dup_record.ids, dup_record.cnt);
    END LOOP;

    IF dup_details <> '' THEN
        RAISE EXCEPTION 'Cannot create unique index on "account"("issuer", "accountId"): duplicate records found:%', dup_details;
    END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");
