/* ===== 1. 초대장 렌더러 — 레몬 테마 디자인 코드 ===== */
function parentLine(f, fd, m, md, rel) {
  var ps = [];
  if (f && f.trim()) ps.push((fd ? "故 " : "") + f.trim());
  if (m && m.trim()) ps.push((md ? "故 " : "") + m.trim());
  var s = ps.join(" · ");
  if (rel && rel.trim()) s += (s ? " 의 " : "") + rel.trim();
  return s;
}
/* ===== 2. 청첩장 데이터 파싱: 신랑·신부·일시·장소·갤러리 ===== */
function invParts(d) {
  d = d || {};
  const o = {
    gKo: d.groomKo || "신랑",
    bKo: d.brideKo || "신부",
    gEn: d.groomEn || "Groom",
    bEn: d.brideEn || "Bride",
    gPar: parentLine(
      d.groomFather,
      d.groomFatherDec,
      d.groomMother,
      d.groomMotherDec,
      d.groomRelation,
    ),
    bPar: parentLine(
      d.brideFather,
      d.brideFatherDec,
      d.brideMother,
      d.brideMotherDec,
      d.brideRelation,
    ),
    venue: d.venueName || "예식장",
    addr: d.venueAddr || "",
    greet: d.greeting || "",
    notice: d.notice || "",
    cover: d.cover || "",
    gallery: d.gallery || [],
    accounts: d.accounts || {},
    showMap: d.showMap !== false,
  };
  o.mapq =
    d.mapQuery && d.mapQuery.trim()
      ? d.mapQuery.trim()
      : ((d.venueName || "") + " " + (d.venueAddr || "")).trim();
  if (d.date) {
    const x = parseDate(d.date),
      wd = x.getDay();
    o.y = x.getFullYear();
    o.dotted =
      pad(x.getMonth() + 1) +
      " . " +
      pad(x.getDate()) +
      " . " +
      x.getFullYear();
    o.wdEn = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][wd];
    o.monthEn = MONTH_EN[x.getMonth()];
    o.full =
      x.getFullYear() +
      "년 " +
      (x.getMonth() + 1) +
      "월 " +
      x.getDate() +
      "일 " +
      WEEK[wd] +
      "요일";
  } else {
    o.y = "";
    o.dotted = "YYYY . MM . DD";
    o.wdEn = "";
    o.monthEn = "";
    o.full = "날짜 미정";
  }
  o.time = d.time ? timeLabel(d.time) : "";
  return o;
}

/* ===== 3. 하단 푸터 문구 ===== */
function invFooter(sk, d) {
  d = d || {};
  return (
    '<div style="padding:32px 0 12px;text-align:center">' +
    '<div style="margin-top:7px;font-family:var(--mono);font-weight:400;font-size:10px;line-height:150%;color:' +
    (sk.dark ? "#fff" : "#000") +
    ';opacity:.49">♡ 우리의 결혼 소식을 전해드립니다</div></div>'
  );
}

/* ===== 4. 레몬 테마 상수·날짜 표기 ===== */
var LUCE_KO = "'Pretendard Variable','Pretendard','Malgun Gothic',sans-serif";
function luceDateDot(d) {
  if (!d || !d.date) return "";
  try {
    var x = parseDate(d.date);
    var t = d.time ? timeLabel(d.time) : "";
    var _dow = ["일", "월", "화", "수", "목", "금", "토"][x.getDay()];
    return (
      x.getFullYear() +
      "." +
      String(x.getMonth() + 1).padStart(2, "0") +
      "." +
      String(x.getDate()).padStart(2, "0") +
      " (" +
      _dow +
      ")" +
      (t ? " " + t : "")
    );
  } catch (e) {
    return "";
  }
}

/* ===== 5. 대표 사진 3장: 폴라로이드 프레임·크롭 ===== */
function getFeaturedGallery(d) {
  if (!Array.isArray(d.featuredGallery) || d.featuredGallery.length !== 3) {
    d.featuredGallery = [
      { src: "feat1.png?v=3", s: 1, x: 0, y: 0 },
      { src: "feat2.png?v=3", s: 1, x: 0, y: 0 },
      { src: "feat3.png?v=3", s: 1, x: 0, y: 0 },
    ];
  }
  return d.featuredGallery;
}

function luceFeatured(d) {
  var list = getFeaturedGallery(d);
  return (
    '<div class="luce-featured">' +
    list
      .map(function (it, i) {
        var tf =
          it.posX != null || it.posY != null
            ? "object-position:" +
              (it.posX == null ? 50 : it.posX) +
              "% " +
              (it.posY == null ? 50 : it.posY) +
              "%;transform:scale(" +
              (it.s || 1) +
              ")"
            : "transform:translate(" +
              (it.x || 0) +
              "%," +
              (it.y || 0) +
              "%) scale(" +
              (it.s || 1) +
              ")";

        var img =
          '<img src="' +
          esc(it.src || "feat1.png") +
          '" alt="" draggable="false" oncontextmenu="return false" style="' +
          tf +
          '">' +
          (it.grain
            ? '<div style="position:absolute;inset:0;background:url(assets/grain.png) center/cover;mix-blend-mode:overlay;opacity:.5;pointer-events:none"></div>'
            : "");

        var portrait = it.frameOrientation === "portrait";
        return (
          '<div class="luce-pola' +
          (portrait ? " is-portrait" : "") +
          '" data-feat-i="' +
          i +
          '"><div class="luce-pola-win">' +
          img +
          '</div><img class="luce-pola-frame" src="assets/polaroid.png" alt="" draggable="false"></div>'
        );
      })
      .join("") +
    "</div>"
  );
}
/* ===== 6. 갤러리 그리드·더보기 ===== */
function luceGallery(d) {
  var gal = (d.gallery || []).filter(Boolean);
  var grid = "";
  if (gal.length) {
    var show = gal.slice(0, 6);
    grid =
      '<div class="luce-ggrid" data-gal="' +
      encodeURIComponent(JSON.stringify(gal)) +
      '" data-nozoom="' +
      (d.galleryNoZoom ? "1" : "") +
      '">' +
      show
        .map(function (src, i) {
          var isMore = i === 5 && gal.length > 6;
          var more = isMore
            ? '<div class="luce-gmore">+' + (gal.length - 6) + " More</div>"
            : "";

          return (
            '<div class="luce-gcell" onclick="openGalleryCarousel(' +
            i +
            ',this)"><img src="' +
            esc(src) +
            '" onerror="this.onerror=null;this.src=\'' +
            esc(src) +
            '\'" alt="" loading="lazy" decoding="async" draggable="false" oncontextmenu="return false">' +
            more +
            "</div>"
          );
        })
        .join("") +
      "</div>";
  }
  var mid = grid
    ? '<div class="luce-fold" style="margin:10px -25px"></div>'
    : "";
  return (
    '<div data-pv-sec="gallery" style="margin:0 25px 6px">' +
    luceFeatured(d) +
    mid +
    grid +
    "</div>"
  );
}
/* ===== 7. 지도 링크 (네이버·카카오·티맵) ===== */
function luceMap(p) {
  var query = (p.mapq || "").replace(/\n/g, " ").trim();
  if (!query) return "";
  var q = encodeURIComponent(query);
  return (
    '<div id="daumRoughmapContainer1786935611762" class="root_daum_roughmap root_daum_roughmap_landing inv-kakao-map"></div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:16px;font-family:' +
    LUCE_KO +
    ';font-size:13px;font-weight:500">' +
    '<a href="https://map.naver.com/p/search/' +
    q +
    '" target="_blank" rel="noopener" style="color:#000;text-decoration:underline">네이버지도↗</a>' +
    '<a href="https://map.kakao.com/?q=' +
    q +
    '" onclick="return ytsOpenKakao(this.href,\'' +
    q +
    '\')" rel="noopener" style="color:#000;text-decoration:underline">카카오맵↗</a>' +
    '<a href="tmap://search?name=' +
    q +
    '" onclick="return ytsOpenTmap(this.href)" rel="noopener" style="color:#000;text-decoration:underline">티맵↗</a>' +
    "</div>"
  );
}

/* ===== 8. 계좌 순서·관계 라벨 정리 ===== */
function getAcctOrder(d) {
  d.accounts = d.accounts || {};
  if (Array.isArray(d.acctOrder) && d.acctOrder.length)
    return (d.acctOrder = d.acctOrder.slice(0, 6));
  var order = [];
  [
    ["groom", "신랑"],
    ["groomFather", "신랑 아버지"],
    ["groomMother", "신랑 어머니"],
    ["bride", "신부"],
    ["brideFather", "신부 아버지"],
    ["brideMother", "신부 어머니"],
  ].forEach(function (m) {
    var v = d.accounts[m[0]];
    if (v && (v.bank || v.number || v.holder))
      order.push({ key: m[0], label: m[1] });
  });
  if (!order.length) {
    d.accounts.ac1 = d.accounts.ac1 || { bank: "", number: "", holder: "" };
    order = [{ key: "ac1", label: "" }];
  }
  d.acctOrder = order.slice(0, 6);
  return d.acctOrder;
}
/* ===== 9. 지도 앱 딥링크 (앱 미설치 시 폴백 안내) ===== */
function ytsOpenTmap(href) {
  var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!mobile) {
    alert("티맵은 모바일에서 티맵 앱으로 연결됩니다.");
    return false;
  }
  location.href = href;

  var t = Date.now();
  setTimeout(function () {
    if (Date.now() - t < 2200 && !document.hidden) {
      if (confirm("티맵 앱이 열리지 않았어요. 설치 페이지로 이동할까요?"))
        location.href = "https://www.tmap.co.kr";
    }
  }, 1800);
  return false;
}
function ytsOpenKakao(webHref, encQ) {
  var ua = navigator.userAgent,
    mobile = /Android|iPhone|iPad|iPod/i.test(ua);
  if (!mobile) {
    window.open(webHref, "_blank", "noopener");
    return false;
  }
  location.href = "kakaomap://search?q=" + encQ;

  var store = /Android/i.test(ua)
    ? "https://play.google.com/store/apps/details?id=net.daum.android.map"
    : "https://apps.apple.com/kr/app/id304608425";
  var t = Date.now();
  setTimeout(function () {
    if (Date.now() - t < 2200 && !document.hidden) {
      if (confirm("카카오맵 앱이 열리지 않았어요. 설치 페이지로 이동할까요?"))
        location.href = store;
    }
  }, 1800);
  return false;
}
/* ===== 10. 계좌 행 렌더: 관계 색상·복사 버튼 ===== */
function luceAcctRows(p, d) {
  var a = (d && d.accounts) || p.accounts || {},
    KO = LUCE_KO;
  var order = d && typeof getAcctOrder === "function" ? getAcctOrder(d) : [];

  var fmt = function (role, slot, v) {
    return v && (v.number || v.bank || v.holder)
      ? '<div class="luce-acc-row" data-acct-slot="' +
          slot +
          '" style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:1px solid #eee;font-family:' +
          KO +
          '">' +
          '<div style="text-align:left"><div style="font-size:11.5px;color:#8a8574">' +
          esc(role) +
          '</div><div style="font-size:13px;margin-top:3px;color:#141414">' +
          esc(v.holder || "") +
          (v.bank ? (v.holder ? " · " : "") + esc(v.bank) : "") +
          "</div>" +
          (v.number
            ? '<div style="font-size:14px;margin-top:2px;color:#141414">' +
              esc(v.number) +
              "</div>"
            : '<div style="font-size:12px;margin-top:2px;color:#b0aa96">계좌번호 미입력</div>') +
          "</div>" +
          (v.number
            ? '<button type="button" onclick="copyAcct(\'' +
              esc(v.number) +
              '\')" style="flex:0 0 auto;border:1px solid #ddd;background:#fff;border-radius:6px;padding:7px 13px;font-size:12px;cursor:pointer;font-family:' +
              KO +
              ';color:#141414">복사</button>'
            : "") +
          "</div>"
      : "";
  };
  if (d && d.acctGroupBySide) {
    var fmtG = function (o, roleColor, isFirst) {
      var v = a[o.key];
      return (
        '<div class="luce-acc-row" data-acct-slot="' +
        o.key +
        '" style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;' +
        (isFirst ? "" : "border-top:1px solid rgba(0,0,0,.06);") +
        "font-family:" +
        KO +
        '">' +
        '<div style="text-align:left">' +
        '<div style="font-size:12px;font-weight:600;color:' +
        roleColor +
        '">' +
        esc(o.label || "계좌") +
        "</div>" +
        '<div style="font-size:13px;margin-top:3px;color:#141414">' +
        esc(v.holder || "") +
        (v.bank ? (v.holder ? " · " : "") + esc(v.bank) : "") +
        "</div>" +
        (v.number
          ? '<div style="font-size:14px;margin-top:2px;color:#141414">' +
            esc(v.number) +
            "</div>"
          : "") +
        "</div>" +
        (v.number
          ? '<button type="button" onclick="copyAcct(\'' +
            esc(v.number) +
            '\')" style="flex:0 0 auto;border:1px solid #ddd;background:#fff;border-radius:6px;padding:7px 13px;font-size:12px;cursor:pointer;font-family:' +
            KO +
            ';color:#141414">복사</button>'
          : "") +
        "</div>"
      );
    };
    var mkBlock = function (list, roleColor, bg) {
      var valid = list.filter(function (o) {
        var v = a[o.key];
        return v && (v.number || v.bank || v.holder);
      });
      if (!valid.length) return null;
      return {
        rows: valid
          .map(function (o, i) {
            return fmtG(o, roleColor, i === 0);
          })
          .join(""),
        bg: bg,
      };
    };
    var groom = order.filter(function (o) {
      return o.side !== "bride";
    });
    var bride = order.filter(function (o) {
      return o.side === "bride";
    });
    var blocks = [
      mkBlock(groom, "#356693", "rgba(177,218,255,.2)"),
      mkBlock(bride, "#FF7375", "rgba(255,191,177,.2)"),
    ].filter(Boolean);

    return blocks
      .map(function (bl, i) {
        var mt = i === 0 ? "-2px" : "0",
          mb = i === blocks.length - 1 ? "-16px" : "0";
        return (
          '<div style="background:' +
          bl.bg +
          ";margin:" +
          mt +
          " -20px " +
          mb +
          ';padding:0 20px">' +
          bl.rows +
          "</div>"
        );
      })
      .join("");
  }
  return order
    .map(function (o) {
      return fmt(o.label || "계좌", o.key, a[o.key]);
    })
    .join("");
}
/* ===== 11. 공유 버튼 ===== */
function luceShare(d, prev) {
  var slug = userSlugForData(d) || "";
  var icon =
    '<img src="assets/icon-share.png" alt="" style="width:12px;height:auto">';
  return (
    '<div style="padding:' +
    (prev === "accounts" ? "15px" : "0") +
    ' 48px 0"><div data-pv-sec="share">' +
    '<button type="button" onclick="ytsShare(\'' +
    esc(slug) +
    '\')" style="width:100%;display:flex;align-items:center;justify-content:space-between;background:#fff;border:0;padding:15px 20px;cursor:pointer;font-family:var(--mono);font-size:13px;font-weight:500;color:#000">공유하기 ' +
    icon +
    "</button>" +
    "</div></div>"
  );
}

/* ===== 12. 이름 헬퍼: 영문 이름·한글 성 제외 ===== */
function luceGivenEn(n) {
  n = (n || "").trim();
  return n.split(/\s+/)[0] || n;
}
function luceGivenName(n) {
  n = (n || "").trim();
  if (!n) return n;
  if (/^[가-힣]+$/.test(n)) return n.length >= 3 ? n.slice(1) : n;
  return n.split(/\s+/)[0] || n;
}

/* ===== 13. 커버 이미지 크롭 스타일 ===== */
function ytsCoverCropStyle(cc) {
  cc = cc || {};
  if (cc.posY != null) {
    return (
      "object-position:50% " +
      +cc.posY +
      "%;transform:translate(" +
      (cc.x || 0) +
      "%,0%) scale(" +
      (cc.s || 1) +
      ")"
    );
  }
  return (
    "transform:translate(" +
    (cc.x || 0) +
    "%," +
    (cc.y || 0) +
    "%) scale(" +
    (cc.s || 1) +
    ")"
  );
}
/* ===== 14. 레몬 테마 본문 렌더러 (섹션 순서대로) ===== */
function tplLuce(d) {
  const p = invParts(d);
  const MONO = "var(--mono)",
    KO = LUCE_KO,
    ink = "#141414",
    sub = "#6f6a58";
  const gEn = esc(p.gEn),
    bEn = esc(p.bEn);

  const pageBg =
    "#f1e8a1 url(assets/paper-mid-lemon.png) top center/100% auto repeat-y";
  const pageInk = ink;
  let html =
    '<div class="inv luce" style="background:' +
    pageBg +
    ";color:" +
    pageInk +
    ";font-family:" +
    KO +
    ';text-align:center;padding:0 0 48px">';

  var _cc = d.coverCrop || {};
  html +=
    '<div class="luce-coverwrap" data-pv-sec="cover" style="position:relative;width:100%;aspect-ratio:380/500;overflow:hidden;background:#cfc9b0">' +
    '<img class="luce-coverimg" src="' +
    esc(d.cover || "luce-cover.jpg?v=4") +
    '" alt="" draggable="false" onerror="if(!this._f){this._f=1;this.src=\'' +
    esc(d.cover || "luce-cover.jpg?v=4") +
    "';}else if(this.src.indexOf('luce-cover.jpg?v=4')<0){this.src='luce-cover.jpg?v=4';}\" style=\"position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center;" +
    ytsCoverCropStyle(_cc) +
    '">' +
    (d.coverGrainEnabled !== false
      ? '<div style="position:absolute;inset:0;background:url(assets/grain.png) center/cover;mix-blend-mode:overlay;opacity:.5;pointer-events:none"></div>'
      : "") +
    '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,26,18,.1),transparent 40%,rgba(20,26,18,.5))"></div>' +
    ((
      (d.sections || []).find(function (_x) {
        return _x.id === "cover";
      }) || { show: true }
    ).show !== false
      ? '<div style="position:absolute;left:26px;right:26px;bottom:28px;text-align:left;color:#fff;font-family:' +
        MONO +
        '">' +
        (d.coverNames !== false
          ? '<div style="font-size:13px;letter-spacing:.02em">' +
            esc(luceGivenEn(p.gEn)) +
            " ‧ " +
            esc(luceGivenEn(p.bEn)) +
            "</div>"
          : "") +
        ((d.coverIntro != null
          ? d.coverIntro
          : "Every love story is beautiful, but ours is just beginning. Join us as we promise each other a lifetime of love, laughter, and endless memories."
        ).trim()
          ? '<div style="font-size:13px;line-height:1.55;margin-top:14px">' +
            esc(
              d.coverIntro != null
                ? d.coverIntro
                : "Every love story is beautiful, but ours is just beginning. Join us as we promise each other a lifetime of love, laughter, and endless memories.",
            ) +
            "</div>"
          : "") +
        "</div>"
      : "") +
    "</div>";
  html +=
    '<div style="padding:36px 40px 0;font-family:' +
    MONO +
    ';font-size:14px;letter-spacing:.06em">₊˚⊹⋆</div>';
  html +=
    '<div style="padding:24px 20px 4px"><div style="display:flex;justify-content:space-between;align-items:center;max-width:250px;margin:0 auto;font-family:' +
    MONO +
    ';font-size:14px;font-weight:500">' +
    "<span>" +
    esc(luceGivenEn(p.gEn)) +
    "</span><span>&amp;</span><span>" +
    esc(luceGivenEn(p.bEn)) +
    "</span>" +
    "</div></div>";
  html += '<div class="luce-fold"></div>';
  var _sc2 = d.subCoverCrop || {};
  html +=
    '<div style="padding:0 0 4px"><div class="luce-subwin"><img class="luce-subcover" src="' +
    esc(d.subCoverImage || "assets/luce-gallery.jpg") +
    '" alt="" draggable="false" style="transform:translate(' +
    (_sc2.x || 0) +
    "%," +
    (_sc2.y || 0) +
    "%) scale(" +
    (_sc2.s || 1) +
    ')">' +
    (d.subCoverGrainEnabled
      ? '<div style="position:absolute;inset:0;background:url(assets/grain.png) center/cover;mix-blend-mode:overlay;opacity:.5;pointer-events:none"></div>'
      : "") +
    "</div></div>";

  const sk = {
    bg: "transparent",
    text: ink,
    sub: sub,
    accent: ink,
    label: ink,
    rule: "#d9cf93",
    border: "#d9cf93",
    dark: false,
  };
  const REN = {
    invitation: function () {
      function famLine(f, fd, m, md, rel, defRel, nameKo) {
        var MUM =
          '<img src="assets/deceased-flower.png" alt="故" draggable="false" style="display:inline-block;height:1.2em;vertical-align:-0.25em;margin-right:2px">';
        var ps = [];
        if (f && f.trim()) ps.push((fd ? MUM : "") + esc(f.trim()));
        if (m && m.trim()) ps.push((md ? MUM : "") + esc(m.trim()));
        if (!ps.length) return "";
        return (
          "<div>" +
          ps.join(" · ") +
          ' 의 <span class="luce-rel" style="color:#b9b4a5">' +
          esc((rel && rel.trim()) || defRel) +
          "</span> " +
          esc((nameKo || "").trim()) +
          "</div>"
        );
      }
      var g1 = famLine(
        d.groomFather,
        d.groomFatherDec,
        d.groomMother,
        d.groomMotherDec,
        d.groomRelation,
        "아들",
        p.gKo,
      );
      var b1 = famLine(
        d.brideFather,
        d.brideFatherDec,
        d.brideMother,
        d.brideMotherDec,
        d.brideRelation,
        "딸",
        p.bKo,
      );
      var fam =
        g1 || b1
          ? '<div style="margin-top:34px;font-size:14px;line-height:190%;letter-spacing:.06em;word-spacing:.14em;color:#000">' +
            g1 +
            b1 +
            "</div>"
          : "";

      var _shownSec = function (id) {
        var s = (d.sections || []).find(function (x) {
          return x.id === id;
        });
        return !s || s.show !== false;
      };
      var dt = _shownSec("when") ? luceDateDot(d) : "";
      var _vn = _shownSec("where") ? p.venue : "";
      var when =
        dt || _vn
          ? '<div style="margin-top:26px;font-size:14px;line-height:190%;color:#000">' +
            (dt ? "<div>" + esc(dt) + "</div>" : "") +
            (_vn ? "<div>" + esc(_vn) + "</div>" : "") +
            "</div>"
          : "";
      var _hdr =
        d.greetingHeader !== false
          ? '<div style="font-family:' +
            MONO +
            ';font-size:13px;letter-spacing:.06em">₊˚⊹⋆</div>' +
            '<div style="font-family:' +
            KO +
            ';font-size:14px;line-height:2;margin-top:14px;color:#000">' +
            esc(luceGivenName(p.gKo)) +
            " ‧ " +
            esc(luceGivenName(p.bKo)) +
            "</div>"
          : "";
      return (
        '<div style="padding:18px 25px 0"><div data-pv-sec="invitation" style="background:#fff;color:#141414;padding:38px 30px 42px;text-align:center">' +
        _hdr +
        '<div class="greet" style="font-family:' +
        KO +
        ";font-size:14px;font-weight:400;line-height:1.8;white-space:pre-line;color:#000;margin-top:" +
        (d.greetingHeader !== false ? "22" : "0") +
        'px;max-width:284px;margin-left:auto;margin-right:auto">' +
        esc(p.greet) +
        "</div>" +
        fam +
        when +
        "</div></div>"
      );
    },
    couple: function () {
      return '<div data-pv-sec="couple" style="height:1px"></div>';
    },
    gallery: function () {
      return luceGallery(d);
    },

    where: function () {
      return (
        '<div data-pv-sec="where">' +
        '<div style="font-family:' +
        MONO +
        ';font-size:14px;font-weight:500;line-height:1.8;color:#000">⊹ venue ⊹</div>' +
        '<div style="font-size:14px;line-height:1.8;margin-top:10px;color:#000">' +
        '<div class="info-line">' +
        esc(p.venue || "예식장 이름") +
        "</div>" +
        (p.addr
          ? '<div style="white-space:pre-line">' + esc(p.addr) + "</div>"
          : "") +
        (d.floorHall ? "<div>" + esc(d.floorHall) + "</div>" : "") +
        (d.venuePhone ? "<div>" + esc(d.venuePhone) + "</div>" : "") +
        "</div>" +
        "</div>"
      );
    },
    when: function () {
      var dt = luceDateDot(d);
      return (
        '<div data-pv-sec="when">' +
        '<div style="font-family:' +
        MONO +
        ';font-size:14px;font-weight:500;line-height:1.8;color:#000">⊹ date ⊹</div>' +
        '<div class="info-line" style="font-size:14px;line-height:1.8;margin-top:10px;color:#000">' +
        esc(dt || "날짜 미정") +
        "</div>" +
        "</div>"
      );
    },
    accounts: function (prev) {
      var rows = luceAcctRows(p, d);
      if (!rows) return '<div data-pv-sec="accounts" style="height:1px"></div>';
      return (
        '<div style="padding:' +
        (prev === "accounts" ? "15px" : "0") +
        ' 48px 0"><div data-pv-sec="accounts">' +
        '<details class="luce-acct"><summary style="list-style:none;display:flex;align-items:center;justify-content:space-between;background:#B9D9FF;padding:15px 20px;cursor:pointer;font-family:' +
        KO +
        ';font-size:13px;font-weight:500;color:#000">' +
        esc(getSecLabel(d, "accounts") || "마음 전하실 곳") +
        '<img src="assets/icon-acct.png" alt="" style="width:12px;height:auto"></summary>' +
        '<div style="background:#fff;padding:2px 20px 16px">' +
        rows +
        "</div>" +
        "</details>" +
        "</div></div>"
      );
    },
    notice: function () {
      return (
        '<div data-pv-sec="notice">' +
        '<div style="font-family:' +
        MONO +
        ';font-size:14px;font-weight:500;line-height:1.8;color:#000">⊹ information ⊹</div>' +
        (p.notice
          ? '<div class="greet" style="font-size:14px;line-height:1.8;white-space:pre-line;color:#000;margin-top:10px">' +
            esc(p.notice) +
            "</div>"
          : "") +
        "</div>"
      );
    },
    cover: function () {
      return "";
    },
    share: function (prev) {
      return luceShare(d, prev);
    },
  };
  const sections = getSections(d);
  let _prevSec = null;
  const JOINED = {
    "when|where": 1,
    "where|when": 1,
    "where|notice": 1,
    "notice|where": 1,
    "notice|when": 1,
    "when|notice": 1,
    "accounts|share": 1,
  };
  const VGROUP = { when: 1, where: 1, notice: 1 };

  var GROUP_PAD = 30,
    GROUP_GAP = 24;
  const visSecs = sections.filter(function (x) {
    return x.show;
  });
  for (var _i = 0; _i < visSecs.length; _i++) {
    var sec = visSecs[_i];
    if (VGROUP[sec.id]) {
      var run = [];
      var _j = _i;
      while (_j < visSecs.length && VGROUP[visSecs[_j].id]) {
        run.push(visSecs[_j]);
        _j++;
      }
      if (_prevSec && !JOINED[(_prevSec || "") + "|" + sec.id])
        html += '<div class="luce-fold"></div>';
      html +=
        '<div style="padding:0 25px"><div style="background:#fff;padding:' +
        GROUP_PAD +
        "px 24px;display:flex;flex-direction:column;gap:" +
        GROUP_GAP +
        "px;text-align:center;font-family:" +
        KO +
        '">';
      for (var _r = 0; _r < run.length; _r++) {
        html += REN[run[_r].id]();
      }

      if (
        run.some(function (s) {
          return s.id === "where";
        })
      ) {
        html +=
          '<div data-yts-map style="text-align:left;max-width:284px;margin-left:auto;margin-right:auto;width:100%">' +
          luceMap(p) +
          "</div>";
      }
      html += "</div></div>";
      _prevSec = run[run.length - 1].id;
      _i = _j - 1;
      continue;
    }
    var chunk = REN[sec.id] ? REN[sec.id](_prevSec) : "";
    if (chunk && chunk.indexOf("height:1px") < 0) {
      if (!JOINED[(_prevSec || "") + "|" + sec.id])
        html += '<div class="luce-fold"></div>';
      html += chunk;
      _prevSec = sec.id;
    } else {
      if (sec.id === "accounts" && !JOINED[(_prevSec || "") + "|" + sec.id])
        html += '<div class="luce-fold"></div>';
      html += chunk;
      _prevSec = sec.id;
    }
  }
  html += '<div class="luce-fold"></div>';
  html += invFooter(sk, d);
  html += "</div>";
  return html;
}

/* ===== 15. 초대장 렌더 진입점 ===== */
function renderInvitation(d) {
  d = d || {};
  return tplLuce(d);
}
