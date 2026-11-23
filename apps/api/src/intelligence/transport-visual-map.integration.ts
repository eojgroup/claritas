import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,query} from '../db';
import {getTransportPositions,getTransportPortActivity} from '../connectors/transport';
import {transportPositionFilters} from '../connectors/transport-position-filters';
after(()=>pool.end());
test('chart cohorts return latest coordinates, actual departure membership and balanced fresh modes',async()=>{
 const marker=`visual-${randomUUID()}`,ship=`${marker}-ship`,air=`${marker}-air`,stale=`${marker}-stale`;
 const day=new Date();day.setUTCHours(0,0,0,0);day.setUTCDate(day.getUTCDate()-1);const end=new Date(day.getTime()+86400000);
 await query(`INSERT INTO transport_snapshot(mode,entity_id,display_name,latitude,longitude,current_country_iso2,origin_country_iso2,destination_country_iso2,current_location_name,source_name,observed_at)
 VALUES('maritime',$1,'Visual vessel',12,34,'YY','ZZ','YY','Visual port','aisstream',now()),('aviation',$2,'Visual flight',56,78,'ZZ','ZZ','YY',NULL,'adsb.lol',now()),('maritime',$3,'Stale vessel',10,20,'ZZ','ZZ','YY',NULL,'aisstream',now()-interval '3 hours')`,[ship,air,stale]);
 await query(`INSERT INTO transport_entity_activity_hour(bucket,mode,entity_id,country_iso2,first_observed_at,last_observed_at,source_name) VALUES($1,'maritime',$2,'ZZ',$1,$1,'visual-test')`,[day,ship]);
 await query(`INSERT INTO transport_movement_event(mode,entity_id,event_type,country_iso2,location_name,observed_at,source_name) VALUES('maritime',$1,'departure','ZZ','Visual port',$2,'visual-test')`,[ship,day]);
 try {
  const live=await getTransportPositions(transportPositionFilters({country:'ZZ',limit:'2'}));
  assert.equal(live.entities.length,2);assert.deepEqual(new Set(live.entities.map(row=>row.mode)),new Set(['maritime','aviation']));assert.equal(live.entities.some(row=>row.entity_id===stale),false);
  const cohort=await getTransportPositions(transportPositionFilters({country:'ZZ',from:day.toISOString(),to:end.toISOString()}));
  assert.deepEqual(cohort.entities.map(row=>row.entity_id),[ship]);assert.equal(cohort.entities[0].latitude,12);assert.equal(cohort.entities[0].longitude,34);assert.equal(cohort.entities[0].current_country_iso2,'YY');
  const departed=await getTransportPositions(transportPositionFilters({country:'ZZ',from:day.toISOString(),to:end.toISOString(),movement:'departure',port:'Visual port'}));assert.deepEqual(departed.entities.map(row=>row.entity_id),[ship]);
  const arrived=await getTransportPositions(transportPositionFilters({country:'ZZ',from:day.toISOString(),to:end.toISOString(),movement:'arrival'}));assert.equal(arrived.entities.length,0);
  const expired=await getTransportPositions(transportPositionFilters({country:'ZZ',from:new Date(Date.now()-800*86400000).toISOString(),to:new Date(Date.now()-799*86400000).toISOString()}));assert.equal(expired.cohort?.available,false);assert.deepEqual(expired.entities,[]);
 }finally{
  await query(`DELETE FROM transport_movement_event WHERE entity_id=ANY($1::text[])`,[[ship,air,stale]]);
  await query(`DELETE FROM transport_entity_activity_hour WHERE entity_id=ANY($1::text[])`,[[ship,air,stale]]);
  await query(`DELETE FROM transport_snapshot WHERE entity_id=ANY($1::text[])`,[[ship,air,stale]]);
 }
});
test('port frequency exposes recorded hourly departures and registered port coordinates',async()=>{
 const hour=new Date();hour.setUTCMinutes(0,0,0);const previous=await query(`SELECT * FROM transport_movement_hour WHERE country_iso2='JP' AND location_name='Yokohama' AND bucket=$1`,[hour]);
 await query(`INSERT INTO transport_movement_hour(bucket,country_iso2,location_name,departures,arrivals,cargo_vessel_departures) VALUES($1,'JP','Yokohama',9,4,2) ON CONFLICT(bucket,country_iso2,location_name) DO UPDATE SET departures=9,arrivals=4,cargo_vessel_departures=2`,[hour]);
 try {const data=await getTransportPortActivity('JP'),port=data.ports.find(row=>row.name==='Yokohama');assert.ok(port);assert.equal(port.country,'JP');assert.equal(port.hours.find(row=>row.bucket===hour.toISOString())?.departures,9);assert.ok(port.departures>=9);assert.ok(port.latitude>35&&port.latitude<36);assert.ok(data.ports.every(row=>row.country==='JP'));}
 finally {if(previous.rows[0]){const row=previous.rows[0];await query(`UPDATE transport_movement_hour SET departures=$2,arrivals=$3,cargo_vessel_departures=$4 WHERE country_iso2='JP' AND location_name='Yokohama' AND bucket=$1`,[hour,row.departures,row.arrivals,row.cargo_vessel_departures]);}else await query(`DELETE FROM transport_movement_hour WHERE country_iso2='JP' AND location_name='Yokohama' AND bucket=$1`,[hour]);}
});
