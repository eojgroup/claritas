import test from 'node:test';
import assert from 'node:assert/strict';
import {transportPositionFilters} from './transport-position-filters';
test('position filters normalize scope and bound historical cohorts without provider refresh',()=>{
 const from=new Date(Date.now()-86400000).toISOString(),to=new Date().toISOString();
 assert.deepEqual(transportPositionFilters({country:' br ',corridor:'nl',from,to,movement:'departure'}),{country:'BR',corridor:'NL',mode:'maritime',from,to,movement:'departure',port:undefined,limit:600});
 assert.throws(()=>transportPositionFilters({country:'BR',corridor:'BR'}));
 assert.throws(()=>transportPositionFilters({corridor:'NL'}));
 assert.throws(()=>transportPositionFilters({mode:'space'}));
 assert.throws(()=>transportPositionFilters({from}));
 assert.throws(()=>transportPositionFilters({movement:'departure',from,to,mode:'aviation'}));
 assert.throws(()=>transportPositionFilters({limit:'500000'}));
 assert.throws(()=>transportPositionFilters({from:'not-a-date',to}));
 assert.throws(()=>transportPositionFilters({from:new Date(Date.now()-40*86400000).toISOString(),to}));
});
