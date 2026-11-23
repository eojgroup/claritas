import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plane, RefreshCw, Ship, X } from "lucide-react";
import { fetchTransportPortActivity, type TransportPortActivity, fetchTransportEntity, fetchTransportOverview, fetchTransportPositions, fetchTransportOutlook, type IntelligenceEvent, type TransportEntity, type TransportOverview, type TransportTrackPoint, type TransportPositionSelection, type TransportPositions, type TransportOutlook } from "../lib/api";
import { readWithDeadline } from "../lib/readDeadline";
import "./TransportScopeContext.css";

const EMPTY_TRANSPORT_SELECTION: TransportPositionSelection = { mode: "all", corridor: "", port: "", window: null };
export type TransportMapState = { country?: string; selection: TransportPositionSelection; positions: TransportPositions | null; countries: Array<{country:string;count:number}>; connections: Array<{origin:string;destination:string;label:string;weight:number;mode?:string;proxy?:boolean}>; loading: boolean; failed: boolean; ports: TransportPortActivity["ports"]; heatLabel: string; heatNotice: string };
type Props = {
  country?: string | null; events?: IntelligenceEvent[]; relatedEventIds?: string[];
  onSelectCountry?: (country: string) => void; onOpenEvent?: (id:string) => void;
  onOverview?: (value:TransportOverview|null) => void; selectedVehicle?: TransportEntity|null;
  selection?: TransportPositionSelection; onSelectionChange?: (value:TransportPositionSelection) => void;
  onMapChange?: (value:TransportMapState) => void; onSelectVehicle?: (value:TransportEntity|null) => void;
};
const count = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString();
const countryName = (iso:string) => new Intl.DisplayNames(undefined,{type:"region"}).of(iso) || iso;
const identifier = (entity:TransportEntity) => entity.flight_number || entity.callsign || entity.display_name || entity.entity_id;
const date = (value:string) => new Date(value).toLocaleDateString([], {month:"short",day:"numeric",timeZone:"UTC"});
const range = (bucket:string,hours:number) => ({from:new Date(bucket).toISOString(),to:new Date(Date.parse(bucket)+hours*3600000).toISOString()});

/** A single visual explorer drives the existing World map; provider ingestion stays in the background. */
export default function TransportScopeContext({country,events=[],relatedEventIds=[],onSelectCountry,onOpenEvent,onOverview,selectedVehicle,selection:controlled,onSelectionChange,onMapChange,onSelectVehicle}:Props) {
  const iso=country?.toUpperCase() || undefined;
  const [local,setLocal]=useState(EMPTY_TRANSPORT_SELECTION), selection=controlled ?? local;
  const [overview,setOverview]=useState<TransportOverview|null>(null), [rawPositions,setPositions]=useState<TransportPositions|null>(null);
  const [positionKey,setPositionKey]=useState("");
  const requestKey=`${iso??"global"}|${JSON.stringify(selection)}`;
  const positions=positionKey===requestKey?rawPositions:null;
  const [loading,setLoading]=useState(true), [failed,setFailed]=useState(false), [retry,setRetry]=useState(0);
  const [overviewFailed,setOverviewFailed]=useState(false);
  const [portActivity,setPortActivity]=useState<TransportPortActivity|null>(null);
  const [days,setDays]=useState(30), [connectionDays,setConnectionDays]=useState(0);
  const [outlook,setOutlook]=useState<TransportOutlook|null>(null), [outlookFailed,setOutlookFailed]=useState(false);
  const [selected,setSelected]=useState<TransportEntity|null>(null),[query,setQuery]=useState(""),[browse,setBrowse]=useState(false);
  const update=(patch:Partial<TransportPositionSelection>)=>{(onSelectionChange ?? setLocal)({...selection,...patch,...(patch.window===null?{movement:undefined}:{})});setSelected(null);onSelectVehicle?.(null);};
  useEffect(()=>{setLocal(EMPTY_TRANSPORT_SELECTION);setSelected(null);setQuery("");setOverview(null);setOutlook(null);setConnectionDays(0);},[iso]);
  // Charts are a saved, stable overview; interactive filtering never reruns all historical aggregates.
  useEffect(()=>{
    const controller=new AbortController();setOverviewFailed(false);
    void readWithDeadline(signal=>fetchTransportOverview({signal,country:iso,detail:iso?"full":"aggregate",historyDays:iso?400:undefined,entityLimit:25}),controller.signal,20_000)
      .then(value=>{if(!controller.signal.aborted){setOverview(value);onOverview?.(value);}})
      .catch(()=>{if(!controller.signal.aborted)setOverviewFailed(true);});
    return()=>controller.abort();
  },[iso,retry,onOverview]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setFailed(false);
    void readWithDeadline(signal=>fetchTransportPositions(iso,selection,signal),controller.signal,12_000)
      .then(value=>{if(!controller.signal.aborted){setPositions(value);setPositionKey(requestKey);setLoading(false);}})
      .catch(()=>{if(!controller.signal.aborted){setFailed(true);setLoading(false);}});
    return()=>controller.abort();
  },[iso,selection,retry,requestKey]);
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setRetry(value=>value+1);},120_000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(selectedVehicle)setSelected(selectedVehicle);},[selectedVehicle]);
  useEffect(()=>{const controller=new AbortController();setPortActivity(null);void fetchTransportPortActivity(iso,controller.signal).then(value=>{if(!controller.signal.aborted)setPortActivity(value);}).catch(()=>{});return()=>controller.abort();},[iso,retry]);
  useEffect(()=>{
    setOutlook(null);setOutlookFailed(false);if(!iso || !connectionDays)return;
    const controller=new AbortController();void fetchTransportOutlook(iso,connectionDays,controller.signal).then(value=>{if(!controller.signal.aborted)setOutlook(value);}).catch(()=>{if(!controller.signal.aborted)setOutlookFailed(true);});return()=>controller.abort();
  },[iso,connectionDays,retry]);
  const connections=useMemo(()=>{
    if(connectionDays)return (outlook?.corridors??[]).filter(row=>selection.mode==="all"||row.mode===selection.mode).map(row=>({origin:row.origin,destination:row.destination,mode:row.mode,weight:row.sample_days,proxy:row.flag_proxies>0,label:`${row.origin} → ${row.destination} · ${row.observed_days}/${connectionDays} observed days${row.flag_proxies?' · includes flag links':''}`}));
    return (overview?.routes??[]).filter(row=>selection.mode==="all"||row.mode===selection.mode).map(row=>({origin:row.origin_country,destination:row.destination_country,mode:row.mode,weight:row.active_count,proxy:row.origin_basis!=="observed",label:`${row.origin_name} → ${row.destination_name} · ${row.active_count} current links${row.origin_basis!=="observed"?' · includes flag links':''}`}));
  },[overview,outlook,selection.mode,connectionDays]);
  const heat=useMemo(()=>{
    const totals=new Map<string,number>();
    if(selection.window||selection.port){for(const vehicle of positions?.entities??[])for(const key of new Set(vehicle.country_links.map(link=>link.country)))totals.set(key,(totals.get(key)??0)+1);return [...totals].map(([country,count])=>({country,count}));}
    for(const row of connections){if(selection.corridor && ![row.origin,row.destination].includes(selection.corridor))continue;for(const key of new Set([row.origin,row.destination]))totals.set(key,(totals.get(key)??0)+row.weight);}
    if(!totals.size && !iso)for(const row of overview?.countries??[])totals.set(row.country,selection.mode==="all"?row.active_count:row[selection.mode].active);
    return [...totals].map(([country,count])=>({country,count}));
  },[connections,selection.corridor,selection.mode,selection.window,selection.port,positions,overview,iso]);
  const mapState=useMemo<TransportMapState>(()=>({country:iso,selection,positions,countries:heat,heatLabel:connectionDays?`Connection intensity · ${connectionDays}d`:"Current vehicle country links",heatNotice:connectionDays?"Summed daily peak samples in completed UTC days. Positions remain current; connections are country links, not observed tracks.":"Warmer = more country-linked activity. Orange = vessel; blue = aircraft. Partial tracked coverage.",ports:portActivity?.ports??[],connections:selection.corridor?connections.filter(row=>[row.origin,row.destination].includes(selection.corridor)).slice(0,2):[],loading,failed}),[iso,selection,positions,heat,connections,loading,failed,portActivity,connectionDays]);
  useEffect(()=>{onMapChange?.(mapState);},[mapState,onMapChange]);
  const tiles=useMemo(()=>{
    const rows=new Map<string,{country:string;maritime:number;aviation:number;proxy:boolean}>();
    for(const row of connections){const other=row.origin===iso?row.destination:row.origin;if(other===iso)continue;const key=iso?other:`${row.origin} → ${row.destination}`;const item=rows.get(key)??{country:key,maritime:0,aviation:0,proxy:false};if(row.mode==="aviation")item.aviation+=row.weight;else item.maritime+=row.weight;item.proxy ||=row.proxy;rows.set(key,item);}
    return [...rows.values()].sort((a,b)=>(b.maritime+b.aviation)-(a.maritime+a.aviation)).slice(0,12);
  },[connections,iso]);
  const related=events.filter(event=>relatedEventIds.includes(event.id)||((!iso||event.primary_country_iso2===iso)&&(event.signal_domains?.includes("transport")||event.origin_domain==="transport")));
  const entities=(positions?.entities??[]).filter(entity=>`${identifier(entity)} ${entity.route_label??""}`.toLowerCase().includes(query.toLowerCase()));
  const chooseWindow=(bucket:string,hours:number)=>{const next=range(bucket,hours);update({window:selection.window?.from===next.from?null:next,movement:undefined});};
  const scope=iso?countryName(iso):"Worldwide";
  return <section className="transport-scope-context transport-visual-explorer" aria-label="Transport exploration" aria-busy={loading}>
    <header className="scope-context-heading"><div><small>{scope} · transport</small><h3>Air & sea, at a glance</h3></div><button aria-label="Refresh saved transport" onClick={()=>setRetry(value=>value+1)} disabled={loading}><RefreshCw size={16}/></button></header>
    <div className="transport-mode-cards" aria-label="Filter live transport">
      {([['all','All traffic'],['maritime','Vessels'],['aviation','Aircraft']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={selection.mode===key} onClick={()=>update({mode:key,port:"",movement:undefined})}>{key==='maritime'?<Ship size={21}/>:key==='aviation'?<Plane size={21}/>:<span className="transport-paired-icons"><Ship size={16}/><Plane size={16}/></span>}<strong>{key==='all'?count(overview?.summary.active):count(overview?.summary.modes?.[key].active)}</strong><span>{label}</span></button>)}
    </div>
    <div className="transport-live-caption" role="status">{loading?'Updating map positions…':failed?'Positions unavailable · retry above':positions?.cohort?.available===false?'Vehicle identities for this period are no longer retained':`${positions?.entities.length??0}${positions?.truncated?' sampled':''} current positions on the map`}<span>Orange · vessels / blue · aircraft</span></div>
    {(selection.corridor||selection.port||selection.window||selected) && <div className="transport-selection-chips">
      {selection.corridor&&<button onClick={()=>update({corridor:""})}>{countryName(selection.corridor)} <X size={12}/></button>}{selection.port&&<button onClick={()=>update({port:""})}>{selection.port} <X size={12}/></button>}{selection.window&&<button onClick={()=>update({window:null})}>{date(selection.window.from)} · activity cohort <X size={12}/></button>}{selected&&<button onClick={()=>{setSelected(null);onSelectVehicle?.(null);}}>Following {identifier(selected)} <X size={12}/></button>}
    </div>}
    <section aria-label="Transport corridor heatmap"><header className="transport-visual-heading"><h4>Connections</h4>{iso&&<div className="transport-period-pills" aria-label="Connection period">{[0,7,30,90].map(value=><button key={value} aria-pressed={connectionDays===value} onClick={()=>setConnectionDays(value)}>{value?`${value}d`:'Now'}</button>)}</div>}</header>
      <div className="transport-connection-grid">{tiles.map(tile=>{const max=Math.max(1,...tiles.map(row=>row.maritime+row.aviation)),total=tile.maritime+tile.aviation;return <button key={tile.country} aria-pressed={selection.corridor===tile.country} aria-label={`Filter connection ${iso?countryName(tile.country):tile.country.split(' → ').map(countryName).join(' → ')}: ${count(total)} ${connectionDays?'daily peak samples':'current links'}`} onClick={()=>iso?update({corridor:selection.corridor===tile.country?'':tile.country,port:""}):onSelectCountry?.(tile.country.split(' → ')[1])} style={{'--heat':`${.12+.5*Math.sqrt(total/max)}`} as React.CSSProperties}><span>{iso?countryName(tile.country):tile.country.split(' → ').map(countryName).join(' → ')}{tile.proxy&&<small title="Includes vessel flag origins; a flag is not a sailed route"> †</small>}</span><strong>{count(total)}</strong><i><b style={{width:`${total?tile.maritime/total*100:0}%`}}/><b style={{width:`${total?tile.aviation/total*100:0}%`}}/></i></button>;})}</div>
      <p className="transport-visual-note">{connectionDays?'Daily peak samples · select a connection to filter current positions.':'Country links · select to filter current positions.'}{tiles.some(row=>row.proxy)&&' † Includes flag links.'}</p>
      {!tiles.length&&<p className="transport-visual-note">{connectionDays&&!outlook?(outlookFailed?'Saved connections unavailable.':'Loading saved connections…'):overview?'No resolved connections in this sample.':'Preparing connection view…'}</p>}
    </section>
    {overview&&<>
      <section><header className="transport-visual-heading"><h4>Activity · past 24 hours</h4><span>Tap an hour</span></header><ActivityPlot rows={overview.activity.filter(row=>selection.mode==='all'||row.mode===selection.mode).map(row=>({bucket:row.bucket,mode:row.mode,value:row.active_count}))} stepHours={1} selected={selection.window?.from} onSelect={bucket=>chooseWindow(bucket,1)}/></section>
      {overview.history&&<section aria-label="Retained transport history"><header className="transport-visual-heading"><h4>Activity over time</h4><div className="transport-period-pills" aria-label="History window">{[7,30,90,365].map(value=><button key={value} aria-pressed={days===value} onClick={()=>setDays(value)}>{value===365?'Year':`${value}d`}</button>)}</div></header><ActivityPlot rows={overview.history.series.slice(-days).flatMap(point=>(['maritime','aviation'] as const).flatMap(mode=>{const value=mode==='maritime'?point.maritime_entities:point.aviation_entities;return value==null||(selection.mode!=='all'&&selection.mode!==mode)?[]:[{bucket:point.bucket,mode,value}];}))} selected={selection.window?.from} onSelect={bucket=>chooseWindow(bucket,24)}/><p className="transport-visual-note">Daily peak samples · gaps are missing observations; the latest day may be partial. Tap a day to locate its vehicles now.</p>
      {selection.mode!=="aviation"&&<><header className="transport-visual-heading"><h4>Departures</h4><span>Recorded port exits · tap a day</span></header><ActivityPlot rows={overview.history.series.slice(-days).flatMap(point=>point.ship_departures==null?[]:[{bucket:point.bucket,mode:'maritime',value:point.ship_departures}])} selected={selection.movement==='departure'?selection.window?.from:undefined} onSelect={bucket=>update({mode:'maritime',movement:'departure',window:range(bucket,24),port:''})}/></>}</section>}
    </>}
    {selection.mode!=="aviation"&&!!portActivity?.ports.length&&<section aria-label="Port departures and frequency"><header className="transport-visual-heading"><h4>Ports & departures</h4><span>Recorded · past 24h</span></header><div className="transport-port-frequency">{portActivity.ports.slice(0,8).map(port=><button key={`${port.country}:${port.name}`} aria-pressed={selection.port===port.name} onClick={()=>update({port:selection.port===port.name?'':port.name,mode:'maritime',corridor:'',window:null})}><span><strong>{port.name}</strong><small>{port.country} · {count(port.arrivals)} arrivals</small></span><PortSpark hours={port.hours}/><span><strong>{count(port.departures)}</strong><small>departures / 24h</small></span></button>)}</div><p className="transport-visual-note">Hourly departure frequency · tap a port to locate its current vessels. Geofence observations, not complete port-authority totals.</p></section>}
    {overviewFailed&&<p className="transport-visual-note">Historical charts unavailable. Current map positions remain independently available.</p>}
    <section><header className="transport-visual-heading"><h4>On the map</h4><button onClick={()=>setBrowse(!browse)}>{browse?'Show less':'Find a vehicle'}</button></header>{browse&&<input type="search" aria-label="Find a vessel or aircraft" placeholder="Vessel, flight or route" value={query} onChange={event=>setQuery(event.target.value)}/>}
      <div className="transport-vehicle-strip">{entities.slice(0,browse?40:4).map(entity=><button key={entity.id} aria-pressed={selected?.id===entity.id} onClick={()=>{setSelected(entity);onSelectVehicle?.(entity);}}>{entity.mode==='aviation'?<Plane size={18}/>:<Ship size={18}/>}<span><strong>{identifier(entity)}</strong><small>{entity.route_label||entity.current_location_name||entity.entity_id}</small></span><ArrowRight size={14}/></button>)}</div>
    </section>
    {selected&&<EntityDetail key={selected.id} entity={selected} onClose={()=>{setSelected(null);onSelectVehicle?.(null);}}/>}
    {!!related.length&&<section aria-label="Related transport developments"><h4>In the news</h4>{related.slice(0,3).map(event=><button className="scope-context-related-event" key={event.id} onClick={()=>onOpenEvent?.(event.id)}><strong>{event.title}</strong><small>{event.location_name||event.primary_country_iso2}</small></button>)}</section>}
    <p className="transport-visual-note">Partial AIS / ADS-B coverage · positions stay current when historical activity is selected. Country links and reference-point connections are not sailed or flown tracks.</p>
    {overview?.history&&<details className="transport-methods"><summary>Data coverage & comparisons</summary><p>{overview.history.methodology}</p>{overview.history.comparisons?.map(row=><p key={row.key}>{row.label}: {row.comparable?`${row.change_percent??'—'}%`:`${row.current.observed_days}/${row.current.days} current days · ${row.previous.observed_days}/${row.previous.days} prior days · not comparable`}</p>)}</details>}
  </section>;
}

function PortSpark({hours}:{hours:TransportPortActivity["ports"][number]["hours"]}) {
  const end=new Date();end.setUTCMinutes(0,0,0);const start=end.getTime()-23*3600000,max=Math.max(1,...hours.map(row=>row.departures));
  return <svg viewBox="0 0 120 30" aria-hidden="true">{hours.map(row=><rect key={row.bucket} x={(Date.parse(row.bucket)-start)/3600000*5} y={28-row.departures/max*26} width="3.5" height={Math.max(1,row.departures/max*26)} rx="1" fill="var(--shell-accent)"/>)}</svg>;
}
type PlotRow={bucket:string;mode:string;value:number};
function ActivityPlot({rows,selected,onSelect,stepHours=24}:{rows:PlotRow[];selected?:string;onSelect:(bucket:string)=>void;stepHours?:number}) {
  const buckets=[...new Set(rows.map(row=>row.bucket))].sort(),max=Math.max(1,...rows.map(row=>row.value));
  if(!buckets.length)return <p className="transport-visual-note">No retained activity samples.</p>;
  const start=Date.parse(buckets[0]),end=Date.parse(buckets[buckets.length-1]),x=(bucket:string)=>28+(Date.parse(bucket)-start)/Math.max(1,end-start)*650;
  const spacing=stepHours*3600000;
  const series=(mode:string)=>{let previous=-Infinity;return rows.filter(row=>row.mode===mode).sort((a,b)=>a.bucket.localeCompare(b.bucket)).map(row=>{const gap=Date.parse(row.bucket)-previous>spacing*1.5;previous=Date.parse(row.bucket);return `${gap?'M':'L'}${x(row.bucket)},${132-row.value/max*112}`;}).join(' ');};
  return <figure className="transport-activity-plot"><span className="transport-plot-max">{count(max)}</span><svg viewBox="0 0 720 142" preserveAspectRatio="none" role="group" aria-label="Transport activity · select a period to filter current positions">
    {[0,.5,1].map(value=><g key={value}><line x1="28" x2="688" y1={132-value*112} y2={132-value*112} stroke="var(--shell-border)" strokeDasharray={value?'3 5':undefined}/></g>)}
    {['maritime','aviation'].map(mode=><path key={mode} d={series(mode)} fill="none" stroke={mode==='maritime'?'var(--shell-accent)':'var(--signal-sky,#77a8ba)'} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>)}
    {rows.map(row=><circle key={`${row.bucket}:${row.mode}`} cx={x(row.bucket)} cy={132-row.value/max*112} r="2.5" fill={row.mode==='maritime'?'var(--shell-accent)':'var(--signal-sky,#77a8ba)'} pointerEvents="none"/>)}
    {buckets.map(bucket=><g key={bucket}>{selected===bucket&&<line x1={x(bucket)} x2={x(bucket)} y1="12" y2="136" stroke="var(--shell-ink)" strokeWidth="1.5"/>}<rect x={x(bucket)-Math.max(3,650/buckets.length/2)} y="10" width={Math.max(6,650/buckets.length)} height="128" fill="transparent" role="button" tabIndex={0} aria-pressed={selected===bucket} aria-label={`Locate vehicles active ${new Date(bucket).toLocaleString([], {timeZone:'UTC'})} UTC`} onClick={()=>onSelect(bucket)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(bucket);}}}><title>{date(bucket)} · {rows.filter(row=>row.bucket===bucket).map(row=>`${row.mode}: ${row.value}`).join(' / ')}</title></rect></g>)}
  </svg><figcaption><span>{date(buckets[0])}{spacing<86400000?` ${new Date(buckets[0]).getUTCHours()}:00`:''}</span><span>{date(buckets[buckets.length-1])}{spacing<86400000?` ${new Date(buckets[buckets.length-1]).getUTCHours()}:00`:''} UTC</span></figcaption></figure>;
}

function EntityDetail({ entity, onClose }: { entity: TransportEntity; onClose: () => void }) {
  const [track, setTrack] = useState<TransportTrackPoint[] | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { const controller = new AbortController(); void readWithDeadline((signal) => fetchTransportEntity(entity.mode, entity.entity_id, signal), controller.signal, 10_000).then((value) => { if (!controller.signal.aborted) setTrack(value.track); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }); return () => controller.abort(); }, [entity.mode, entity.entity_id]);
  return <section className="scope-context-entity-detail" aria-label="Selected vehicle"><header><h4>{identifier(entity)}</h4><button type="button" onClick={onClose}>Close vehicle</button></header><p>{entity.route_label || "Route unresolved"} · {entity.entity_id} · {entity.source_name}</p><dl><div><dt>Speed</dt><dd>{count(entity.speed)} knots</dd></div><div><dt>Country roles</dt><dd>{entity.country_links.map((link) => `${link.country}: ${link.role}`).join(" · ")}</dd></div><div><dt>Last observed</dt><dd>{new Date(entity.observed_at).toLocaleString()}</dd></div></dl>{track ? <details open><summary>Retained sampled trail · {track.length} positions</summary><div className="scope-context-table-scroll"><table><thead><tr><th>Observed</th><th>Position</th><th>Speed · knots</th></tr></thead><tbody>{track.slice(-20).reverse().map((point) => <tr key={`${point.observed_at}:${point.latitude}:${point.longitude}`}><th>{new Date(point.observed_at).toLocaleString()}</th><td>{point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}</td><td>{count(point.speed)}</td></tr>)}</tbody></table></div></details> : <p>{failed ? "The retained trail could not be loaded." : "Loading retained sampled trail…"}</p>}</section>;
}
