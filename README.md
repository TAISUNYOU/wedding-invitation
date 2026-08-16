# 모바일 청첩장 — 커스텀 베이스

CEZ 모바일 청첩장 클론에서 **외부 서버(Supabase) 의존을 모두 제거**한 로컬 전용 베이스입니다.
이 파일들을 수정해 나만의 청첩장으로 커스터마이즈하세요.

## 구성

- `index.html` — 청첩장 전체 (스타일 + 렌더러 + 초대장 데이터 포함)
- `pictures/` — **신랑·신부 커플 사진** (`img1.jpg`~`img11.jpg`) — 커스텀 시 이 폴더의 사진을 교체
- `assets/` — 청첩장 디자인 구성 리소스 (폴라로이드 프레임, 종이 질감, 아이콘, OG 이미지 등)

## 실행 방법

```bash
# Node (이 폴더에서)
npx serve .

# 또는 Python
python -m http.server 8787
```

브라우저에서 `http://localhost:8787` 접속 — 랜딩 없이 바로 `sample01` 초대장이 표시됩니다.

## 커스터마이즈 (데이터 수정)

초대장 내용은 `index.html` 내부 `defaultUsers()` 함수의 `sample01` 항목에 있습니다.

- `groomKo`/`brideKo` — 신랑·신부 이름 (한글)
- `groomEn`/`brideEn` — 영문 이름
- `groomFather`/`groomMother`/`brideFather`/`brideMother` — 혼주 성함
- `date`/`time` — 예식 일시 (예: `'2026-10-20'`, `'12:00'`)
- `venueName`/`venueAddr`/`mapQuery` — 예식 장소
- `cover`/`gallery`/`featuredGallery` — 사진 경로 (`pictures/` 안의 이미지)
- `accounts`/`acctOrder` — 계좌 정보
- `greeting`/`notice`/`coverIntro` — 문구
- `sections` — 섹션 표시/숨김

사진을 바꾸려면 `pictures/`에 파일을 넣고 경로만 수정하면 됩니다.

## 동작 범위 (로컬 전용)

- 초대장 렌더링, RSVP 제출, 계좌 복사, 지도 링크, 공유 — 동작
- RSVP 응답은 브라우저 `localStorage`에 저장됩니다 (서버 전송 없음)
- 로그인·결제·어드민·에디터·서버 동기화 — 모두 제거됨
- 외부 통신: 없음 (지도 링크 클릭 시 해당 서비스로 이동하는 것뿐)
