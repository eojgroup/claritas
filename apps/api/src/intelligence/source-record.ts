const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Invalid SQL identifier");
  return value;
};

/** Guard the cast itself: SQL may reorder predicates outside this CASE. */
function safeBigintTextSql(value: string, condition?: string) {
  return `CASE WHEN ${condition ? `${condition} AND ` : ""}${value} ~ '^[0-9]{1,19}$'
    AND (length(${value})<19 OR ${value} COLLATE "C" <= '9223372036854775807' COLLATE "C")
    THEN ${value}::bigint END`;
}

/** Source IDs are strings because many providers use UUIDs or compound IDs. */
export function sourceRecordBigintSql(alias: string, recordType?: string) {
  const record = identifier(alias);
  const condition = recordType ? `${record}.source_record_type='${identifier(recordType)}'` : undefined;
  return safeBigintTextSql(`${record}.source_record_id`, condition);
}

export function canonicalSocialSignalBigintSql(alias: string) {
  const event = identifier(alias);
  const key = `${event}.metadata->>'canonical_evidence_key'`;
  return safeBigintTextSql(`split_part(${key},':',3)`, `${key} ~ '^social:social_signal:[0-9]{1,19}$'`);
}
