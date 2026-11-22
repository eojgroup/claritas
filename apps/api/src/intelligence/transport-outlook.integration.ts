import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {pool,query} from '../db';
import {getTransportOutlook} from '../connectors/transport-outlook';
after(()=>pool.end());
test('country outlook keeps historical direction, proxy evidence and completed-day boundaries',async()=>{
 const marker='outlook-fixture';
 await query(`INSERT INTO transport_corridor_activity_day(bucket,mode,origin_country_iso2,destination_country_iso2,peak_active_entities,peak_observed_origins,peak_flag_proxy_origins,observed_hour_mask,first_observed_at,last_observed_at,source_names)
 SELECT current_date-day_offset,'maritime','ZZ','YY',5,3,2,1,now(),now(),ARRAY[$1] FROM unnest(ARRAY[0,1,2,20]) AS day_offset`,[marker]);
 try {
  const week=await getTransportOutlook('ZZ',7,'maritime');
  const route=week.corridors.find(row=>row.destination==='YY');
  assert.equal(route?.observed_days,2); assert.equal(route?.sample_days,10); assert.equal(route?.flag_proxies,4);
  assert.equal((await getTransportOutlook('YY',30)).corridors.find(row=>row.origin==='ZZ')?.observed_days,3);
  assert.equal((await getTransportOutlook('ZZ',7,'aviation')).corridors.length,0);
 }finally{await query(`DELETE FROM transport_corridor_activity_day WHERE source_names=ARRAY[$1]`,[marker]);}
});
