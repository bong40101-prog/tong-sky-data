# Air France 후보 테스트 결과

검증일: 2026-10-31 (한국 시간)
대상: [RemiPelloux/AirFranceFilterScript](https://github.com/RemiPelloux/AirFranceFilterScript/tree/ce846ef00474d284ba666cd44f6eebdd1d6505d2)
고정 커밋: ce846ef00474d284ba666cd44f6eebdd1d6505d2

## 실제 실행 결과

[GitHub Actions 실행 기록](https://github.com/bong40101-prog/tong-sky-data/actions/runs/41183504437)
실행 커밋: 932d901dc0817707d75714583ae64364d4eed40d
Ubuntu 24.04 / Node 24.22.1 / pnpm 11.18.0. 원본 lockfile 그대로 설치.

| 검사 | 결과 |
| --- | --- |
| 원본 단위 테스트 | 8개 파일, 22개 테스트 통과 |
| 원본 타입 검사 | 통과 |
| 원본 프로덕션 빌드 | 통과 |
| 원본 lint | 통과 |
| 추가 오류 재현 | 3개 중 정상 대조군 1개 통과, 결함 검증 2개 실패 |

원본 browser-launch 테스트 1개는 Linux에서 조기 반환한다. 따라서 22개 통과는 실제 브라우저 기동 또는 항공사 조회 성공을 의미하지 않는다.

## 재현한 결함

### 1. HTTP 503 JSON이 일괄 요청에서 성공으로 전달됨

네트워크 대신 고정 503 JSON 응답을 주입하고 원본 postGraphQlBatch를 실행했다.

관측값:
- 단일 postGraphQl은 HTTP 503 예외를 올바르게 발생시킨다.
- postGraphQlBatch는 ok:true, data.message:"upstream unavailable"을 반환한다.
- 이 데이터를 원본 parseAvailableOffers에 전달하면 빈 배열 []을 반환한다.

일괄 요청에서 오류가 빈 좌석 결과로 해석될 위험이 재현됐다. 안전한 기대값인 ok:false 검증은 실패했다.

### 2. 출발일 변경 시 이전 Explorer 달력을 캐시에서 반환함

브라우저·로그인·응답을 모두 모킹한 뒤, 동일 노선 NCE–RUN의 출발일을 2026-11-01에서 2026-12-01로 변경해 원본 exploreRewardFares를 두 번 호출했다.

관측값:
- 첫 호출 cacheHit:false
- 두 번째 호출 cacheHit:true
- 원본 조회 함수 호출 수: 변경 전 2, 변경 후 2

다른 기간의 결과를 새로 조회하지 않고 이전 결과를 재사용했다. 현재 공개 /api/explore는 내일 출발로 고정하므로 내부 함수를 직접 호출하는 경우와 자정을 넘기는 경우를 구분해야 한다.

## 실조회 범위와 한계

이번 실행에서는 항공사 사이트·로그인·보너스 조회 endpoint에 접속하지 않았고 브라우저도 실행하지 않았다. 테스트에는 계정, 쿠키, 비밀번호 또는 저장소 비밀값을 전달하지 않았다.

앞선 공식 사이트 접속 시도는 이 환경에서 Access Denied로 종료됐다. 따라서 현재 로그인 후 실제 마일리지 좌석 수집 성공은 미검증이다. 원본 reward-smoke 기본 날짜(2026-10-02~12)는 검증일 기준 과거다.

확인된 코드는 Flying Blue 보너스 발권 운임 조회용이다. 퍼스트 클래스와 좌석 승급 재고 수집은 확인되지 않았다. 이 저장소의 재사용 라이선스도 명시돼 있지 않다.

## 판단

원본은 빌드되며 기본 단위 테스트를 통과하지만, 추가 테스트에서 결함 2개가 재현됐다. 통스카이의 실제 데이터 수집원으로 검증 완료된 상태는 아니다.

테스트는 독립 audit 브랜치에서 수행했다. 운영 앱·홈페이지·공유 달력 데이터 브랜치는 변경하지 않았다. Actions 실행 전체가 녹색인 것은 결함 재현 단계에 continue-on-error가 있기 때문이며, 해당 단계의 실제 outcome은 failure이다.
