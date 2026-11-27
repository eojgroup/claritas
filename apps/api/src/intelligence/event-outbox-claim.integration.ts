import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test,{after} from "node:test";
import {pool} from "../db";
import {CLAIM_OUTBOX_SQL,CLAIM_FRESH_OUTBOX_SQL} from "./event-outbox-claim";
after(()=>pool.end());
test("ordered outbox claims retain retry, lease, attempt and due-time boundaries",async()=>{
 const c=await pool.connect();await c.query("BEGIN");
 try {
  await c.query("DELETE FROM event_outbox");
  const cases=[['published',0,-10,null],['pending',0,-9,null],['failed',2,-8,null],['publishing',1,-7,-10],['publishing',1,-6,0],['pending',8,-5,null],['pending',0,1,null]] as const;
  const ids=cases.map(()=>randomUUID());
  for(let i=0;i<cases.length;i++){
   const [status,attempts,minutes,locked]=cases[i];
   await c.query(`INSERT INTO event_outbox(id,event_type,aggregate_type,aggregate_id,dedupe_key,payload,status,attempts,occurred_at,available_at,locked_at)
    VALUES($1::uuid,'news.story.updated','item','1',$1::text,'{}',$2,$3,now()+make_interval(mins=>$4),now()+make_interval(mins=>$4),CASE WHEN $5::int IS NULL THEN NULL ELSE now()+make_interval(mins=>$5) END)`,[ids[i],status,attempts,minutes,locked]);
  }
  const rows=(await c.query(CLAIM_OUTBOX_SQL,[8,2])).rows;
  assert.deepEqual(rows.map(r=>r.id).sort(),[ids[1],ids[2]].sort());
  assert.deepEqual(rows.map(r=>r.attempts).sort(),[1,3]);
  const reclaimed=(await c.query(CLAIM_OUTBOX_SQL,[8,10])).rows;
  assert.deepEqual(reclaimed.map(r=>r.id),[ids[3]]);
 }finally{await c.query("ROLLBACK");c.release()}
});

test("fresh signals bypass an older backlog without duplicating or starving FIFO jobs",async()=>{
 const c=await pool.connect();await c.query("BEGIN");
 try{
  await c.query("DELETE FROM event_outbox");
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  for(let i=0;i<ids.length;i++) await c.query(`INSERT INTO event_outbox(id,event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
   VALUES($1::uuid,$2,'item','1',$1::text,'{}',now()-make_interval(hours=>$3))`,[ids[i],i===1?'transport.movement.recorded':'news.story.ingested',i===2?48:0]);
  const fresh=(await c.query(CLAIM_FRESH_OUTBOX_SQL,[8,2])).rows;
  assert.deepEqual(fresh.map(row=>row.id),[ids[0]]);
  const fifo=(await c.query(CLAIM_OUTBOX_SQL,[8,2])).rows;
  assert.deepEqual(fifo.map(row=>row.id).sort(),[ids[1],ids[2]].sort());
  assert.equal(new Set([...fresh,...fifo].map(row=>row.id)).size,3);
 }finally{await c.query("ROLLBACK");c.release()}
});
