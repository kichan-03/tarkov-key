'use strict';
// Tarkov Key Guide v0.7.2. GitHub Pages, no account, no backend.
const API = 'https://api.tarkov.dev/graphql';
const OWNED_KEY = 'tarkov-key-guide-owned-v1'; // DO NOT CHANGE: existing users' checkmarks.
const CACHE_KEY = 'tarkov-key-guide-items-v4'; // Cache format unchanged: preserve working 0.4 data
const OLD_CACHE_KEYS = ['tarkov-key-guide-items-v3', 'tarkov-key-guide-items-v2'];
const queryEnglish = `query { items(types:[keys],lang:en) { id name shortName iconLink wikiLink description usedInTasks { id name } properties { ... on ItemPropertiesKey { uses } } } }`;
const queryKorean = `query { items(types:[keys],lang:ko) { id name shortName usedInTasks { id name } } }`;
// Lock has no room name in the public schema; avoid inventing a building or floor.
const queryMaps = `query { maps { name normalizedName accessKeys { id } locks { key { id } lockType needsPower position { x y z } } } }`;
const $ = id => document.getElementById(id);
const labels = { 'Customs':'세관', 'Factory':'팩토리', 'Factory (Night)':'야간 팩토리', 'Woods':'우드', 'Shoreline':'해안선', 'Interchange':'인터체인지', 'Reserve':'리저브', 'Lighthouse':'등대', 'Streets of Tarkov':'스트리트', 'The Lab':'연구소', 'Ground Zero':'그라운드 제로', 'Terminal':'터미널', 'The Labyrinth':'미궁', 'Icebreaker':'아이스브레이커' };
const mapLabels = {customs:'세관',factory:'팩토리','night-factory':'야간 팩토리',woods:'우드',shoreline:'해안선',interchange:'인터체인지',reserve:'리저브',lighthouse:'등대',streets:'스트리트','streets-of-tarkov':'스트리트',labs:'연구소','the-lab':'연구소','ground-zero':'그라운드 제로',terminal:'터미널','the-labyrinth':'미궁',icebreaker:'아이스브레이커'};
const mapSlugs = {세관:'customs',팩토리:'factory','야간 팩토리':'factory',우드:'woods',해안선:'shoreline',인터체인지:'interchange',리저브:'reserve',등대:'lighthouse',스트리트:'streets',연구소:'labs','그라운드 제로':'ground-zero',터미널:'terminal',미궁:'the-labyrinth',아이스브레이커:'icebreaker'};
// Map previews are third-party images, not copies stored in this project.
// URLs confirmed from the open-source tarkov.dev maps.json. No unverified paths.
const MAP_PREVIEWS = Object.freeze({
  '세관':'https://assets.tarkov.dev/maps/svg/Customs.svg',
  '팩토리':'https://assets.tarkov.dev/maps/svg/Factory.svg',
  '야간 팩토리':'https://assets.tarkov.dev/maps/svg/Factory.svg',
  '우드':'https://assets.tarkov.dev/maps/svg/Woods.svg',
  '해안선':'https://assets.tarkov.dev/maps/svg/Shoreline.svg',
  '인터체인지':'https://assets.tarkov.dev/maps/svg/Interchange.svg',
  '리저브':'https://assets.tarkov.dev/maps/svg/Reserve.svg',
  '스트리트':'https://assets.tarkov.dev/maps/svg/StreetsOfTarkov.svg',
  '등대':'https://assets.tarkov.dev/maps/svg/Lighthouse.svg',
  '그라운드 제로':'https://assets.tarkov.dev/maps/svg/GroundZero.svg',
  '터미널':'https://assets.tarkov.dev/maps/svg/Terminal.svg'
});
// The rectangle used by Leaflet's SVG overlay in tarkov.dev, not the auto-fit
// rectangle of the coordinates. All listed maps have coordinateRotation=180.
// Left/top represent [maxX,minZ], right/bottom [minX,maxZ]. Reserve has
// a distinct svgBounds; use that exact rectangle, not its tile bounds.
// Factory uses rotation 90 and is intentionally excluded until independently calibrated.
const MAP_CALIBRATIONS = Object.freeze({
  '세관':[[698,-307],[-372,237]],
  '우드':[[646,-914],[-761,442]],
  '해안선':[[504,-415],[-1056,618]],
  '리저브':[[289,-274],[-303,272]],
  '인터체인지':[[598,-442],[-433,426]],
  '스트리트':[[323,-295],[-280,532]],
  '등대':[[515,-998],[-545,725]],
  '그라운드 제로':[[249,-124],[-99,364]],
  '터미널':[[463,-580],[-433,475]]
});
// Preserve this independently of ownership records and cache schema.
const MAP_PIN_LIMIT = 450;
let atlasMap = '세관';
let atlasHighlightedId = null;
let items = [];
let ownedMemory = {};
let loadSequence = 0;
let initialLinkHandled = false;
// On-demand quest detail queries never block the key list or map data.
const questDetailRequests = new Map();
const QUEST_DETAIL_QUERY = `query KeyQuestDetails($id: ID!) {
  en: task(id:$id, lang:en) {
    id name wikiLink trader { name } map { name normalizedName }
    objectives { id type description maps { name normalizedName } }
  }
  ko: task(id:$id, lang:ko) {
    id name objectives { id description }
  }
}`;
// v0.7.2: JSON API is the supported source; GraphQL is a best-effort fallback.
// The JSON feed is indexed by id and uses separate translated string dictionaries.
const JSON_API = 'https://json.tarkov.dev/regular/';
const KEY_CATEGORY_IDS = new Set([
  '543be5e94bdc2df1348b4568', // Key
  '5c99f98d86f7745c314214b3', // Mechanical key
  '5c164d2286f774194c5e69fa'  // Keycard
]);
let jsonQuestRecords = new Map();
let jsonQuestNamesEn = {};
let jsonQuestNamesKo = {};
let jsonMapsById = new Map();
function idOf(value) { return typeof value==='string' ? value : (value && typeof value.id==='string' ? value.id : null); }
function jsonRows(source){
  if(Array.isArray(source)) return source.filter(x=>x&&typeof x==='object');
  if(!source||typeof source!=='object')return [];
  return Object.entries(source).filter(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)).map(([id,v])=>({...v,id:v.id||id}));
}
function lookupText(dictionary,key){
  if(typeof key!=='string'||!key)return '';
  if(dictionary&&typeof dictionary[key]==='string'&&dictionary[key].trim())return dictionary[key].trim();
  // The JSON data occasionally spells placeholder suffixes with different case.
  for(const variant of [key.replace(/ Name$/, ' name').replace(/ ShortName$/, ' shortName').replace(/ Description$/, ' description'),key.replace(/ name$/, ' Name').replace(/ shortName$/, ' ShortName').replace(/ description$/, ' Description')]){
    if(dictionary&&typeof dictionary[variant]==='string'&&dictionary[variant].trim())return dictionary[variant].trim();
  }
  return '';
}
function fallbackName(raw){
  let wiki='';
  if(typeof raw.wikiLink==='string' && /^https:\/\//.test(raw.wikiLink)){
    try{wiki=decodeURIComponent(new URL(raw.wikiLink).pathname.split('/').pop()||'').replace(/_/g,' ');}catch{}
  }
  if(wiki)return wiki;
  const slug=String(raw.normalizedName||'').replace(/-/g,' ').trim();
  return slug||String(raw.id||'Unknown key');
}
function validString(v){return typeof v==='string'?v:'';}
async function getJson(path,ms=24000){
  const response=await fetch(JSON_API+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(ms)});
  if(!response.ok)throw Error('JSON '+path+' HTTP '+response.status);
  const payload=await response.json();
  if(!payload||!payload.data||typeof payload.data!=='object')throw Error('JSON '+path+' 데이터 형식 오류');
  return payload.data;
}
function addTaskRefs(raw,links){
  const push=(itemId)=>{if(!itemId||typeof itemId!=='string')return;links.add(itemId);};
  const scan=(group)=>{
    if(Array.isArray(group)){for(const entry of group)scan(entry);return;}
    push(idOf(group));
  };
  scan(raw.neededKeys);
  if(Array.isArray(raw.objectives))for(const obj of raw.objectives)scan(obj.requiredKeys);
}
// Converts the native JSON shape to the existing v0.7 item/map/task shape.
function adaptJsonCatalog(itemPayload,itemEn,itemKo,mapPayload,taskPayload,taskEn,taskKo){
  const itemRows=jsonRows(itemPayload.items);
  if(itemRows.length===0)throw Error('JSON API에서 아이템 목록이 비어 있습니다.');
  const allKeys=itemRows.filter(raw=>{
    const categories=Array.isArray(raw.categories)?raw.categories.map(idOf):[];
    const typeCheck=Array.isArray(raw.types)&&raw.types.includes('keys');
    return categories.some(id=>KEY_CATEGORY_IDS.has(id))||typeCheck;
  });
  if(!allKeys.length)throw Error('JSON API에서 열쇠 분류가 0개입니다.');
  const keyIds=new Set(allKeys.map(x=>x.id));
  const taskRefs=new Map();
  jsonQuestRecords=new Map();jsonQuestNamesEn=taskEn||{};jsonQuestNamesKo=taskKo||{};
  for(const task of jsonRows(taskPayload?.tasks)){
    jsonQuestRecords.set(task.id,task);
    const keyRefs=new Set();addTaskRefs(task,keyRefs);
    if(keyRefs.size){
      const name=lookupText(taskEn,task.name)||validString(task.name);
      const nameKo=lookupText(taskKo,task.name)||'';
      for(const id of keyRefs){
        if(!keyIds.has(id))continue;
        if(!taskRefs.has(id))taskRefs.set(id,[]);
        taskRefs.get(id).push({id:task.id,name,nameKo});
      }
    }
  }
  // Map lock key refs and access key refs are ID strings, not nested Item objects.
  const maps=[];
  jsonMapsById=new Map();
  for(const map of jsonRows(mapPayload?.maps)){
    jsonMapsById.set(map.id,map);
    const normalizeLock=lock=>({
      key: {id:idOf(lock?.key)},
      lockType: lock?.lockType||'',needsPower:lock?.needsPower===true,
      position:lock?.position&&typeof lock.position==='object'?lock.position:null
    });
    maps.push({name:map.normalizedName||map.name||map.id,
      normalizedName:map.normalizedName||map.name||map.id,
      locks:Array.isArray(map.locks)?map.locks.filter(x=>x&&typeof x==='object').map(normalizeLock):[],
      accessKeys:Array.isArray(map.accessKeys)?map.accessKeys.map(x=>({id:idOf(x)})):[]});
  }
  const english=[],korean=[];
  for(const raw of allKeys){
    const nameEn=lookupText(itemEn,raw.name)||((typeof raw.name==='string'&&!/^\w{24} (?:Name|name)$/i.test(raw.name))?raw.name:fallbackName(raw));
    const nameKo=lookupText(itemKo,raw.name)||nameEn;
    const shortNameEn=lookupText(itemEn,raw.shortName)||'';
    const shortNameKo=lookupText(itemKo,raw.shortName)||shortNameEn;
    const description=lookupText(itemEn,raw.description)||'';
    const tasks=taskRefs.get(raw.id)||[];
    const base={id:raw.id,name:nameEn,shortName:shortNameEn,iconLink:raw.iconLink||'',wikiLink:raw.wikiLink||'',description,
      usedInTasks:tasks.map(t=>({id:t.id,name:t.name})),properties:{uses:raw.properties?.uses}};
    english.push(base);
    korean.push({id:raw.id,name:nameKo,shortName:shortNameKo,
      usedInTasks:tasks.map(t=>({id:t.id,name:t.nameKo||t.name}))});
  }
  const result=makeItems(english,korean,maps);
  for(const item of result){
    const raw=allKeys.find(x=>x.id===item.id);
    if(raw&&Array.isArray(raw.categories)&&raw.categories.map(idOf).includes('5c164d2286f774194c5e69fa'))item.keycard=true;
  }
  return {items:result,english,korean,maps,source:'json.tarkov.dev'};
}
async function loadFromJson(){
  // Minimum viable dataset is items plus the translated name file. Other feeds are optional.
  const [base,en,ko,maps,tasks,tasksEn,tasksKo]=await Promise.allSettled([
    getJson('items'),getJson('items_en'),getJson('items_ko'),getJson('maps'),getJson('tasks'),getJson('tasks_en'),getJson('tasks_ko')
  ]);
  if(base.status!=='fulfilled')throw Error(base.reason?.message||'JSON 아이템 연결 실패');
  if(en.status!=='fulfilled')throw Error(en.reason?.message||'JSON 영문 이름 연결 실패');
  const catalog=adaptJsonCatalog(base.value,en.value,ko.status==='fulfilled'?ko.value:{},
    maps.status==='fulfilled'?maps.value:null,tasks.status==='fulfilled'?tasks.value:null,
    tasksEn.status==='fulfilled'?tasksEn.value:{},tasksKo.status==='fulfilled'?tasksKo.value:{});
  catalog.warnings=[];
  if(ko.status==='rejected')catalog.warnings.push('한글 이름 일부 미제공');
  if(maps.status==='rejected')catalog.warnings.push('맵 연결 정보 미제공');
  if(tasks.status==='rejected')catalog.warnings.push('퀘스트 연관 정보 미제공');
  return catalog;
}
function jsonQuestDetail(id){
  const task=jsonQuestRecords.get(id);
  if(!task)return null;
  const en={id,name:lookupText(jsonQuestNamesEn,task.name)||validString(task.name),wikiLink:task.wikiLink||'',
    trader:typeof task.trader==='object'?task.trader:null,
    map:null,
    objectives:Array.isArray(task.objectives)?task.objectives.map(obj=>({
      id:obj.id||'',type:obj.type||'',description:lookupText(jsonQuestNamesEn,obj.description)||validString(obj.description),
      maps:Array.isArray(obj.maps)?obj.maps.map(ref=>jsonMapsById.get(idOf(ref))||ref).filter(m=>m&&typeof m==='object').map(m=>({name:m.normalizedName||m.name||'',normalizedName:m.normalizedName||m.name||''})):[]
    })):[]};
  const map=jsonMapsById.get(idOf(task.map));
  if(map)en.map={name:map.normalizedName||map.name||'',normalizedName:map.normalizedName||map.name||''};
  const ko={id,name:lookupText(jsonQuestNamesKo,task.name)||en.name,
    objectives:(Array.isArray(task.objectives)?task.objectives:[]).map(obj=>({id:obj.id||'',description:lookupText(jsonQuestNamesKo,obj.description)||lookupText(jsonQuestNamesEn,obj.description)||''}))};
  return {en,ko};
}
function readJSON(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function getOwned() { const data = readJSON(OWNED_KEY, ownedMemory); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; }
function setOwned(value) { ownedMemory = value; return writeJSON(OWNED_KEY, value); }
function normalized(s) { return String(s || '').normalize('NFKC').toLocaleLowerCase().trim(); }
function koreanMapName(name) {
  if (labels[name]) return labels[name];
  const n = normalized(name);
  if (mapLabels[n]) return mapLabels[n];
  if (n.includes('night') && n.includes('factory')) return '야간 팩토리';
  if (n.includes('factory')) return '팩토리';
  if (n.includes('labyrinth')) return '미궁';
  if (n === 'lab' || n === 'labs' || n.includes('the lab')) return '연구소';
  if (n.includes('custom')) return '세관';
  if (n.includes('reserve')) return '리저브';
  if (n.includes('shore')) return '해안선';
  if (n.includes('street')) return '스트리트';
  if (n.includes('ground zero')) return '그라운드 제로';
  if (n.includes('wood')) return '우드';
  if (n.includes('light')) return '등대';
  if (n.includes('interchange')) return '인터체인지';
  if (n.includes('terminal')) return '터미널';
  if (n.includes('icebreaker')) return '아이스브레이커';
  return String(name || '이름 미확인');
}
function keycardCheck(x) { return /keycard|key card|access card|키카드|출입 카드/i.test(`${x.nameEn} ${x.nameKo} ${x.shortNameEn}`); }
// These are NAME-BASED hints, explicitly NOT verified game locations.
function nameHint(name) {
  const value = String(name || '');
  let match = value.match(/(?:west\s*wing|westwing)(?:\s*room)?\s*(\d{3})\b/i);
  if (match) return { mapName:'해안선', text:`리조트 서관 · ${match[1][0]}층 · ${match[1]}호`, source:'이름 단서' };
  match = value.match(/(?:east\s*wing|eastwing)(?:\s*room)?\s*(\d{3})\b/i);
  if (match) return { mapName:'해안선', text:`리조트 동관 · ${match[1][0]}층 · ${match[1]}호`, source:'이름 단서' };
  match = value.match(/(?:dorm|dormitory)\s*room\s*(\d{3})\b/i);
  if (match) return { mapName:'세관', text:`기숙사 · ${match[1][0]}층 · ${match[1]}호`, source:'이름 단서' };
  if (/^RB-[A-Z0-9-]+\b/i.test(value)) return { mapName:'리저브', text:'RB- 계열 열쇠 · 방 위치 추가 확인 필요', source:'이름 단서' };
  if (/\bKIBA\b/i.test(value)) return { mapName:'인터체인지', text:'KIBA 상점 관련 · 상세 출입구 확인 필요', source:'이름 단서' };
  if (/\bULTRA\s+medical\b/i.test(value)) return { mapName:'인터체인지', text:'ULTRA 의료 구역 관련 · 상세 출입구 확인 필요', source:'이름 단서' };
  if (/\bTerraGroup\s+Labs?\b/i.test(value)) return { mapName:'연구소', text:'TerraGroup Labs 관련 · 사용 위치 확인 필요', source:'이름 단서' };
  return null;
}
// Extract only literal location words/numbers that are present in the English item name.
// A parsed room number is NOT proof that a door is in a particular building.
function roomDetails(item) {
  const english=String(item?.nameEn||'');
  const specs=[
    {re:/\b(?:health\s+resort\s+)?(west\s*wing|east\s*wing)\s*(?:room\s*)?(\d{3})\b/i,build:m=>/west/i.test(m[1])?'리조트 서관':'리조트 동관',num:2},
    {re:/\b(dorm(?:itory|s)?)\s*(?:room\s*)?(\d{3})\b/i,build:()=> '기숙사',num:2},
    {re:/\b(pinewood(?:\s+hotel)?)\s*(?:room\s*)?(\d{2,3})\b/i,build:()=> 'Pinewood',num:2},
    {re:/\b(concordia)\s*(?:(?:apartment|room)\s*)?(\d{1,3})\b/i,build:()=> 'Concordia',num:2},
    {re:/\b(chekannaya)\s*(?:(?:apartment|room)\s*)?(\d{1,3})\b/i,build:()=> 'Chekannaya',num:2}
  ];
  for(const spec of specs){
    const match=english.match(spec.re);
    if(!match)continue;
    const number=match[spec.num];
    return {building:spec.build(match),number,floor:number.length===3?number[0]+'층':'층수 미확인',evidence:match[0],source:'아이템 영문 이름'};
  }
  // Some item names identify a room without a building. Keep them non-geographic.
  const generic=english.match(/\b(?:room|apartment)\s*(?:number\s*)?(\d{2,3})\b/i);
  return generic?{building:'건물 미확인',number:generic[1],floor:'층수 미확인',evidence:generic[0],source:'아이템 영문 이름'}:null;
}
function safeExternalLink(url,title,cls){
  return typeof url==='string' && /^https:\/\//i.test(url) ? link(url,title,cls) : null;
}
// The second GraphQL call is optional, initiated only when a user expands a quest.
async function queryQuest(id){
  if(!/^[0-9a-zA-Z_-]{1,80}$/.test(String(id)))throw Error('유효하지 않은 퀘스트 ID');
  const jsonDetail=jsonQuestDetail(id);
  if(jsonDetail)return jsonDetail;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:QUEST_DETAIL_QUERY,variables:{id}}),signal:controller.signal});
    if(!response.ok)throw Error(`API HTTP ${response.status}`);
    const payload=await response.json();
    if(payload.errors?.length)throw Error(payload.errors[0].message||'퀘스트 API 오류');
    if(!payload?.data?.en)throw Error('퀘스트 상세 데이터가 없습니다.');
    return payload.data;
  }finally{clearTimeout(timeout);}
}
function getQuestDetails(id){
  if(!questDetailRequests.has(id)){
    const request=queryQuest(id).catch(error=>{questDetailRequests.delete(id);throw error;});
    questDetailRequests.set(id,request);
  }
  return questDetailRequests.get(id);
}
function questDetailsCard(task,container){
  container.replaceChildren();
  const translated=task.ko||{};
  const quest=task.en;
  const metadata=el('div','quest-meta');
  if(quest.trader?.name)metadata.append(el('span','quest-chip',`상인: ${quest.trader.name}`));
  if(quest.map?.name)metadata.append(el('span','quest-chip',`진행 맵: ${koreanMapName(quest.map.normalizedName||quest.map.name)}`));
  if(metadata.children.length)container.append(metadata);
  const objectives=Array.isArray(quest.objectives)?quest.objectives:[];
  if(objectives.length){
    const koById=new Map((translated.objectives||[]).filter(x=>x?.id).map(x=>[x.id,x.description]));
    const list=el('ol','quest-objectives');
    for(const objective of objectives.slice(0,12)){
      const li=el('li');
      const ko=koById.get(objective.id);
      li.append(el('span','',ko||objective.description||'목표 설명이 없습니다.'));
      if(ko && objective.description && ko!==objective.description)li.append(el('small','quest-english',objective.description));
      const maps=(objective.maps||[]).map(x=>koreanMapName(x?.normalizedName||x?.name)).filter(Boolean);
      if(maps.length)li.append(el('small','quest-map-note',`목표 맵: ${[...new Set(maps)].join(' · ')}`));
      list.append(li);
    }
    container.append(list);
    if(objectives.length>12)container.append(el('p','caution',`나머지 ${objectives.length-12}개 목표는 퀘스트 위키에서 확인하세요.`));
  }else container.append(el('p','caution','API에서 퀘스트 목표를 제공하지 않습니다.'));
  const url=safeExternalLink(quest.wikiLink,'퀘스트 위키에서 보기 ↗','quest-wiki');
  if(url)container.append(url);
  container.append(el('p','quest-disclaimer','주의: 위 목록은 퀘스트 전체 목표입니다. 모든 목표에 이 열쇠가 직접 쓰인다는 의미는 아닙니다.'));
}
function questPanel(task){
  const details=el('details','quest-card');
  const summary=el('summary','quest-summary');
  const name=el('span','quest-name',task.nameKo&&task.nameKo!==task.name?task.nameKo:task.name);
  if(task.nameKo&&task.nameKo!==task.name)name.append(el('small','quest-english',task.name));
  summary.append(name,el('span','quest-toggle-label','목표 확인'));
  details.append(summary);
  const contents=el('div','quest-content');
  contents.append(el('p','quest-loading','펼치면 퀘스트 목표를 불러옵니다.'));
  details.append(contents);
  let pending=false;
  details.addEventListener('toggle',async()=>{
    if(!details.open||pending||details.dataset.loaded==='true')return;
    pending=true;contents.replaceChildren(el('p','quest-loading','퀘스트 목표를 불러오는 중...'));
    try{
      const data=await getQuestDetails(task.id);
      questDetailsCard(data,contents);
      details.dataset.loaded='true';
    }catch(error){
      const msg=error?.name==='AbortError'?'연결 시간이 초과되었습니다.':String(error?.message||'연결 오류');
      contents.replaceChildren(el('p','caution',`퀘스트 상세 정보를 불러오지 못했어요: ${msg}`));
      const retry=el('button','quest-retry','다시 시도');retry.type='button';
      retry.addEventListener('click',()=>{details.open=false;requestAnimationFrame(()=>{details.open=true;});});
      contents.append(retry);
    }finally{pending=false;}
  });
  return details;
}
function displayMaps(item) {
  const verified = Array.isArray(item.mapNames) ? item.mapNames : [];
  if (verified.length) return verified;
  return item.hint?.mapName ? [item.hint.mapName] : [];
}
function prepareItem(item) {
  item.mapNames = Array.isArray(item.mapNames) ? item.mapNames : [];
  item.lockPositions = Array.isArray(item.lockPositions) ? item.lockPositions : [];
  item.tasks = Array.isArray(item.tasks) ? item.tasks : [];
  item.accessMaps = Array.isArray(item.accessMaps) ? item.accessMaps : [];
  item.hint = nameHint(item.nameEn);
  item.keycard = keycardCheck(item);
  return item;
}
function makeItems(english, korean, maps) {
  const ko = new Map((korean || []).filter(x => x?.id).map(x => [x.id, x]));
  const assigned = new Map(), access = new Map(), positions = new Map();
  for (const m of (maps || [])) {
    const mapName = koreanMapName(m?.normalizedName || m?.name);
    if (!mapName) continue;
    const insert = (target,id) => { if (!id) return; if (!target.has(id)) target.set(id,new Set()); target.get(id).add(mapName); };
    for (const a of (m?.accessKeys || [])) { insert(assigned,a?.id); insert(access,a?.id); }
    for (const lock of (m?.locks || [])) {
      const id = lock?.key?.id;
      insert(assigned,id);
      const pos = lock?.position;
      if (!id || !pos || ![pos.x,pos.y,pos.z].every(Number.isFinite)) continue;
      if (!positions.has(id)) positions.set(id,[]);
      const list = positions.get(id);
      if (!list.some(p => p.mapName===mapName && p.x===pos.x && p.y===pos.y && p.z===pos.z)) {
        list.push({mapName,x:pos.x,y:pos.y,z:pos.z,needsPower:lock.needsPower===true,lockType:String(lock.lockType||'')});
      }
    }
  }
  const unique = new Map();
  for (const item of (english || [])) {
    if (!item?.id) continue;
    const koItem = ko.get(item.id);
    const en = String(item.name || item.shortName || item.id).trim();
    const nameKo = String(koItem?.name || '').trim();
    const koTasks = new Map((koItem?.usedInTasks || []).filter(t=>t?.id).map(t=>[t.id,t.name]));
    const tasks = (item.usedInTasks || []).filter(t=>t?.id).map(t=>({id:t.id,name:t.name||'이름 미확인',nameKo:koTasks.get(t.id)||''}));
    unique.set(item.id,prepareItem({id:item.id,nameEn:en,nameKo:nameKo!==en?nameKo:'',shortNameEn:item.shortName||'',shortNameKo:koItem?.shortName||'',iconLink:item.iconLink||'',wikiLink:item.wikiLink||'',description:item.description||'',mapNames:[...(assigned.get(item.id)||[])].sort((a,b)=>a.localeCompare(b,'ko')),accessMaps:[...(access.get(item.id)||[])],tasks,lockPositions:positions.get(item.id)||[],uses:Number.isInteger(item.properties?.uses)?item.properties.uses:null}));
  }
  return [...unique.values()].sort((a,b)=>a.nameEn.localeCompare(b.nameEn,'en'));
}
function el(tag,cls,value) { const node=document.createElement(tag); if(cls)node.className=cls; if(value!==undefined)node.textContent=value; return node; }
function mapUrl(name) { const slug=mapSlugs[name]; return slug ? `https://tarkov.dev/map/${slug}` : null; }
function atlasBounds(locations){
  const xs=locations.map(x=>x.pos.x), zs=locations.map(x=>x.pos.z);
  let minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const marginX=Math.max(12,(maxX-minX)*.10),marginZ=Math.max(12,(maxZ-minZ)*.10);
  // Degenerate one-point case: a coordinate plot still renders intelligibly.
  return {minX:minX-marginX,maxX:maxX+marginX,minZ:minZ-marginZ,maxZ:maxZ+marginZ};
}
function atlasPoints(map){
  const found=[];
  for (const item of items) for(const pos of item.lockPositions||[]){
    if(pos?.mapName===map&&Number.isFinite(pos.x)&&Number.isFinite(pos.z)) found.push({item,pos});
  }
  return found;
}
function updateAtlasSelector(known){
  const sel=$('atlas-map');if(!sel)return;
  const maps=known.filter(m=>m!==undefined&&m!=='전체');
  sel.replaceChildren();for(const name of maps) sel.add(new Option(name,name));
  if(!maps.includes(atlasMap)) atlasMap=maps.includes('세관')?'세관':maps[0]||'세관';
  sel.value=atlasMap;
}
function setAtlasImage(map){
  const image=$('atlas-image'),content=$('atlas-map-content'),fallback=$('atlas-image-fallback');
  const source=MAP_PREVIEWS[map]||'', bounds=MAP_CALIBRATIONS[map];
  content.style.width=(Number($('atlas-zoom').value)||100)+'%';
  content.classList.toggle('calibrated',Boolean(source&&bounds));
  if(bounds){const dx=bounds[0][0]-bounds[1][0],dz=bounds[1][1]-bounds[0][1];content.style.setProperty('--map-ratio',`${dx} / ${dz}`);}
  else content.style.removeProperty('--map-ratio');
  if(image.dataset.source!==source){
    image.dataset.source=source;
    image.removeAttribute('src');image.hidden=true;content.hidden=!source;
    fallback.hidden=false;
    fallback.textContent=source?'지도 이미지를 불러오는 중입니다...':'이 맵은 내장 SVG 지도가 없어 지도 위 마커를 제공하지 않습니다. 외부 지도 링크를 확인하세요.';
    if(source) image.src=source;
  }
  if(source&&image.complete&&image.naturalWidth>0){image.hidden=false;content.hidden=false;fallback.hidden=true;}
  $('atlas-overlay').hidden=!source||content.hidden;
}
function overlayPosition(bounds,pos){
  if(!bounds||![pos?.x,pos?.z].every(Number.isFinite))return null;
  const dx=bounds[0][0]-bounds[1][0],dz=bounds[1][1]-bounds[0][1];
  if(!(dx>0&&dz>0))return null;
  const left=100*(bounds[0][0]-pos.x)/dx;
  const top=100*(pos.z-bounds[0][1])/dz;
  if(left<0||left>100||top<0||top>100)return null;
  return {left,top};
}
function renderAtlasOverlay(points){
  const overlay=$('atlas-overlay'),count=$('atlas-pin-count'),note=$('atlas-overlay-note');
  overlay.replaceChildren();
  const calibration=MAP_CALIBRATIONS[atlasMap];
  const preview=Boolean(MAP_PREVIEWS[atlasMap]);
  if(!calibration||!preview){
    count.textContent='마커 지원 전';
    note.textContent=atlasMap==='팩토리'?'팩토리는 다른 좌표 회전을 사용하므로 실제 지도 위 마커를 아직 제공하지 않습니다. tarkov.dev의 외부 지도 링크를 이용하세요.':'이 맵은 검증된 SVG 지도 경계가 없어 지도 위 마커를 제공하지 않습니다. tarkov.dev의 외부 지도 링크를 이용하세요.';
    overlay.hidden=true;return;
  }
  const owned=getOwned(),filter=$('atlas-pin-filter').value;
  const entries=[];
  for(const point of points){
    const has=!!owned[point.item.id];
    if((filter==='owned'&&!has)||(filter==='missing'&&has))continue;
    const place=overlayPosition(calibration,point.pos);
    if(place)entries.push({...point,...place});
  }
  // Co-located pins form one button. Clicking shows the first key; all keys
  // at this coordinate remain accessible in the key list below the plot.
  const grouped=new Map();
  for(const point of entries){
    const key=`${point.left.toFixed(4)}|${point.top.toFixed(4)}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(point);
  }
  const locations=[...grouped.values()].slice(0,MAP_PIN_LIMIT);
  for(const group of locations){
    const first=group.find(g=>g.item.id===atlasHighlightedId)||group[0];
    const pin=el('button','atlas-pin'+(owned[first.item.id]?' is-owned':'')+(first.item.id===atlasHighlightedId?' selected':'')+(group.length>1?' is-group':''),group.length>1?String(group.length):'•');
    pin.type='button';pin.style.left=first.left+'%';pin.style.top=first.top+'%';
    const names=[...new Set(group.map(g=>g.item.nameKo||g.item.nameEn))];
    const details=`${names.slice(0,4).join(', ')}${names.length>4?' 외 '+(names.length-4)+'개':''} · X ${first.pos.x}, Y ${first.pos.y}, Z ${first.pos.z}`;
    pin.title=details;pin.setAttribute('aria-label','잠긴 문: '+details);
    pin.addEventListener('click',()=>{atlasHighlightedId=first.item.id;renderAtlas();showDetail(first.item);});
    overlay.append(pin);
  }
  count.textContent=`지도 표시 ${locations.length}곳${grouped.size>MAP_PIN_LIMIT?` / ${grouped.size}곳`:''}`;
  note.textContent='지도 위 점은 tarkov.dev SVG 지도 경계·회전값에 API 잠긴 문 X/Z 좌표를 적용한 위치입니다. 층 높이(Y)는 반영되지 않으며, 패치·지도 변경에 따라 차이가 날 수 있습니다. 점을 누르면 열쇠 정보가 열립니다.';
  overlay.hidden=!$('atlas-show-pins').checked||$('atlas-map-content').hidden;
}
function focusAtlasPin(){
  const pin=$('atlas-overlay').querySelector('.atlas-pin.selected');
  if(!pin)return;
  const frame=$('atlas-frame');
  frame.scrollTo({left:Math.max(0,pin.offsetLeft-frame.clientWidth/2),top:Math.max(0,pin.offsetTop-frame.clientHeight/2),behavior:'smooth'});
}
function createSvg(name,attributes){
  const node=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,value] of Object.entries(attributes||{}))node.setAttribute(key,String(value));
  return node;
}
// v0.7.2 – linked quests for the selected map (instead of a duplicate X/Z plot).
function renderAtlasQuests(map){
  const container=$('atlas-quests'),counter=$('atlas-quest-count'),empty=$('atlas-quest-empty');
  if(!container||!counter||!empty)return;
  container.replaceChildren();
  const quests=new Map();
  for(const item of items){
    if(!displayMaps(item).includes(map))continue;
    for(const task of item.tasks||[]){
      if(!task?.id)continue;
      if(!quests.has(task.id))quests.set(task.id,{task,keys:new Map()});
      const record=quests.get(task.id);
      if(!record.task.nameKo&&task.nameKo)record.task=task;
      record.keys.set(item.id,item);
    }
  }
  const entries=[...quests.values()].sort((a,b)=>
    (a.task.nameKo||a.task.name||a.task.id).localeCompare(b.task.nameKo||b.task.name||b.task.id,'ko')
  );
  counter.textContent=`퀘스트 ${entries.length}개`;
  empty.hidden=entries.length>0;
  if(!entries.length){
    empty.textContent=items.length
      ? '현재 데이터에 이 맵의 열쇠와 연결된 퀘스트가 없습니다. 퀘스트 정보를 불러오지 못했을 수도 있으니 데이터 새로고침을 확인해 주세요.'
      : '열쇠 데이터를 불러오면 관련 퀘스트가 표시됩니다.';
    return;
  }
  const fragment=document.createDocumentFragment();
  for(const entry of entries){
    const card=questPanel(entry.task);
    card.classList.add('atlas-quest-card');
    const linked=el('div','atlas-quest-linked');
    linked.append(el('div','atlas-quest-linked-title',`관련 열쇠 · ${entry.keys.size}개`));
    const buttons=el('div','atlas-quest-key-buttons');
    for(const item of [...entry.keys.values()].sort((a,b)=>(a.nameKo||a.nameEn).localeCompare(b.nameKo||b.nameEn,'ko'))){
      const key=el('button','atlas-quest-key',(getOwned()[item.id]?'✓ ':'⚿ ')+(item.nameKo||item.nameEn));
      key.type='button';key.title='열쇠 상세 정보 보기';
      key.addEventListener('click',()=>showDetail(item));
      buttons.append(key);
    }
    linked.append(buttons);card.append(linked);fragment.append(card);
  }
  container.append(fragment);
}
function renderAtlas(){
  const root=$('atlas');if(!root)return;
  const sel=$('atlas-map');
  if(sel.value!==atlasMap&&[...sel.options].some(option=>option.value===atlasMap))sel.value=atlasMap;
  $('atlas-map-label').textContent=atlasMap;
  $('atlas-external').href=mapUrl(atlasMap)||'https://tarkov.dev/maps';
  setAtlasImage(atlasMap);
  renderAtlasOverlay(atlasPoints(atlasMap));
  renderAtlasQuests(atlasMap);
}

function link(url,title,cls) {
  const a=el('a',cls,title); a.href=url; a.target='_blank'; a.rel='noopener noreferrer'; return a;
}
// Navigation is intentionally independent of API/data loading.
// A temporary tarkov.dev error must never hide the map selection UI.
const ALWAYS_VISIBLE_MAPS = ['세관','팩토리','우드','해안선','인터체인지','리저브','스트리트','등대','연구소','그라운드 제로','미궁','터미널','아이스브레이커'];
function updateFilters() {
  const dropdown=$('map'), previous=dropdown.value;
  const counts = new Map();
  for (const item of items) for (const map of displayMaps(item)) counts.set(map,(counts.get(map)||0)+1);
  const known=[...new Set([...ALWAYS_VISIBLE_MAPS,...counts.keys()])];
  dropdown.replaceChildren(new Option('전체 맵','all'));
  for (const name of known) dropdown.add(new Option(items.length?`${name} (${counts.get(name)||0})`:name,name));
  dropdown.value=known.includes(previous)?previous:'all';
  const shortcuts=$('map-shortcuts');
  shortcuts.replaceChildren();
  for (const [label,value] of [['전체','all'],...known.map(name=>[name,name])]) {
    const button=el('button','map-shortcut',label);
    button.type='button';button.dataset.map=value;
    button.setAttribute('aria-pressed',String(dropdown.value===value));
    button.addEventListener('click',()=>{dropdown.value=value;if(value!=='all'){atlasMap=value;atlasHighlightedId=null;}render();});
    shortcuts.append(button);
  }
  updateShortcutSelection();
  updateAtlasSelector(known);
}
function updateShortcutSelection() {
  const value=$('map').value;
  for (const button of $('map-shortcuts').children) {
    const active=button.dataset.map===value;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  }
}
function matches(item,search,map,filter,type,purpose,owned) {
  if(map!=='all' && !displayMaps(item).includes(map))return false;
  if(filter==='owned' && !owned[item.id])return false;
  if(filter==='missing' && owned[item.id])return false;
  if(type==='keycard' && !item.keycard)return false;
  if(type==='key' && item.keycard)return false;
  if(purpose==='quest' && !item.tasks.length)return false;
  if(purpose==='unmapped' && item.mapNames.length)return false;
  if(purpose==='located' && !item.lockPositions.length)return false;
  if(purpose==='access' && !item.accessMaps.length)return false;
  if(purpose==='room' && !roomDetails(item))return false;
  const terms=normalized(`${item.nameKo} ${item.nameEn} ${item.shortNameEn} ${item.shortNameKo} ${displayMaps(item).join(' ')} ${item.hint?.text||''} ${roomDetails(item)?.building||''} ${roomDetails(item)?.number||''} ${item.tasks.map(t=>`${t.name} ${t.nameKo}`).join(' ')}`);
  return !search || search.split(/\s+/).every(word=>terms.includes(word));
}
function section(body,heading,content) { const s=el('section','detail-section');s.append(el('h3','',heading),content);body.append(s); }
function showDetail(item, updateAddress=true) {
  const body=$('detail-body');body.replaceChildren();
  const header=el('div','detail-top');
  if(item.iconLink){const image=el('img');image.src=item.iconLink;image.alt='';header.append(image);}
  const names=el('div');names.append(el('h2','',item.nameKo||item.nameEn));
  if(item.nameKo)names.append(el('p','',item.nameEn));header.append(names);body.append(header);
  const facts=el('div','detail-facts');
  facts.append(el('span','fact',item.keycard?'▣ 키카드/출입 카드':'⚿ 일반 열쇠'));
  if(Number.isInteger(item.uses))facts.append(el('span','fact',item.uses===0?'사용 횟수 0 · 의미 확인 필요':`사용 횟수 ${item.uses}회`));
  if(item.accessMaps.length)facts.append(el('span','fact accent','맵 입장용'));
  if(item.lockPositions.length)facts.append(el('span','fact accent',`잠긴 문 ${item.lockPositions.length}곳`));
  if(item.tasks.length)facts.append(el('span','fact accent',`연관 퀘스트 ${item.tasks.length}개`));
  body.append(facts);
  const legend=el('div','source-legend');
  legend.append(el('span','source-tag verified','API로 확인된 정보'),el('span','source-tag guessed','이름에서 추출한 단서'));
  body.append(legend);

  // Location area: confirmed game-map links and item-name hints stay separate.
  const area=el('div','location-guide');
  const maps=el('div','location-list');
  if(item.mapNames.length){
    for(const map of item.mapNames){
      const line=el('div','location-row');
      line.append(el('span','source-tag verified','API 확인'),el('strong','',map));
      const url=mapUrl(map);if(url)line.append(link(url,'지도 보기 ↗','map-link'));
      maps.append(line);
    }
  }else if(item.hint){
    const line=el('div','location-row');
    line.append(el('span','source-tag guessed','이름 단서'),el('strong','',item.hint.mapName));
    const url=mapUrl(item.hint.mapName);if(url)line.append(link(url,'지도 보기 ↗','map-link'));
    maps.append(line);
  }else maps.append(el('p','caution','API에 연결된 사용 맵이 없습니다. 아직 분류되지 않았을 수 있습니다.'));
  area.append(maps);
  const room=roomDetails(item);
  if(room){
    const info=el('div','room-info');
    info.append(el('span','source-tag guessed','이름 단서'));
    const facts=el('div','room-grid');
    for(const [heading,value] of [['건물·구역',room.building],['층',room.floor],['방·호수',room.number]]){
      const datum=el('div','room-cell');datum.append(el('small','',heading),el('strong','',value));facts.append(datum);
    }
    info.append(facts,el('p','caution',`아이템 영어 이름의 “${room.evidence}”에서 추출했습니다. 실제 사용 위치를 별도 검증한 정보는 아닙니다.`));
    area.append(info);
  }else if(item.hint){
    area.append(el('p','caution',item.hint.text+' · 열쇠 이름 단서이며 방 번호는 추가 확인이 필요합니다.'));
  }else area.append(el('p','caution','아이템 이름으로부터 건물·층·방 번호를 확실하게 분리할 수 없습니다. 위키에서 사용처를 확인해 주세요.'));
  section(body,'사용 맵 · 건물 · 방 안내',area);

  if(item.lockPositions.length){
    const wrapper=el('div','coordinates');
    const fmt=n=>Number(n).toFixed(1).replace(/\.0$/,'');
    for(const pos of item.lockPositions.slice(0,50)){
      const row=el('div','coord-row');
      const left=el('div','coord-details');
      left.append(el('strong','',pos.mapName),el('code','',`X ${fmt(pos.x)} · Y ${fmt(pos.y)} · Z ${fmt(pos.z)}`));
      if(pos.needsPower)left.append(el('small','coord-power','⚡ API: 전력 필요'));
      row.append(left);
      const jump=el('button','coord-jump','지도에서 보기');jump.type='button';
      jump.addEventListener('click',()=>{
        atlasMap=pos.mapName;atlasHighlightedId=item.id;
        closeDetail();renderAtlas();focusAtlasPin();
        $('atlas').scrollIntoView({behavior:'smooth',block:'start'});
      });
      row.append(jump);wrapper.append(row);
    }
    if(item.lockPositions.length>50)wrapper.append(el('p','caution',`좌표가 너무 많아 나머지 ${item.lockPositions.length-50}곳은 생략했습니다.`));
    wrapper.append(el('p','caution','좌표는 tarkov.dev API 데이터 기준입니다. 층(Y) 높이와 지도 이미지 위치가 완전히 일치하는지는 맵별로 확인이 필요합니다.'));
    section(body,'잠긴 문 위치 · 지도 바로가기',wrapper);
  }else section(body,'잠긴 문 위치',el('p','caution','API에 잠긴 문 좌표가 등록되어 있지 않습니다. 문이 없다는 의미는 아닙니다.'));

  if(item.accessMaps.length){
    section(body,'맵 진입용 열쇠',el('p','',`${item.accessMaps.join(', ')}에 접근하기 위한 아이템으로 API에 등록되어 있습니다.`));
  }

  const quests=el('div','quest-panel');
  if(item.tasks.length){
    quests.append(el('p','quest-intro','퀘스트를 눌러 담당 상인, 진행 맵, 전체 목표를 확인하세요. 목표 정보는 클릭 시에만 추가로 불러옵니다.'));
    for(const task of item.tasks)quests.append(questPanel(task));
  }else quests.append(el('p','caution','API에 연결된 관련 퀘스트가 없습니다. 이 열쇠가 퀘스트에서 쓰이지 않는다는 확정 정보는 아닙니다.'));
  section(body,`관련 퀘스트${item.tasks.length?' · '+item.tasks.length+'개':''}`,quests);

  if(item.description)section(body,'아이템 설명 (영어 원문)',el('p','',item.description));
  const more=el('div','detail-actions');
  const wiki=safeExternalLink(item.wikiLink,'열쇠 위키에서 사용처 확인 ↗','detail-action-link');if(wiki)more.append(wiki);
  const share=el('button','share-btn','🔗 이 열쇠 링크 복사');share.type='button';
  share.addEventListener('click',async()=>{
    const url=new URL(window.location.href);url.searchParams.set('key',item.id);
    try{await navigator.clipboard.writeText(url.href);share.textContent='✓ 링크 복사 완료';}
    catch{window.prompt('이 링크를 복사하세요:',url.href);}
  });
  more.append(share);section(body,'공유 · 원문 확인',more);
  if(updateAddress){const url=new URL(window.location.href);url.searchParams.set('key',item.id);history.replaceState(null,'',url);}
  if(!$('detail').open)$('detail').showModal();
}
function closeDetail(){ $('detail').close();const url=new URL(window.location.href);url.searchParams.delete('key');history.replaceState(null,'',url); }
function cardFor(item,owned){
  const card=el('article','card'+(owned[item.id]?' is-owned':''));
  const tags=el('div','card-header');
  tags.append(el('span','tag'+(item.mapNames.length?' verified':item.hint?' inferred':''),item.mapNames.length?`${item.mapNames.length}개 맵 확인`:item.hint?'맵 이름 단서':'맵 미확인'));
  if(item.tasks.length)tags.append(el('span','tag quest','퀘스트'));
  card.append(tags);
  const image=el('div','card-image');if(item.iconLink){const img=el('img');img.loading='lazy';img.alt='';img.src=item.iconLink;image.append(img);}else image.append(el('span','no-image','⚿'));card.append(image);
  card.append(el('h3','',item.nameKo||item.nameEn),el('div','subname',item.nameKo?item.nameEn:(item.shortNameEn||' ')));
  const effective=displayMaps(item);
  card.append(el('div','map-chip',(item.mapNames.length?'✓ ':'? ')+(effective.join(' · ') || '사용 맵 확인 필요')));
  if(item.hint)card.append(el('div','hint-chip',`⌕ ${item.hint.text}`));
  const room=roomDetails(item);if(room)card.append(el('div','room-chip',`▣ ${room.building} · ${room.number}호 (이름 단서)`));
  if(item.lockPositions.length)card.append(el('div','position-hint',`⌖ 잠긴 문 좌표 ${item.lockPositions.length}곳`));
  if(item.accessMaps.length)card.append(el('div','position-hint','↗ 맵 입장용 열쇠'));
  const bottom=el('div','card-bottom'),label=el('label','owned-label'),check=el('input');check.type='checkbox';check.checked=!!owned[item.id];check.setAttribute('aria-label',`${item.nameKo||item.nameEn} 보유 체크`);
  check.addEventListener('change',()=>{const updated={...getOwned()};if(check.checked)updated[item.id]=true;else delete updated[item.id];if(!setOwned(updated))$('status').textContent='보유 기록 저장 실패: 브라우저 저장 설정을 확인하세요.';render();});
  label.append(check,document.createTextNode('보유 중'));bottom.append(label);
  const detail=el('button','detail-btn','상세 보기');detail.type='button';detail.addEventListener('click',()=>showDetail(item));bottom.append(detail);card.append(bottom);
  return card;
}
function render(){
  const owned=getOwned();const search=normalized($('search').value),map=$('map').value,filter=$('filter').value,type=$('type').value,purpose=$('purpose').value,sort=$('sort').value;
  const visible=items.filter(item=>matches(item,search,map,filter,type,purpose,owned));
  if(sort==='owned')visible.sort((a,b)=>Number(!!owned[b.id])-Number(!!owned[a.id])||a.nameEn.localeCompare(b.nameEn));
  if(sort==='missing')visible.sort((a,b)=>Number(!!owned[a.id])-Number(!!owned[b.id])||a.nameEn.localeCompare(b.nameEn));
  const ownedCount=items.reduce((sum,item)=>sum+(owned[item.id]?1:0),0);
  $('stat-total').textContent=items.length.toLocaleString('ko-KR');$('stat-owned').textContent=ownedCount.toLocaleString('ko-KR');$('stat-remaining').textContent=(items.length-ownedCount).toLocaleString('ko-KR');
  const percent=items.length?Math.round(100*ownedCount/items.length):0;$('stat-percent').textContent=percent+'%';$('progress-bar').style.width=percent+'%';
  $('result-count').textContent=`${visible.length.toLocaleString('ko-KR')}개 표시`;
  const fragment=document.createDocumentFragment();
  if(!visible.length){
    const empty=el('div','empty',items.length?'검색 결과가 없습니다. 검색어·맵·종류·보유 필터를 확인해 주세요.':'열쇠 데이터를 아직 불러오지 못했습니다. 위쪽 데이터 연결 상태를 확인해 주세요.');
    if(items.length){
      const reset=el('button','reset-filter-btn','검색어 및 필터 전체 초기화');reset.type='button';
      reset.addEventListener('click',()=>{ $('search').value='';$('map').value='all';$('filter').value='all';$('type').value='all';$('purpose').value='all';$('sort').value='name';render();});
      empty.append(reset);
    }
    fragment.append(empty);
  }
  else for(const item of visible)fragment.append(cardFor(item,owned));
  $('cards').replaceChildren(fragment);
  updateShortcutSelection();
  renderAtlas();
}
function maybeOpenSharedItem(){
  const id=new URL(window.location.href).searchParams.get('key');
  if(!id||!items.length||$('detail').open)return;
  const found=items.find(item=>item.id===id);
  if(found)showDetail(found,false);
  else if(!initialLinkHandled)$('status').textContent+=' · 공유된 열쇠를 현재 목록에서 찾을 수 없습니다.';
  initialLinkHandled=true;
}
async function graphql(query,field){
  const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`API HTTP ${response.status}`);
  const body=await response.json();
  if(!Array.isArray(body?.data?.[field]))throw Error(body?.errors?.[0]?.message||'API 응답 구조 오류');
  return {data:body.data[field],warning:body.errors?.length?'일부 정보 누락':null};
}
function status(message){$('status').textContent=message;}
function cachedItems(){
  for(const key of [CACHE_KEY,...OLD_CACHE_KEYS]){
    const cache=readJSON(key,null);
    if(Array.isArray(cache?.items)&&cache.items.length)return cache.items.map(prepareItem);
  }
  return [];
}
async function load(force=false){
  const current=++loadSequence;
  const cache=cachedItems();
  if(cache.length&&!items.length){items=cache;updateFilters();render();status('저장된 목록 표시 중 · 최신 데이터 확인 중...');maybeOpenSharedItem();}
  else status('JSON API에서 열쇠 데이터를 불러오는 중...');
  let catalog=null;
  let errors=[];
  try{ catalog=await loadFromJson(); }
  catch(error){errors.push('JSON: '+String(error?.message||error));}
  if(current!==loadSequence)return;
  if(!catalog){
    status('JSON API 연결 실패. 기존 GraphQL 데이터 확인 중...');
    try{
      const [en,ko,maps]=await Promise.allSettled([graphql(queryEnglish,'items'),graphql(queryKorean,'items'),graphql(queryMaps,'maps')]);
      if(en.status!=='fulfilled')throw en.reason||Error('GraphQL 영문 열쇠 연결 실패');
      const fresh=makeItems(en.value.data,ko.status==='fulfilled'?ko.value.data:[],maps.status==='fulfilled'?maps.value.data:[]);
      if(!fresh.length)throw Error('GraphQL 열쇠 목록 0개');
      catalog={items:fresh,source:'GraphQL',warnings:[]};
      if(ko.status==='rejected')catalog.warnings.push('한국어 번역 로딩 실패');
      if(maps.status==='rejected')catalog.warnings.push('맵 데이터 로딩 실패');
    }catch(error){errors.push('GraphQL: '+String(error?.message||error));}
  }
  if(current!==loadSequence)return;
  if(!catalog){
    status((items.length?'기존 저장 목록을 사용하는 중 · 최신 데이터 갱신 실패':'열쇠 데이터 불러오기 실패')+' · '+errors.join(' / ')+' · 다시 시도 버튼을 눌러주세요.');
    render();return;
  }
  // Restore extra fields when a secondary dataset is unavailable, never wipe ownership.
  const previousById=new Map(items.map(x=>[x.id,x]));
  for(const item of catalog.items){
    const old=previousById.get(item.id);if(!old)continue;
    if(!item.nameKo)item.nameKo=old.nameKo||'';
    if(!item.mapNames.length&&(!catalog.maps?.length)){
      item.mapNames=old.mapNames||[];item.lockPositions=old.lockPositions||[];item.accessMaps=old.accessMaps||[];
    }
    if(!item.tasks.length&&!catalog.warnings?.includes('퀘스트 연관 정보 미제공'))continue;
    if(!item.tasks.length&&old.tasks?.length)item.tasks=old.tasks;
    prepareItem(item);
  }
  items=catalog.items;updateFilters();render();maybeOpenSharedItem();
  const wrote=writeJSON(CACHE_KEY,{version:4,timestamp:Date.now(),items});
  const mapped=items.filter(x=>x.mapNames.length).length;
  const warning=[...(catalog.warnings||[])];if(!wrote)warning.push('아이템 캐시 저장 실패 (보유 기록은 별도)');
  status(`열쇠 ${items.length}개 로딩 성공 · ${catalog.source} · 맵 확인 ${mapped}개`+(warning.length?' · '+warning.join(' / '):''));
}
$('atlas-map').addEventListener('change',event=>{atlasMap=event.target.value;atlasHighlightedId=null;renderAtlas();});
$('atlas-image').addEventListener('load',()=>{const img=$('atlas-image');if(img.naturalWidth>0){img.hidden=false;$('atlas-map-content').hidden=false;$('atlas-image-fallback').hidden=true;$('atlas-overlay').hidden=!$('atlas-show-pins').checked||!MAP_CALIBRATIONS[atlasMap];}});
$('atlas-image').addEventListener('error',()=>{const img=$('atlas-image');img.hidden=true;$('atlas-map-content').hidden=true;$('atlas-overlay').hidden=true;$('atlas-image-fallback').hidden=false;$('atlas-image-fallback').textContent='지도를 불러오지 못했어요. 외부 지도 링크를 확인해 주세요.';});
$('atlas-zoom').addEventListener('input',event=>{
  const frame=$('atlas-frame'),content=$('atlas-map-content');
  const centerX=(frame.scrollLeft+frame.clientWidth/2)/Math.max(1,content.scrollWidth);
  const centerY=(frame.scrollTop+frame.clientHeight/2)/Math.max(1,content.scrollHeight);
  $('atlas-zoom-value').textContent=event.target.value+'%';
  content.style.width=event.target.value+'%';
  requestAnimationFrame(()=>{
    frame.scrollLeft=Math.max(0,centerX*content.scrollWidth-frame.clientWidth/2);
    frame.scrollTop=Math.max(0,centerY*content.scrollHeight-frame.clientHeight/2);
  });
});
$('atlas-show-pins').addEventListener('change',()=>renderAtlasOverlay(atlasPoints(atlasMap)));
$('atlas-pin-filter').addEventListener('change',()=>renderAtlasOverlay(atlasPoints(atlasMap)));
for(const id of ['search','map','filter','type','purpose','sort'])$(id).addEventListener(id==='search'?'input':'change',()=>{if(id==='map'&&$('map').value!=='all'){atlasMap=$('map').value;atlasHighlightedId=null;}render();});
$('refresh').addEventListener('click',()=>load(true));
$('close-detail').addEventListener('click',closeDetail);
$('detail').addEventListener('click',event=>{if(event.target===$('detail'))closeDetail();});
$('detail').addEventListener('close',()=>{const url=new URL(window.location.href);if(url.searchParams.has('key')){url.searchParams.delete('key');history.replaceState(null,'',url);}});
$('export').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({version:1,owned:getOwned(),exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),anchor=el('a');anchor.href=url;anchor.download='tarkov-key-guide-backup.json';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
});
$('import').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>2*1024*1024)throw Error('백업 파일이 너무 큽니다.');
    const data=JSON.parse(await file.text());
    if(data.version!==1||!data.owned||typeof data.owned!=='object'||Array.isArray(data.owned))throw Error('지원하지 않는 백업 형식입니다.');
    const clean=Object.create(null);for(const [id,value] of Object.entries(data.owned))if(/^[0-9a-zA-Z]{1,64}$/.test(id)&&value===true)clean[id]=true;
    if(!setOwned(clean))throw Error('브라우저에 기록을 저장할 수 없습니다.');
    render();alert('보유 현황을 가져왔습니다.');
  }catch(error){alert('백업 가져오기 실패: '+error.message);}finally{event.target.value='';}
});
window.addEventListener('storage',event=>{if(event.key===OWNED_KEY)render();});
window.addEventListener('popstate',()=>{if($('detail').open)$('detail').close();maybeOpenSharedItem();});
updateFilters(); // Map buttons appear immediately, even before the API responds.
render();
load();
