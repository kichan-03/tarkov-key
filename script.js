'use strict';
// Tarkov Key Guide v0.3 — GitHub Pages (no backend, no login).
const API = 'https://api.tarkov.dev/graphql';
const OWNED_KEY = 'tarkov-key-guide-owned-v1'; // Keep old key; v0.1 ownership persists.
const CACHE_KEY = 'tarkov-key-guide-items-v3';
const queryEnglish = `query { items(types:[keys],lang:en) { id name shortName iconLink wikiLink description usedInTasks { id name } properties { ... on ItemPropertiesKey { uses } } } }`;
const queryKorean = `query { items(types:[keys],lang:ko) { id name shortName usedInTasks { id name } } }`;
const queryMaps = `query { maps { name normalizedName accessKeys { id } locks { key { id } position { x y z } } } }`;
const $ = id => document.getElementById(id);
const labels = { 'Customs':'세관', 'Factory':'팩토리', 'Factory (Night)':'야간 팩토리', 'Woods':'우드', 'Shoreline':'해안선', 'Interchange':'인터체인지', 'Reserve':'리저브', 'Lighthouse':'등대', 'Streets of Tarkov':'스트리트', 'The Lab':'연구소', 'Ground Zero':'그라운드 제로', 'Terminal':'터미널', 'The Labyrinth':'미궁', 'Icebreaker':'아이스브레이커' };
let items = [];
let ownedMemory = {};
let lastApiTimestamp = null;
let loadSequence = 0;
function readJSON(key, fallback) { try { const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback; } catch {return fallback;} }
function writeJSON(key, value) { try {localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;} }
function getOwned() { const data=readJSON(OWNED_KEY,ownedMemory);return data && typeof data==='object'&&!Array.isArray(data)?data:{}; }
function setOwned(value) {ownedMemory=value;return writeJSON(OWNED_KEY,value);}
function normalizeName(s){return (s||'').normalize('NFKC').toLocaleLowerCase().trim();}
function koreanMapName(name) {
  if(labels[name])return labels[name];
  const n=(name||'').toLowerCase();
  if(n.includes('night') && n.includes('factory'))return '야간 팩토리';
  if(n.includes('factory'))return '팩토리';
  if(n.includes('labyrinth'))return '미궁';
  if(n.includes('lab'))return '연구소';
  if(n.includes('custom'))return '세관';
  if(n.includes('reserve'))return '리저브';
  if(n.includes('shore'))return '해안선';
  if(n.includes('street'))return '스트리트';
  if(n.includes('ground zero'))return '그라운드 제로';
  if(n.includes('wood'))return '우드';
  if(n.includes('light'))return '등대';
  if(n.includes('interchange'))return '인터체인지';
  if(n.includes('terminal'))return '터미널';
  if(n.includes('icebreaker'))return '아이스브레이커';
  return name || '이름 미확인';
}
function keycardCheck(item){return /keycard|key card|access card|카드|키카드/i.test(`${item.nameEn} ${item.nameKo} ${item.shortNameEn}`);}
function makeItems(english,korean,maps){
  const ko = new Map((korean||[]).filter(x=>x?.id).map(x=>[x.id,x]));
  const assigned = new Map();
  const positions = new Map();
  for(const m of (maps||[])){
    const mapName=koreanMapName(m?.name||m?.normalizedName);
    if(!mapName)continue;
    const ids=[...(m?.locks||[]).map(x=>x?.key?.id),...(m?.accessKeys||[]).map(x=>x?.id)];
    for (const lock of (m?.locks||[])) {
      const id=lock?.key?.id, pos=lock?.position;
      if(!id || !pos || ![pos.x,pos.y,pos.z].every(Number.isFinite)) continue;
      if(!positions.has(id)) positions.set(id,[]);
      const list=positions.get(id);
      const key=`${mapName}|${pos.x}|${pos.y}|${pos.z}`;
      if(!list.some(entry=>entry.key===key)) list.push({key,mapName,x:pos.x,y:pos.y,z:pos.z});
    }
    for(const id of ids){if(!id)continue; if(!assigned.has(id))assigned.set(id,new Set());assigned.get(id).add(mapName);}
  }
  const dedup=new Map();
  for(const x of english||[]){
    if(!x?.id)continue;
    const koItem=ko.get(x.id);
    const en=(x.name||x.shortName||x.id).trim();
    const nameKo=(koItem?.name||'').trim();
    const mapNames=[...(assigned.get(x.id)||[])].sort((a,b)=>a.localeCompare(b,'ko'));
    const koTasks = new Map((koItem?.usedInTasks||[]).filter(t=>t?.id).map(t=>[t.id,t.name]));
    const tasks=(Array.isArray(x.usedInTasks)?x.usedInTasks:[]).filter(t=>t?.id).map(t=>({id:t.id,name:t.name||'이름 미확인',nameKo:koTasks.get(t.id)||''}));
    const item={id:x.id,nameEn:en,nameKo:nameKo&&nameKo!==en?nameKo:'',shortNameEn:x.shortName||'',shortNameKo:koItem?.shortName||'',iconLink:x.iconLink||'',wikiLink:x.wikiLink||'',description:x.description||'',mapNames,tasks,lockPositions:positions.get(x.id)||[],uses:Number.isInteger(x.properties?.uses)?x.properties.uses:null};
    item.keycard=keycardCheck(item);
    dedup.set(x.id,item);
  }
  return [...dedup.values()].sort((a,b)=>a.nameEn.localeCompare(b.nameEn,'en'));
}
function text(tag,cls,value){const node=document.createElement(tag);if(cls)node.className=cls;node.textContent=value;return node;}
function updateFilters(){
  const dropdown=$('map'), old=dropdown.value;
  dropdown.replaceChildren(new Option('전체 맵','all'));
  const all=[...new Set(items.flatMap(x=>x.mapNames))].sort((a,b)=>a.localeCompare(b,'ko'));
  for(const name of all)dropdown.add(new Option(name,name));
  if(all.includes(old))dropdown.value=old;
}
function matches(x,search,map,filter,type,purpose,owned){
  if(map!=='all'&&!x.mapNames.includes(map))return false;
  if(filter==='owned'&&!owned[x.id])return false;
  if(filter==='missing'&&owned[x.id])return false;
  if(type==='keycard'&&!x.keycard)return false;
  if(type==='key'&&x.keycard)return false;
  if(purpose==='quest'&&!x.tasks.length)return false;
  if(purpose==='unmapped'&&x.mapNames.length)return false;
  const haystack=normalizeName(`${x.nameKo} ${x.nameEn} ${x.shortNameEn} ${x.shortNameKo} ${x.mapNames.join(' ')} ${x.tasks.map(t=>t.name).join(' ')}`);
  return !search||haystack.includes(search);
}
function showDetail(x){
  const body=$('detail-body');body.replaceChildren();
  const head=text('div','detail-top','');
  if(x.iconLink){const img=document.createElement('img');img.src=x.iconLink;img.alt='';head.append(img);}
  const names=document.createElement('div');names.append(text('h2','',x.nameKo||x.nameEn));
  if(x.nameKo)names.append(text('p','',x.nameEn));
  head.append(names);body.append(head);
  const addSection=(heading,content)=>{const s=text('section','detail-section','');s.append(text('h3','',heading));s.append(content);body.append(s);};
  addSection('사용 맵',text('p','',x.mapNames.length?x.mapNames.join(', '):'공개 데이터에 맵 연결 정보가 없습니다. (확인 필요)'));
  addSection('종류',text('p','',x.keycard?'키카드 / 출입 카드':'열쇠'));
  if(Number.isInteger(x.uses)) addSection('사용 횟수',text('p','',x.uses===0?'무제한 또는 미설정 (게임 내 확인 필요)':`${x.uses}회`));
  if(x.lockPositions?.length){
    const ul=document.createElement('ul');
    for(const pos of x.lockPositions.slice(0,40)){
      const fmt=n=>Number(n).toFixed(1).replace(/\.0$/,'');
      ul.append(text('li','',`${pos.mapName}: X ${fmt(pos.x)} · Y ${fmt(pos.y)} · Z ${fmt(pos.z)}`));
    }
    addSection('잠긴 문 위치 좌표 (API 제공)',ul);
    addSection('좌표 안내',text('p','','좌표는 게임 내 월드 좌표가 아닌 지도용 좌표계일 수 있습니다. 상세 출입구 확인에는 위키를 참고하세요.'));
  }
  if(x.tasks.length){const ul=document.createElement('ul');for(const t of x.tasks)ul.append(text('li','',t.nameKo&&t.nameKo!==t.name?`${t.nameKo} (${t.name})`:t.name));addSection('관련 퀘스트',ul);}
  else addSection('관련 퀘스트',text('p','','API에 연결된 퀘스트 정보가 없습니다.'));
  if(x.description)addSection('아이템 설명 (영문)',text('p','',x.description));
  if(x.wikiLink&&x.wikiLink.startsWith('https://')){
    const p=document.createElement('p'),a=document.createElement('a');a.href=x.wikiLink;a.target='_blank';a.rel='noopener noreferrer';a.textContent='위키에서 정확한 사용 위치·보상 확인 ↗';p.append(a);addSection('추가 정보',p);
  }
  const note=text('p','','맵 정보는 API의 잠긴 문·입장용 열쇠 연결을 기준으로 표시됩니다. 실제 사용처와 최신 패치 정보는 위키도 확인해주세요.');addSection('안내',note);
  $('detail').showModal();
}
function cardFor(x,owned){
  const card=document.createElement('article');card.className='card'+(owned[x.id]?' is-owned':'');
  const top=text('div','card-header','');top.append(text('span','tag'+(x.mapNames.length?' verified':''),x.mapNames.length?x.mapNames.length+'개 맵':'맵 미확인'));
  if(x.tasks.length)top.append(text('span','tag quest','퀘스트'));card.append(top);
  const image=text('div','card-image','');if(x.iconLink){const img=document.createElement('img');img.loading='lazy';img.alt='';img.src=x.iconLink;image.append(img);}else image.append(text('span','no-image','⚿'));card.append(image);
  card.append(text('h3','',x.nameKo||x.nameEn));card.append(text('div','subname',x.nameKo?x.nameEn:(x.shortNameEn||' ')));
  card.append(text('div','map-chip',x.mapNames.length?x.mapNames.join(' · '):'사용 맵: 확인 필요'));
  if(x.lockPositions?.length) card.append(text('div','position-hint',`⌖ 잠긴 문 위치 ${x.lockPositions.length}곳 확인`));
  const bottom=text('div','card-bottom','');const label=text('label','owned-label','');const check=document.createElement('input');check.type='checkbox';check.checked=!!owned[x.id];check.setAttribute('aria-label',`${x.nameKo||x.nameEn} 보유 체크`);
  check.addEventListener('change',()=>{const next={...getOwned()};if(check.checked)next[x.id]=true;else delete next[x.id];if(!setOwned(next))$('status').textContent='저장 공간을 사용할 수 없습니다. 브라우저 설정을 확인하세요.';render();});
  label.append(check,document.createTextNode('보유 중'));bottom.append(label);
  const detail=text('button','detail-btn','상세 보기');detail.type='button';detail.addEventListener('click',()=>showDetail(x));bottom.append(detail);card.append(bottom);return card;
}
function render(){
  const owned=getOwned();const search=normalizeName($('search').value);const map=$('map').value,filter=$('filter').value,type=$('type').value,purpose=$('purpose').value,sort=$('sort').value;
  const visible=items.filter(x=>matches(x,search,map,filter,type,purpose,owned));
  if(sort==='owned')visible.sort((a,b)=>Number(!!owned[b.id])-Number(!!owned[a.id])||a.nameEn.localeCompare(b.nameEn));
  if(sort==='missing')visible.sort((a,b)=>Number(!!owned[a.id])-Number(!!owned[b.id])||a.nameEn.localeCompare(b.nameEn));
  const ownedCount=items.reduce((n,x)=>n+(owned[x.id]?1:0),0);
  $('stat-total').textContent=items.length.toLocaleString('ko-KR');$('stat-owned').textContent=ownedCount.toLocaleString('ko-KR');$('stat-remaining').textContent=(items.length-ownedCount).toLocaleString('ko-KR');
  const percent=items.length?Math.round(100*ownedCount/items.length):0;$('stat-percent').textContent=percent+'%';$('progress-bar').style.width=percent+'%';
  $('result-count').textContent=`${visible.length.toLocaleString('ko-KR')}개 표시`;
  const grid=$('cards'),frag=document.createDocumentFragment();
  if(!visible.length)frag.append(text('p','empty',items.length?'검색 조건에 맞는 열쇠가 없어요.':'데이터가 아직 없습니다.'));
  else for(const x of visible)frag.append(cardFor(x,owned));grid.replaceChildren(frag);
}
async function graphql(query){
  const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(18000)});
  if(!res.ok)throw new Error(`API HTTP ${res.status}`);
  const result=await res.json();
  if(result.errors?.length)throw new Error(result.errors[0].message||'GraphQL 오류');
  if(!Array.isArray(result.data?.items)&&!Array.isArray(result.data?.maps))throw new Error('예상과 다른 API 응답');
  return result.data;
}
function updateStatus(message){$('status').textContent=message;}
async function load(force=false){
  const sequence=++loadSequence;
  const cached=readJSON(CACHE_KEY,null);
  if(!force&&cached?.version===3&&Array.isArray(cached.items)&&cached.items.length){items=cached.items;lastApiTimestamp=cached.timestamp||null;updateFilters();render();updateStatus('저장된 목록을 표시 중입니다. 최신 정보 확인 중...');}
  else updateStatus('tarkov.dev에서 열쇠를 불러오는 중...');
  const [en,ko,maps]=await Promise.allSettled([graphql(queryEnglish),graphql(queryKorean),graphql(queryMaps)]);
  if(sequence!==loadSequence)return;
  if(en.status!=='fulfilled'||!Array.isArray(en.value.items)){
    const reason=en.status==='rejected'?en.reason.message:'영문 열쇠 목록 없음';
    updateStatus(items.length?`저장된 목록을 사용 중입니다. API 갱신 실패: ${reason}`:`데이터를 불러오지 못했습니다: ${reason} · 잠시 후 새로고침해주세요.`);
    render();return;
  }
  const koList=ko.status==='fulfilled'?ko.value.items:[];
  const mapsList=maps.status==='fulfilled'?maps.value.maps:[];
  const fresh=makeItems(en.value.items,koList,mapsList);
  if(!fresh.length){updateStatus('API에서 열쇠 목록이 0개로 반환되어 기존 데이터를 유지합니다.');return;}
  items=fresh;lastApiTimestamp=Date.now();updateFilters();render();
  writeJSON(CACHE_KEY,{version:3,timestamp:lastApiTimestamp,items});
  const notes=[];if(ko.status==='rejected')notes.push('한국어 이름 일부 미제공');if(maps.status==='rejected')notes.push('맵 연결 정보 미제공');
  const mapped=items.filter(x=>x.mapNames.length).length, positioned=items.filter(x=>x.lockPositions.length).length;
  updateStatus(`열쇠·키카드 ${items.length}개 · 맵 연결 ${mapped}개 · 문 좌표 ${positioned}개 · 출처: tarkov.dev${notes.length?' · '+notes.join(' · '):''}`);
}
for(const id of ['search','map','filter','type','purpose','sort'])$(id).addEventListener(id==='search'?'input':'change',render);
$('refresh').addEventListener('click',()=>load(true));
$('close-detail').addEventListener('click',()=>$('detail').close());
$('detail').addEventListener('click',e=>{if(e.target===$('detail'))$('detail').close();});
$('export').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({version:1,owned:getOwned(),exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='tarkov-key-guide-backup.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
});
$('import').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try {
    if(file.size>2*1024*1024)throw Error('백업 파일이 너무 큽니다.');
    const data=JSON.parse(await file.text());
    if(data.version!==1||!data.owned||typeof data.owned!=='object'||Array.isArray(data.owned))throw Error('지원하지 않는 백업 형식입니다.');
    const clean=Object.create(null);for(const [id,val] of Object.entries(data.owned))if(/^[0-9a-zA-Z]{1,64}$/.test(id)&&val===true)clean[id]=true;
    if(!setOwned(clean))throw Error('브라우저에 보유 기록을 저장할 수 없습니다.');
    render();alert('보유 현황을 가져왔습니다.');
  }catch(error){alert('백업 가져오기 실패: '+error.message);}finally{e.target.value='';}
});
window.addEventListener('storage',e=>{if(e.key===OWNED_KEY)render();});
load();
