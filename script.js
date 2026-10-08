'use strict';
// Tarkov Key Guide v0.6. GitHub Pages, no account, no backend.
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
    fallback.textContent=source?'지도 이미지를 불러오는 중입니다...':'이 맵은 내장 SVG 지도가 없어 지도 위 마커를 제공하지 않습니다. 외부 지도 및 좌표 분포도를 확인하세요.';
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
    note.textContent=atlasMap==='팩토리'?'팩토리는 다른 좌표 회전을 사용하므로 실제 지도 위 마커를 아직 제공하지 않습니다. 우측 좌표 분포도를 이용하세요.':'이 맵은 검증된 SVG 지도 경계가 없어 지도 위 마커를 제공하지 않습니다. 우측 좌표 분포도를 이용하세요.';
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
function renderAtlas(){
  const root=$('atlas');if(!root)return;
  const sel=$('atlas-map');if(sel.value!==atlasMap){if([...sel.options].some(o=>o.value===atlasMap))sel.value=atlasMap;}
  $('atlas-map-label').textContent=atlasMap;
  $('atlas-external').href=mapUrl(atlasMap)||'https://tarkov.dev/maps';
  setAtlasImage(atlasMap);
  const points=atlasPoints(atlasMap);
  const keyIds=new Set(points.map(p=>p.item.id));
  $('atlas-count').textContent=`확인된 좌표 ${points.length}곳 · 열쇠 ${keyIds.size}종`;
  const plot=$('atlas-plot');plot.replaceChildren();
  const keyList=$('atlas-keys');keyList.replaceChildren();
  $('atlas-empty').hidden=points.length>0;
  renderAtlasOverlay(points);
  if(!points.length){$('atlas-empty').textContent=items.length?'현재 데이터에서 이 맵의 잠긴 문 좌표가 확인되지 않았어요.':'열쇠 데이터 로딩 후 위치가 표시돼요.';return;}
  const bounds=atlasBounds(points);const width=410,height=264,left=28,top=24;
  const px=x=>left+(x-bounds.minX)/(bounds.maxX-bounds.minX)*width;
  const py=z=>top+height-(z-bounds.minZ)/(bounds.maxZ-bounds.minZ)*height;
  for(let i=0;i<=4;i++){
    const x=left+width*i/4,z=top+height*i/4;
    plot.append(createSvg('line',{x1:x,y1:top,x2:x,y2:top+height,class:'atlas-gridline'}));
    plot.append(createSvg('line',{x1:left,y1:z,x2:left+width,y2:z,class:'atlas-gridline'}));
  }
  const axisTitle=createSvg('text',{x:left,y:13,class:'atlas-axis'});axisTitle.textContent='좌표 분포도 · X/Z';plot.append(axisTitle);
  const axisX=createSvg('text',{x:left,y:311,class:'atlas-axis'});axisX.textContent=`X ${Math.round(bounds.minX)} ~ ${Math.round(bounds.maxX)}`;plot.append(axisX);
  const axisZ=createSvg('text',{x:308,y:311,class:'atlas-axis'});axisZ.textContent=`Z ${Math.round(bounds.minZ)} ~ ${Math.round(bounds.maxZ)}`;plot.append(axisZ);
  // 3000+ markers can slow browsers; keep plot performant without hiding the count.
  for(const {item,pos} of points.slice(0,700)){
    const isActive=item.id===atlasHighlightedId;
    const marker=createSvg('circle',{cx:px(pos.x).toFixed(2),cy:py(pos.z).toFixed(2),r:isActive?7:5,tabindex:0,role:'button',class:'atlas-marker'+(isActive?' selected':'')});
    const title=createSvg('title');title.textContent=`${item.nameKo||item.nameEn} · X ${pos.x} · Z ${pos.z}`;marker.append(title);
    const activate=()=>{atlasHighlightedId=item.id;renderAtlas();showDetail(item);};
    marker.addEventListener('click',activate);
    marker.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});
    plot.append(marker);
  }
  if(points.length>700){const warning=createSvg('text',{x:left,y:300,class:'atlas-axis'});warning.textContent=`처음 700개 점 표시 / 전체 ${points.length}개`;plot.append(warning);}
  const seen=new Set();
  for(const {item,pos} of points){
    if(seen.has(item.id))continue;seen.add(item.id);
    const button=el('button','atlas-key'+(item.id===atlasHighlightedId?' selected':''));button.type='button';
    button.append(el('span','',item.nameKo||item.nameEn),el('small','',`X ${Number(pos.x).toFixed(1)} · Z ${Number(pos.z).toFixed(1)}`));
    button.addEventListener('click',()=>{atlasHighlightedId=item.id;renderAtlas();showDetail(item);});
    keyList.append(button);
  }
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
  const terms=normalized(`${item.nameKo} ${item.nameEn} ${item.shortNameEn} ${item.shortNameKo} ${displayMaps(item).join(' ')} ${item.hint?.text||''} ${item.tasks.map(t=>`${t.name} ${t.nameKo}`).join(' ')}`);
  return !search || search.split(/\s+/).every(word=>terms.includes(word));
}
function section(body,heading,content) { const s=el('section','detail-section');s.append(el('h3','',heading),content);body.append(s); }
function showDetail(item, updateAddress=true) {
  const body=$('detail-body'); body.replaceChildren();
  const header=el('div','detail-top');
  if(item.iconLink){const image=el('img');image.src=item.iconLink;image.alt='';header.append(image);}
  const names=el('div');names.append(el('h2','',item.nameKo||item.nameEn));if(item.nameKo)names.append(el('p','',item.nameEn));header.append(names);body.append(header);
  const status=el('div','detail-facts');
  status.append(el('span','fact',item.keycard?'▣ 키카드/출입 카드':'⚿ 일반 열쇠'));
  if(Number.isInteger(item.uses))status.append(el('span','fact',item.uses===0?'사용 횟수: 0 (의미 확인 필요)':`사용 횟수: ${item.uses}회`));
  if(item.accessMaps.length) status.append(el('span','fact accent','맵 입장용 열쇠'));
  if(item.tasks.length)status.append(el('span','fact accent',`연관 퀘스트 ${item.tasks.length}개`));
  body.append(status);
  const mapWrap=el('div','location-list');
  if(item.mapNames.length) {
    for (const map of item.mapNames){const line=el('div','location-row');line.append(el('span','source-tag verified','API 확인'),el('strong','',map));const url=mapUrl(map);if(url)line.append(link(url,'지도 보기 ↗','map-link'));mapWrap.append(line);}
  } else if(item.hint) {
    const line=el('div','location-row');line.append(el('span','source-tag guessed','이름 단서'),el('strong','',item.hint.mapName));const url=mapUrl(item.hint.mapName);if(url)line.append(link(url,'지도 보기 ↗','map-link'));mapWrap.append(line);
    mapWrap.append(el('p','caution','맵이 API로 확인되지 않아 열쇠 이름을 근거로 안내합니다. 실제 사용처는 위키에서 확인하세요.'));
  } else mapWrap.append(el('p','caution','공개 데이터에서 사용 맵 연결을 확인할 수 없습니다.'));
  section(body,'사용 맵',mapWrap);
  if(item.hint) section(body,'건물 · 층 · 방 정보 (이름 단서)',el('p','caution',`${item.hint.text} — 아이템 이름에 있는 정보로 구성한 안내이며, 실제 사용 가능 위치의 검증 자료는 아닙니다.`));
  if(item.lockPositions.length) {
    const wrapper=el('div','coordinates');
    const format=n=>Number(n).toFixed(1).replace(/\.0$/,'');
    for(const pos of item.lockPositions.slice(0,50)) {
      const p=el('div','coord-row');
      p.append(el('strong','',pos.mapName),el('code','',`X ${format(pos.x)} · Y ${format(pos.y)} · Z ${format(pos.z)}`));
      if(pos.needsPower)p.append(el('span','fact warning','전력 필요 (API)'));
      wrapper.append(p);
    }
    if(item.lockPositions.length>50)wrapper.append(el('p','caution',`나머지 ${item.lockPositions.length-50}개 위치는 생략했습니다.`));
    wrapper.append(el('p','caution','API 지도 좌표이며 게임 내 월드 좌표와 다를 수 있습니다. 정확한 출입구와 층수는 맵 또는 위키에서 확인하세요.'));
    const atlasBtn=el('button','atlas-link','⌖ 맵 위치 탐색에서 보기');atlasBtn.type='button';
    atlasBtn.addEventListener('click',()=>{
      const first=item.lockPositions.find(pos=>pos?.mapName&&Number.isFinite(pos.x)&&Number.isFinite(pos.z));
      if(!first)return;
      atlasMap=first.mapName;atlasHighlightedId=item.id;
      closeDetail();renderAtlas();
      focusAtlasPin();
      $('atlas').scrollIntoView({behavior:'smooth',block:'start'});
    });
    wrapper.append(atlasBtn);
    section(body,'잠긴 문 좌표 (API 제공)',wrapper);
  }
  if(item.accessMaps.length)section(body,'맵 진입에 필요한 열쇠',el('p','',`${item.accessMaps.join(', ')} 입장용으로 API에 등록되어 있습니다.`));
  if(item.tasks.length){const ul=el('ul','quest-list');for(const t of item.tasks){const li=el('li');li.append(el('strong','',t.nameKo&&t.nameKo!==t.name?t.nameKo:t.name));if(t.nameKo&&t.nameKo!==t.name)li.append(el('small','',t.name));ul.append(li);}section(body,'관련 퀘스트 (API 연관 정보)',ul);}
  else section(body,'관련 퀘스트',el('p','caution','API에 연결된 퀘스트가 없습니다. 퀘스트에 필요하지 않다는 확정 정보는 아닙니다.'));
  if(item.description)section(body,'아이템 설명 (영문)',el('p','',item.description));
  const more=el('div','detail-actions');
  if(/^https:\/\//i.test(item.wikiLink)) more.append(link(item.wikiLink,'위키에서 정확한 방 위치 확인 ↗','detail-action-link'));
  const share=el('button','share-btn','🔗 이 열쇠 링크 복사');share.type='button';
  share.addEventListener('click',async()=>{
    const url=new URL(window.location.href);url.searchParams.set('key',item.id);
    try{await navigator.clipboard.writeText(url.href);share.textContent='✓ 링크 복사 완료';}
    catch{window.prompt('이 링크를 복사하세요:',url.href);}
  });
  more.append(share);section(body,'추가 정보 · 공유',more);
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
  if(!visible.length)fragment.append(el('p','empty',items.length?'선택한 맵에 확인된 열쇠가 없거나 맵 연결 데이터가 누락되었습니다. 다른 맵이나 전체를 선택해 보세요.':'열쇠 데이터가 아직 없습니다. 데이터 연결 상태를 확인해 주세요.'));
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
  if(cache.length && !items.length){items=cache;updateFilters();render();status('저장된 목록 표시 중 · 최신 데이터 확인 중...');maybeOpenSharedItem();}
  else status('tarkov.dev에서 최신 열쇠 정보를 확인하는 중...');
  const [en,ko,maps]=await Promise.allSettled([graphql(queryEnglish,'items'),graphql(queryKorean,'items'),graphql(queryMaps,'maps')]);
  if(current!==loadSequence)return;
  if(en.status!=='fulfilled'){
    status(items.length?`저장된 목록 사용 중 · 갱신 실패: ${en.reason?.message||'연결 오류'}`:`열쇠 데이터 오류: ${en.reason?.message||'연결 실패'} · 잠시 후 새로고침해 주세요.`);
    render();return;
  }
  const previousById=new Map((items||[]).map(x=>[x.id,x]));
  const fresh=makeItems(en.value.data,ko.status==='fulfilled'?ko.value.data:[],maps.status==='fulfilled'?maps.value.data:[]);
  if(!fresh.length){status('API에서 0개가 반환되었습니다. 기존 목록을 보존합니다.');return;}
  // If secondary API fails, preserve previously verified translations, maps and coordinates.
  for(const item of fresh){const old=previousById.get(item.id);if(!old)continue;
    if(ko.status!=='fulfilled'){item.nameKo=old.nameKo||'';item.shortNameKo=old.shortNameKo||'';item.tasks=item.tasks.map(t=>({...t,nameKo:old.tasks?.find(o=>o.id===t.id)?.nameKo||''}));}
    if(maps.status!=='fulfilled'){item.mapNames=old.mapNames||[];item.accessMaps=old.accessMaps||[];item.lockPositions=old.lockPositions||[];}
    prepareItem(item);
  }
  items=fresh;updateFilters();render();writeJSON(CACHE_KEY,{version:4,timestamp:Date.now(),items});maybeOpenSharedItem();
  const mapped=items.filter(x=>x.mapNames.length).length,inferred=items.filter(x=>!x.mapNames.length&&x.hint).length,coordinates=items.filter(x=>x.lockPositions.length).length;
  const warnings=[];if(ko.status==='rejected')warnings.push('한국어 데이터 갱신 실패');if(maps.status==='rejected')warnings.push('맵 정보 API 오류: '+String(maps.reason?.message||'연결 실패'));
  for(const response of [en,ko,maps])if(response.status==='fulfilled'&&response.value.warning)warnings.push(response.value.warning);
  status(`${items.length}개 · API 맵 확인 ${mapped}개 · 이름 단서 ${inferred}개 · 문 좌표 ${coordinates}개${warnings.length?' · '+[...new Set(warnings)].join(' / '):''}`);
}
$('atlas-map').addEventListener('change',event=>{atlasMap=event.target.value;atlasHighlightedId=null;renderAtlas();});
$('atlas-image').addEventListener('load',()=>{const img=$('atlas-image');if(img.naturalWidth>0){img.hidden=false;$('atlas-map-content').hidden=false;$('atlas-image-fallback').hidden=true;$('atlas-overlay').hidden=!$('atlas-show-pins').checked||!MAP_CALIBRATIONS[atlasMap];}});
$('atlas-image').addEventListener('error',()=>{const img=$('atlas-image');img.hidden=true;$('atlas-map-content').hidden=true;$('atlas-overlay').hidden=true;$('atlas-image-fallback').hidden=false;$('atlas-image-fallback').textContent='지도를 불러오지 못했어요. 외부 지도 링크나 우측 좌표 분포도를 사용해 주세요.';});
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
