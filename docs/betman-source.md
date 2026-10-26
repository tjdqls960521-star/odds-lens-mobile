# 현재 배당 수집 출처

2026-09-18부터 현재 배당은 `www.betman.co.kr`의 공개 경기표 조회 응답만 사용합니다. 로그인, 개인 계정, 구매 기능을 사용하지 않습니다.

- 회차 발견: `POST /buyPsblGame/inqCacheBuyAbleGameInfoList.do`, `protoGames` 중 `gmId=G101`.
- 회차별 전체 경기: `POST /buyPsblGame/gameInfoInq.do`, 본문 `gmId`, `gmTs`, `gameYear`.
- 위 요청은 공식 페이지의 `requestClient.js`, `main.html.js`, `gameSlipProtoVictory.html.js`에서 확인한 공개 읽기 요청입니다. 공식적으로 문서화된 개발자 API는 아니므로 응답 형식 변경이나 접근 제한이 발생할 수 있습니다.
- `compSchedules.keys`와 `datas`를 이름으로 결합하며, `winAllot/drawAllot/loseAllot`과 `winTxt/drawTxt/loseTxt`를 함께 검증합니다. 언더는 `winAllot`, 오버는 `loseAllot`; 기준값은 `winHandi`입니다. 각 행의 회차와 `matchSeq`를 보관합니다.
- `domastic`는 리그 속성이므로 국내 배당 여부 판정에 쓰지 않습니다. 해외 리그 MLB·EPL도 베트맨 도메인이 제공한 국내 프로토 배당입니다.
- 화면이 열려 있는 동안 30초마다 요청하고 서버도 30초 이내 중복 수집을 억제합니다. 변경 즉시 전송하는 스트리밍이 아닙니다. 컴퓨터가 꺼져 있어도 모바일 접속으로 클라우드에서 조회합니다.
- 미발표 일정은 배당 없이 표시합니다. 시작·마감·중지 상태, 미발표 배당 및 2분 이상 된 배당은 추천에서 제외합니다. 수집 실패 시 마지막 공식 조회값의 시각을 유지하고 추천을 멈춥니다.
- 이전 Scorebase 저장 키와 seed는 현재 조회 경로에서 사용하지 않습니다. 해외 또는 다른 제공처 배당으로 자동 대체하지 않습니다.

회귀 검증용 `test/fixtures/betman-public.json`은 2026-09-18 공식 응답에서 공개 경기 필드만 추린 자료입니다. 예: 260111회차 2735번 흐로닝언–PEC즈볼러 1.47/3.85/4.80, 2737번 기준 3.5 언더 1.72/오버 1.80. 이 숫자는 당시 조회 스냅샷이며 현재 배당을 뜻하지 않습니다.
