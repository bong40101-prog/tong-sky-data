# 통SKY 조회 홈페이지

공개 주소: https://bong40101-prog.github.io/tong-sky-data/
앱 다운로드: https://bong40101-prog.github.io/tong-series/

`web-source` 브랜치는 원본과 테스트, `gh-pages` 브랜치는 dist의 게시 파일을 담습니다. 항공 자료는 별도 `tong-sky-data` 브랜치에 보존합니다. 홈페이지는 저장 자료를 읽으며 항공사 수집을 실행하지 않습니다.

`npm install` 후 `npm test`로 53개 모델·로더·화면·집계 검사를 실행합니다. 가는 편/오는 편 전체는 선택 기간의 방향별 합계이고, 카드의 현재 달력은 선택 월·방향과 일치합니다. 원본이 제공하지 않는 잔여 좌석 수는 추정하지 않습니다.

방문자 수는 Cloudflare의 별도 IP 집계 API를 사용합니다. 서버의 한국시간 날짜별 HMAC과 집합으로 중복을 제외하며 원본 IP와 브라우저 ID는 저장하지 않습니다. 프런트엔드는 집계 실패를 0명으로 바꾸지 않고, 자정에 새 날짜를 등록합니다.
