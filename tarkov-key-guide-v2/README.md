# Tarkov Key Guide v0.2

비공식 타르코프 열쇠·키카드 도감. GitHub Pages에서 실행되는 순수 HTML/CSS/JavaScript 웹사이트입니다.

## 공개 방법 (기존 저장소 업데이트)

1. GitHub 저장소의 `index.html`, `style.css`, `script.js`, `README.md`를 이 ZIP의 동일한 파일로 교체합니다.
2. `main` 브랜치 루트(root)에 위치해야 합니다.
3. Settings → Pages → Deploy from a branch → main / (root)를 유지합니다.
4. 배포 후 Ctrl + F5를 눌러 최신 페이지를 확인하세요.

## 변경 내용

- 기존 `properties { ... on ItemPropertiesKey { uses } }` 쿼리는 현재 스키마에 `uses` 필드가 없어 오류가 발생할 수 있으므로 제거했습니다.
- `items(types:[keys], lang:en)`/`lang:ko`에서 아이템 이름을 가져옵니다.
- `maps { locks { key { id } } accessKeys { id } }`를 이용해 **실제 연결이 공개된 맵**을 분류합니다. API에 연결 정보가 없는 열쇠는 섣불리 추정하지 않고 `맵 미확인`으로 표시합니다.
- API가 제공하는 `usedInTasks`로 퀘스트 연관 필터를 표시합니다. 자동 분류이므로 게임 내 실제 용도 전체를 보장하지는 않습니다.
- 한국어·영어 검색, 키카드 필터, 보유/미보유, 수집 진행률, 상세 정보 대화창, 갱신 버튼.
- **기존 보유 기록 유지**: 키 `tarkov-key-guide-owned-v1` 그대로 사용.
- 보유 체크 백업(JSON) 버전 1 호환. 계정/서버/DB 불필요.
- 마지막으로 불러온 목록을 브라우저에 캐시해 API 오류 시 사용합니다.

## 제한 사항

- 아이템 API 분류(types: keys)에 포함된 열쇠와 키카드를 대상으로 합니다. 게임 내 모든 특수 아이템이 이 범주에 포함되는지 별도 검증이 필요합니다.
- `맵 미확인`은 아이템이 맵에서 쓰이지 않는다는 뜻이 아닙니다. API의 지도-자물쇠 데이터에 연계가 없다는 뜻입니다.
- 세부 방 번호, 파밍 수익, 출현 장소 등은 직접 검수한 데이터가 아니므로 만들어서 표시하지 않습니다. 각 카드의 위키 링크에서 추가 확인 가능합니다.
- 직접 실행 환경에서는 네트워크가 막혀 실시간 API 호출을 검증하지 못했습니다. 게시된 사이트에서 아이템 건수/분류를 확인하세요.
- 캐시 및 보유 기록은 동일 기기·브라우저에만 저장되며, 시크릿 모드나 브라우저 데이터 삭제 시 사라질 수 있습니다.

### 데이터 출처

[tarkov.dev](https://tarkov.dev/) / [GraphQL API](https://api.tarkov.dev/)

Escape from Tarkov는 Battlestate Games의 상표입니다. 본 사이트는 공식 사이트가 아닙니다.
