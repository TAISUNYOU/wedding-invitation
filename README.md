# CEZ 모바일 청첩장 — 로컬 클론

`https://cez-pv8-7le.pages.dev` 사이트의 정적 파일 클론.

## 구성

- `index.html` — 전체 앱 (인라인 CSS/JS 포함, ~391KB)
- `vendor-supabase.js` — supabase-js v2.58.0 셀프호스팅 (esm.sh CDN 폴백)
- `editor_v4.js`, `04_client_patch.js` — 앱 로직
- `vendor-qrcode.js` — QR 생성
- `*.png` / `*.jpg` — 폴라로이드 프레임, 종이 질감, 아이콘, OG 이미지 등

## 실행 방법

정적 서버로 루트를 서빙해야 동작합니다 (`file://` 직접 열기는 fetch/CORS 때문에 안 됩니다).

```bash
# Node가 있을 때 (이 폴더에서)
npx serve .

# 또는 Python
python -m http.server 8787
```

그 후 브라우저에서 `http://localhost:8787` 접속.

> 랜딩(index)은 제거되어 있고, 루트 접속 시 바로 샘플 초대장(`#/i/sample01`)이 표시됩니다.

## 동작 범위

- 초대장 조회(`#/i/sample01` 등), RSVP, 계좌 복사, 지도 링크, 공유: 동작 (데이터는 원본 Supabase에서 읽음)
- **저장·업로드·편집은 차단됨**: 클론은 "미리보기 환경"으로 인식되어 운영 데이터 보호 차단 배너가 표시됩니다.
- 실제 편집은 운영 사이트(`cez-pv8-7le.pages.dev`)에서만 가능합니다.

## 백엔드 의존

앱은 Supabase(`https://gndbfwamxyyrywsjiikm.supabase.co`, anon 키 포함)에서
초대장 데이터·인증·결제 상태를 읽어옵니다. 이 저장소는 프런트엔드(정적)만 포함합니다.
