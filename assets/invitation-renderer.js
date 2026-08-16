/* ================================================================
   INVITATION RENDERER (skin system: built-in + Figma custom)
   ================================================================ */
function parentLine(f,fd,m,md,rel){var ps=[];if(f&&f.trim())ps.push((fd?'故 ':'')+f.trim());if(m&&m.trim())ps.push((md?'故 ':'')+m.trim());var s=ps.join(' · ');if(rel&&rel.trim())s+=(s?' 의 ':'')+rel.trim();return s;}
function invParts(d){
  d=d||{};
  const o={gKo:d.groomKo||'신랑',bKo:d.brideKo||'신부',gEn:d.groomEn||'Groom',bEn:d.brideEn||'Bride',
    gPar:parentLine(d.groomFather,d.groomFatherDec,d.groomMother,d.groomMotherDec,d.groomRelation),
    bPar:parentLine(d.brideFather,d.brideFatherDec,d.brideMother,d.brideMotherDec,d.brideRelation),
    venue:d.venueName||'예식장',addr:d.venueAddr||'',greet:d.greeting||'',notice:d.notice||'',
    cover:d.cover||'',gallery:d.gallery||[],accounts:d.accounts||{},showMap:d.showMap!==false};
  o.mapq=(d.mapQuery&&d.mapQuery.trim())?d.mapQuery.trim():((d.venueName||'')+' '+(d.venueAddr||'')).trim();
  if(d.date){const x=parseDate(d.date),wd=x.getDay();o.y=x.getFullYear();
    o.dotted=pad(x.getMonth()+1)+' . '+pad(x.getDate())+' . '+x.getFullYear();
    o.wdEn=['SUN','MON','TUE','WED','THU','FRI','SAT'][wd];o.monthEn=MONTH_EN[x.getMonth()];
    o.full=x.getFullYear()+'년 '+(x.getMonth()+1)+'월 '+x.getDate()+'일 '+WEEK[wd]+'요일';
  }else{o.y='';o.dotted='YYYY . MM . DD';o.wdEn='';o.monthEn='';o.full='날짜 미정';}
  o.time=d.time?timeLabel(d.time):'';
  return o;
}


function invFooter(sk,d){
  d=d||{};
  return '<div style="padding:32px 0 12px;text-align:center">'
    +'<div style="margin-top:7px;font-family:var(--mono);font-weight:400;font-size:10px;line-height:150%;color:'+(sk.dark?'#fff':'#000')+';opacity:.49">♡ 우리의 결혼 소식을 전해드립니다</div></div>';
}

/* 레몬(luce) 전용 한글 폰트 스택 */
var LUCE_KO="'Pretendard Variable','Pretendard','Malgun Gothic',sans-serif";
function luceDateDot(d){ if(!d||!d.date)return ''; try{var x=parseDate(d.date);var t=d.time?timeLabel(d.time):'';var _dow=['일','월','화','수','목','금','토'][x.getDay()];return x.getFullYear()+'.'+String(x.getMonth()+1).padStart(2,'0')+'.'+String(x.getDate()).padStart(2,'0')+' ('+_dow+')'+(t?' '+t:'');}catch(e){return '';} }
/* v4.4 갤러리: 대표 3장(폴라로이드 프레임+크롭) + 일반 그리드(3열·6장+더보기·라이트박스) */
function getFeaturedGallery(d){
  if(!Array.isArray(d.featuredGallery)||d.featuredGallery.length!==3){
    d.featuredGallery=[{src:'feat1.png?v=3',s:1,x:0,y:0},{src:'feat2.png?v=3',s:1,x:0,y:0},{src:'feat3.png?v=3',s:1,x:0,y:0}];
  }
  return d.featuredGallery;
}
/* 폴라로이드 프레임 방향: frameOrientation 있으면 그 방향, 없으면 기존 가로(PNG, 기존 고객 렌더 바이트 동일).
   세로는 회전이 아니라 '실제 세로 레이아웃'(CSS 프레임)으로 그린다 — 크기 유지·사진 안 넘침. */
function luceFeatured(d){
  var list=getFeaturedGallery(d);
  return '<div class="luce-featured">'+list.map(function(it,i){
    /* 크롭: posX/posY(신규, object-position 팬) 있으면 그걸로, 없으면 기존 translate(하위호환·바이트 동일) */
    var tf=(it.posX!=null||it.posY!=null)
      ? 'object-position:'+(it.posX==null?50:it.posX)+'% '+(it.posY==null?50:it.posY)+'%;transform:scale('+(it.s||1)+')'
      : 'transform:translate('+((it.x||0))+'%,'+((it.y||0))+'%) scale('+(it.s||1)+')';
    /* 대표(폴라로이드) 이미지는 저장 원본 그대로 서빙 */
    var img='<img src="'+esc(it.src||'feat1.png')+'" alt="" draggable="false" oncontextmenu="return false" style="'+tf+'">'
      +(it.grain?'<div style="position:absolute;inset:0;background:url(/assets/grain.png) center/cover;mix-blend-mode:overlay;opacity:.5;pointer-events:none"></div>':'');
    /* 세로 = 기존 PNG 프레임을 90° 회전(같은 질감·그림자·비율). 없으면 기존 가로(바이트 동일) */
    var portrait=(it.frameOrientation==='portrait');
    return '<div class="luce-pola'+(portrait?' is-portrait':'')+'" data-feat-i="'+i+'"><div class="luce-pola-win">'+img+'</div><img class="luce-pola-frame" src="/assets/polaroid.png" alt="" draggable="false"></div>';
  }).join('')+'</div>';
}
function luceGallery(d){
  var gal=(d.gallery||[]).filter(Boolean);
  var grid='';
  if(gal.length){
    var show=gal.slice(0,6);
    grid='<div class="luce-ggrid" data-gal="'+encodeURIComponent(JSON.stringify(gal))+'" data-nozoom="'+(d.galleryNoZoom?'1':'')+'">'+show.map(function(src,i){
      var isMore=(i===5&&gal.length>6);
      var more=isMore?'<div class="luce-gmore">+'+(gal.length-6)+' More</div>':'';
      /* 썸네일은 확대방지와 무관하게 항상 캐러셀로 열림(보기 가능) — 저장·핀치줌은 캐러셀(touch-action:none·우클릭/드래그 차단)이 이미 방지 */
      return '<div class="luce-gcell" onclick="openGalleryCarousel('+i+',this)"><img src="'+esc(src)+'" onerror="this.onerror=null;this.src=\''+esc(src)+'\'" alt="" loading="lazy" decoding="async" draggable="false" oncontextmenu="return false">'+more+'</div>';
    }).join('')+'</div>';
  }
  var mid=(grid)?'<div class="luce-fold" style="margin:10px -25px"></div>':'';
  return '<div data-pv-sec="gallery" style="margin:0 25px 6px">'+luceFeatured(d)+mid+grid+'</div>';
}
function luceMap(p,d){
  /* 지도는 주소 기준(지점 정확) > 예식장명. 구버전 '지도 검색어(mapQuery)' 잔존값은
     다지점 오인의 원인이라 더 이상 사용하지 않는다 */
  var _addr=(p.addr||'').replace(/\n/g,' ').trim();
  var query=(_addr||(d&&d.venueName)||'').trim();
  if(!query)return '';
  var q=encodeURIComponent(query);
  return '<div style="display:flex;justify-content:space-between;margin-top:16px;font-family:'+LUCE_KO+';font-size:13px;font-weight:500">'
      +'<a href="https://map.naver.com/p/search/'+q+'" target="_blank" rel="noopener" style="color:#000;text-decoration:underline">네이버지도↗</a>'
      +'<a href="https://map.kakao.com/?q='+q+'" onclick="return ytsOpenKakao(this.href,\''+q+'\')" rel="noopener" style="color:#000;text-decoration:underline">카카오맵↗</a>'
      +'<a href="tmap://search?name='+q+'" onclick="return ytsOpenTmap(this.href)" rel="noopener" style="color:#000;text-decoration:underline">티맵↗</a>'
    +'</div>';
}
/* v4.3 #6: 계좌 관계 자유 입력 — d.acctOrder=[{key,label}], 기본 1개·최대 6개.
   레거시(고정 신랑/신부 키) 데이터는 최초 접근 시 acctOrder로 이관(하위호환). */
function getAcctOrder(d){
  d.accounts=d.accounts||{};
  if(Array.isArray(d.acctOrder)&&d.acctOrder.length)return d.acctOrder=d.acctOrder.slice(0,6);
  var order=[];
  [['groom','신랑'],['groomFather','신랑 아버지'],['groomMother','신랑 어머니'],['bride','신부'],['brideFather','신부 아버지'],['brideMother','신부 어머니']].forEach(function(m){
    var v=d.accounts[m[0]]; if(v&&(v.bank||v.number||v.holder))order.push({key:m[0],label:m[1]});
  });
  if(!order.length){ d.accounts.ac1=d.accounts.ac1||{bank:'',number:'',holder:''}; order=[{key:'ac1',label:''}]; }
  d.acctOrder=order.slice(0,6);
  return d.acctOrder;
}
function ytsOpenTmap(href){
  var mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if(!mobile){ alert('티맵은 모바일에서 티맵 앱으로 연결됩니다.'); return false; }
  location.href=href;
  /* 앱 미설치 시 폴백: 잠시 후에도 화면이 그대로면 설치 페이지 안내 */
  var t=Date.now();
  setTimeout(function(){ if(Date.now()-t<2200 && !document.hidden){ if(confirm('티맵 앱이 열리지 않았어요. 설치 페이지로 이동할까요?')) location.href='https://www.tmap.co.kr'; } },1800);
  return false;
}
function ytsOpenKakao(webHref,encQ){
  var ua=navigator.userAgent, mobile=/Android|iPhone|iPad|iPod/i.test(ua);
  if(!mobile){ window.open(webHref,'_blank','noopener'); return false; }
  location.href='kakaomap://search?q='+encQ;
  /* 앱 미설치 폴백: 잠시 후에도 화면이 그대로면 설치 페이지 안내 */
  var store=/Android/i.test(ua)?'https://play.google.com/store/apps/details?id=net.daum.android.map':'https://apps.apple.com/kr/app/id304608425';
  var t=Date.now();
  setTimeout(function(){ if(Date.now()-t<2200 && !document.hidden){ if(confirm('카카오맵 앱이 열리지 않았어요. 설치 페이지로 이동할까요?')) location.href=store; } },1800);
  return false;
}
function luceAcctRows(p,d){
  var a=(d&&d.accounts)||p.accounts||{}, KO=LUCE_KO;
  var order=(d&&typeof getAcctOrder==='function')?getAcctOrder(d):[];
  /* v4.5: 번호가 아직 없어도 예금주/은행만 입력되면 즉시 표시 — '입력했는데 반영 안 됨' 착시 방지. 복사 버튼은 번호가 있을 때만 */
  var fmt=function(role,slot,v){ return (v&&(v.number||v.bank||v.holder))?
    '<div class="luce-acc-row" data-acct-slot="'+slot+'" style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:1px solid #eee;font-family:'+KO+'">'
      +'<div style="text-align:left"><div style="font-size:11.5px;color:#8a8574">'+esc(role)+'</div><div style="font-size:13px;margin-top:3px;color:#141414">'+esc(v.holder||'')+(v.bank?(v.holder?' · ':'')+esc(v.bank):'')+'</div>'+(v.number?'<div style="font-size:14px;margin-top:2px;color:#141414">'+esc(v.number)+'</div>':'<div style="font-size:12px;margin-top:2px;color:#b0aa96">계좌번호 미입력</div>')+'</div>'
      +(v.number?'<button type="button" onclick="copyAcct(\''+esc(v.number)+'\')" style="flex:0 0 auto;border:1px solid #ddd;background:#fff;border-radius:6px;padding:7px 13px;font-size:12px;cursor:pointer;font-family:'+KO+';color:#141414">복사</button>':'')
    +'</div>':''; };
  if(d && d.acctGroupBySide){
    /* 신랑측/신부측 구분(opt-in) — 색상 블록 디자인. 신랑측=연블루+관계 파랑, 신부측=연코럴+관계 핑크.
       side 미지정=신랑측 기본. 빈(미입력) 그룹은 블록도 숨김. */
    var fmtG=function(o,roleColor,isFirst){
      var v=a[o.key];
      return '<div class="luce-acc-row" data-acct-slot="'+o.key+'" style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;'+(isFirst?'':'border-top:1px solid rgba(0,0,0,.06);')+'font-family:'+KO+'">'
        +'<div style="text-align:left">'
          +'<div style="font-size:12px;font-weight:600;color:'+roleColor+'">'+esc(o.label||'계좌')+'</div>'
          +'<div style="font-size:13px;margin-top:3px;color:#141414">'+esc(v.holder||'')+(v.bank?(v.holder?' · ':'')+esc(v.bank):'')+'</div>'
          +(v.number?'<div style="font-size:14px;margin-top:2px;color:#141414">'+esc(v.number)+'</div>':'')
        +'</div>'
        +(v.number?'<button type="button" onclick="copyAcct(\''+esc(v.number)+'\')" style="flex:0 0 auto;border:1px solid #ddd;background:#fff;border-radius:6px;padding:7px 13px;font-size:12px;cursor:pointer;font-family:'+KO+';color:#141414">복사</button>':'')
      +'</div>';
    };
    var mkBlock=function(list,roleColor,bg){
      var valid=list.filter(function(o){ var v=a[o.key]; return v&&(v.number||v.bank||v.holder); });
      if(!valid.length) return null;
      return { rows:valid.map(function(o,i){ return fmtG(o,roleColor,i===0); }).join(''), bg:bg };
    };
    var groom=order.filter(function(o){return o.side!=='bride';});
    var bride=order.filter(function(o){return o.side==='bride';});
    var blocks=[mkBlock(groom,'#356693','rgba(177,218,255,.2)'), mkBlock(bride,'#FF7375','rgba(255,191,177,.2)')].filter(Boolean);
    /* 풀블리드: 좌우는 흰 카드 20px 패딩 상쇄, 첫 블록은 위 2px·마지막 블록은 아래 16px 패딩까지 상쇄해 흰 여백 제거. 내용은 flat과 동일 정렬 */
    return blocks.map(function(bl,i){
      var mt=(i===0)?'-2px':'0', mb=(i===blocks.length-1)?'-16px':'0';
      return '<div style="background:'+bl.bg+';margin:'+mt+' -20px '+mb+';padding:0 20px">'+bl.rows+'</div>';
    }).join('');
  }
  return order.map(function(o){ return fmt(o.label||'계좌',o.key,a[o.key]); }).join('');
}
function luceShare(d,prev){
  var slug=userSlugForData(d)||'';
  var icon='<img src="/assets/icon-share.png" alt="" style="width:12px;height:auto">';
  return '<div style="padding:'+((prev==='accounts')?'15px':'0')+' 48px 0"><div data-pv-sec="share">'
    +'<button type="button" onclick="ytsShare(\''+esc(slug)+'\')" style="width:100%;display:flex;align-items:center;justify-content:space-between;background:#fff;border:0;padding:15px 20px;cursor:pointer;font-family:var(--mono);font-size:13px;font-weight:500;color:#000">공유하기 '+icon+'</button>'
  +'</div></div>';
}
/* 한글 이름에서 성 제외(3자 이상이면 첫 글자 제거) */
function luceGivenEn(n){n=(n||'').trim();return n.split(/\s+/)[0]||n;}
function luceGivenName(n){n=(n||'').trim();if(!n)return n;if(/^[가-힣]+$/.test(n))return n.length>=3?n.slice(1):n;return n.split(/\s+/)[0]||n;}
/* 커버 크롭 스타일 — 이중 경로.
   · posY 있음(신규/마이그레이션): 세로=object-position, 가로=translateX, 줌=scale (translate.y 은퇴)
   · posY 없음(기존 전부): 현재 코드와 '바이트 동일'(object-position 미지정=기본 50% 50%). 절대 안 바뀜.
   ※ 신규 데이터는 모두 posY 구조. posY-없음 경로는 기존 데이터 보호용 임시 호환(동결). */
function ytsCoverCropStyle(cc){
  cc=cc||{};
  if(cc.posY!=null){
    return 'object-position:50% '+(+cc.posY)+'%;transform:translate('+(cc.x||0)+'%,0%) scale('+(cc.s||1)+')';
  }
  return 'transform:translate('+(cc.x||0)+'%,'+(cc.y||0)+'%) scale('+(cc.s||1)+')';
}
function tplLuce(d){
  const p=invParts(d);
  const MONO="var(--mono)", KO=LUCE_KO, ink='#141414', sub='#6f6a58';
  const gEn=esc(p.gEn), bEn=esc(p.bEn);

  /* 레몬(luce) 전용 배경 — 연노랑 종이 */
  const pageBg='#f1e8a1 url(/assets/paper-mid-lemon.png) top center/100% auto repeat-y';
  const pageInk=ink;
  let html='<div class="inv luce" style="background:'+pageBg+';color:'+pageInk+';font-family:'+KO+';text-align:center;padding:0 0 48px">';
  /* ── 고정 헤더: 커버 + 데코 + 이름 행 + 고정 가로 사진 ── */
  var _cc=d.coverCrop||{};
  html+='<div class="luce-coverwrap" data-pv-sec="cover" style="position:relative;width:100%;aspect-ratio:380/500;overflow:hidden;background:#cfc9b0">'
    +'<img class="luce-coverimg" src="'+esc(d.cover||'luce-cover.jpg?v=4')+'" alt="" draggable="false" onerror="if(!this._f){this._f=1;this.src=\''+esc(d.cover||'luce-cover.jpg?v=4')+'\';}else if(this.src.indexOf(\'luce-cover.jpg?v=4\')<0){this.src=\'luce-cover.jpg?v=4\';}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center;'+ytsCoverCropStyle(_cc)+'">'
    +((d.coverGrainEnabled!==false)?'<div style="position:absolute;inset:0;background:url(/assets/grain.png) center/cover;mix-blend-mode:overlay;opacity:.5;pointer-events:none"></div>':'')
    +'<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,26,18,.1),transparent 40%,rgba(20,26,18,.5))"></div>'
    +(((((d.sections||[]).find(function(_x){return _x.id==='cover';})||{show:true}).show!==false)
      ? '<div style="position:absolute;left:26px;right:26px;bottom:28px;text-align:left;color:#fff;font-family:'+MONO+'">'
          +((d.coverNames!==false)?'<div style="font-size:13px;letter-spacing:.02em">'+esc(luceGivenEn(p.gEn))+' ‧ '+esc(luceGivenEn(p.bEn))+'</div>':'')
          +((d.coverIntro!=null?d.coverIntro:'Every love story is beautiful, but ours is just beginning. Join us as we promise each other a lifetime of love, laughter, and endless memories.').trim()?'<div style="font-size:13px;line-height:1.55;margin-top:14px">'+esc((d.coverIntro!=null?d.coverIntro:'Every love story is beautiful, but ours is just beginning. Join us as we promise each other a lifetime of love, laughter, and endless memories.'))+'</div>':'')
        +'</div>'
      : ''))
  +'</div>';
  html+='<div style="padding:36px 40px 0;font-family:'+MONO+';font-size:14px;letter-spacing:.06em">₊˚⊹⋆</div>';
  html+='<div style="padding:24px 20px 4px"><div style="display:flex;justify-content:space-between;align-items:center;max-width:250px;margin:0 auto;font-family:'+MONO+';font-size:14px;font-weight:500">'
    +'<span>'+esc(luceGivenEn(p.gEn))+'</span><span>&amp;</span><span>'+esc(luceGivenEn(p.bEn))+'</span>'
  +'</div></div>';
  html+='<div class="luce-fold"></div>';
  var _sc2=d.subCoverCrop||{};
  html+='<div style="padding:0 0 4px"><div class="luce-subwin"><img class="luce-subcover" src="'+esc(d.subCoverImage||'/assets/luce-gallery.jpg')+'" alt="" draggable="false" style="transform:translate('+(_sc2.x||0)+'%,'+(_sc2.y||0)+'%) scale('+(_sc2.s||1)+')">'
    +(d.subCoverGrainEnabled?'<div style="position:absolute;inset:0;background:url(/assets/grain.png) center/cover;mix-blend-mode:overlay;opacity:.5;pointer-events:none"></div>':'')
  +'</div></div>';

  /* ── 섹션 루프: d.sections 순서 그대로 (Preview=Sidebar=DB 단일 소스) ── */
  const sk={bg:'transparent',text:ink,sub:sub,accent:ink,label:ink,rule:'#d9cf93',border:'#d9cf93',dark:false};
  const REN={
    invitation:function(){
      /* Figma Group 31: 센터 정렬 카드 — 데코·이름·인사말·혼주·일시 */
      function famLine(f,fd,m,md,rel,defRel,nameKo){
        /* v4.5: 고인은 이름 앞 국화 이미지, 자녀 이름은 성 포함 전체 이름 */
        var MUM='<img src="/assets/deceased-flower.png" alt="故" draggable="false" style="display:inline-block;height:1.2em;vertical-align:-0.25em;margin-right:2px">';
        var ps=[]; if(f&&f.trim())ps.push((fd?MUM:'')+esc(f.trim())); if(m&&m.trim())ps.push((md?MUM:'')+esc(m.trim()));
        if(!ps.length)return '';
        return '<div>'+ps.join(' · ')+' 의 <span class="luce-rel" style="color:#b9b4a5">'+esc((rel&&rel.trim())||defRel)+'</span> '+esc((nameKo||'').trim())+'</div>';
      }
      var g1=famLine(d.groomFather,d.groomFatherDec,d.groomMother,d.groomMotherDec,d.groomRelation,'아들',p.gKo);
      var b1=famLine(d.brideFather,d.brideFatherDec,d.brideMother,d.brideMotherDec,d.brideRelation,'딸',p.bKo);
      var fam=(g1||b1)?('<div style="margin-top:34px;font-size:14px;line-height:190%;letter-spacing:.06em;word-spacing:.14em;color:#000">'+g1+b1+'</div>'):'';
      /* 인사말 카드의 일시·장소는 해당 섹션(when/where)이 켜져 있을 때만 표시 — 섹션을 끄면 여기서도 사라짐 */
      var _shownSec=function(id){ var s=(d.sections||[]).find(function(x){return x.id===id;}); return !s||s.show!==false; };
      var dt=_shownSec('when')?luceDateDot(d):'';
      var _vn=_shownSec('where')?p.venue:'';
      var when=(dt||_vn)?('<div style="margin-top:26px;font-size:14px;line-height:190%;color:#000">'+(dt?'<div>'+esc(dt)+'</div>':'')+(_vn?'<div>'+esc(_vn)+'</div>':'')+'</div>'):'';
      var _hdr=(d.greetingHeader!==false)
        ? '<div style="font-family:'+MONO+';font-size:13px;letter-spacing:.06em">₊˚⊹⋆</div>'
          +'<div style="font-family:'+KO+';font-size:14px;line-height:2;margin-top:14px;color:#000">'+esc(luceGivenName(p.gKo))+' ‧ '+esc(luceGivenName(p.bKo))+'</div>'
        : '';
      return '<div style="padding:18px 25px 0"><div data-pv-sec="invitation" style="background:#fff;color:#141414;padding:38px 30px 42px;text-align:center">'
        +_hdr
        +'<div class="greet" style="font-family:'+KO+';font-size:14px;font-weight:400;line-height:1.8;white-space:pre-line;color:#000;margin-top:'+(d.greetingHeader!==false?'22':'0')+'px;max-width:284px;margin-left:auto;margin-right:auto">'+esc(p.greet)+'</div>'
        +fam+when
      +'</div></div>';
    },
    couple:function(){ return '<div data-pv-sec="couple" style="height:1px"></div>'; /* 혼주는 인사말 카드에 통합(Figma) */ },
    gallery:function(){ return luceGallery(d); },
    /* venue/date/info는 콘텐츠만 반환 — 흰 배경·외부여백·카드사이 간격은 아래 loop의 '그룹 컨테이너'가 담당.
       (개별 카드에 상하 margin/padding을 두지 않아야 인접 시 여백이 합산되지 않는다) */
    where:function(){
      return '<div data-pv-sec="where">'
        +'<div style="font-family:'+MONO+';font-size:14px;font-weight:500;line-height:1.8;color:#000">⊹ venue ⊹</div>'
        +'<div style="font-size:14px;line-height:1.8;margin-top:10px;color:#000">'
          +'<div class="info-line">'+esc(p.venue||'예식장 이름')+'</div>'
          +(p.addr?'<div style="white-space:pre-line">'+esc(p.addr)+'</div>':'')
          +(d.floorHall?'<div>'+esc(d.floorHall)+'</div>':'')
          +(d.venuePhone?'<div>'+esc(d.venuePhone)+'</div>':'')
        +'</div>'
      +'</div>';
    },
    when:function(){
      var dt=luceDateDot(d);
      return '<div data-pv-sec="when">'
        +'<div style="font-family:'+MONO+';font-size:14px;font-weight:500;line-height:1.8;color:#000">⊹ date ⊹</div>'
        +'<div class="info-line" style="font-size:14px;line-height:1.8;margin-top:10px;color:#000">'+esc(dt||'날짜 미정')+'</div>'
      +'</div>';
    },
    accounts:function(prev){
      var rows=luceAcctRows(p,d);
      if(!rows) return '<div data-pv-sec="accounts" style="height:1px"></div>'; /* 계좌 미입력 시 배포 화면에서 숨김(에디터는 placeholder) */
      return '<div style="padding:'+((prev==='accounts')?'15px':'0')+' 48px 0"><div data-pv-sec="accounts">'
        +'<details class="luce-acct"><summary style="list-style:none;display:flex;align-items:center;justify-content:space-between;background:#B9D9FF;padding:15px 20px;cursor:pointer;font-family:'+KO+';font-size:13px;font-weight:500;color:#000">'+esc(getSecLabel(d,'accounts')||'마음 전하실 곳')+'<img src="/assets/icon-acct.png" alt="" style="width:12px;height:auto"></summary>'
        +'<div style="background:#fff;padding:2px 20px 16px">'+rows+'</div>'
        +'</details>'
      +'</div></div>';
    },
    notice:function(){
      /* 콘텐츠만 — 흰 카드/여백은 그룹 컨테이너가 담당(위 where 주석 참고) */
      return '<div data-pv-sec="notice">'
        +'<div style="font-family:'+MONO+';font-size:14px;font-weight:500;line-height:1.8;color:#000">⊹ information ⊹</div>'
        +(p.notice?'<div class="greet" style="font-size:14px;line-height:1.8;white-space:pre-line;color:#000;margin-top:10px">'+esc(p.notice)+'</div>':'')
      +'</div>';
    },
    cover:function(){ return ''; }, /* 실제 표지는 상단 luce-coverwrap(data-pv-sec=cover)이 담당 */
    share:function(prev){ return luceShare(d,prev); }
  };
  const sections=getSections(d);
  let _prevSec=null;
  const JOINED={'when|where':1,'where|when':1,'where|notice':1,'notice|where':1,'notice|when':1,'when|notice':1,'accounts|share':1}; /* 연결 그룹: 사이에 접힘선 없음. 하단 번들(accounts·share)은 순서 무관 연결 */
  const VGROUP={when:1,where:1,notice:1};
  /* 그룹 여백 규칙(한 곳에서만 관리):
     GROUP_PAD = 그룹(흰 카드) 상/하 외부여백 — 단독 카드일 때도 위아래가 여유롭게 뜬다.
     GROUP_GAP = 카드 사이 '단일' 간격(flex gap) — 인접해도 합산되지 않고 위치와 무관하게 항상 동일. */
  var GROUP_PAD=30, GROUP_GAP=24;
  const visSecs=sections.filter(function(x){return x.show;});
  for(var _i=0;_i<visSecs.length;_i++){
    var sec=visSecs[_i];
    if(VGROUP[sec.id]){
      /* 연속된 venue그룹(venue/date/info)을 하나의 흰 카드 컨테이너로 묶는다.
         컨테이너 padding=그룹 외부여백, flex gap=카드 사이 단일 간격. 카드 자체엔 상하 여백이 없으므로
         카드가 위/중간/아래 어디로 가도, 몇 개가 붙어도 간격이 항상 동일(중복 합산 없음). */
      var run=[]; var _j=_i;
      while(_j<visSecs.length && VGROUP[visSecs[_j].id]){ run.push(visSecs[_j]); _j++; }
      if(_prevSec && !JOINED[(_prevSec||'')+'|'+sec.id]) html+='<div class="luce-fold"></div>';
      html+='<div style="padding:0 25px"><div style="background:#fff;padding:'+GROUP_PAD+'px 24px;display:flex;flex-direction:column;gap:'+GROUP_GAP+'px;text-align:center;font-family:'+KO+'">';
      for(var _r=0;_r<run.length;_r++){ html+= REN[run[_r].id](); }
      /* 지도: venue(where)가 이 그룹에 있으면 '그룹 최하단'에 1개만 배치(카드와 동일한 flex item → gap 자동, 중복여백 없음).
         venue가 마지막이면 자연히 venue 바로 밑, venue가 중간이어도 map은 항상 맨 아래(venue↔map 소속은 유지, 시각배치만 최하단).
         venue가 그룹에 없으면(숨김) 지도 없음 — 지도는 venue 전용 요소. */
      if(run.some(function(s){return s.id==='where';})){
        html+='<div data-yts-map style="text-align:left;max-width:284px;margin-left:auto;margin-right:auto;width:100%">'+luceMap(p,d)+'</div>';
      }
      html+='</div></div>';
      _prevSec=run[run.length-1].id; _i=_j-1; continue;
    }
    var chunk= REN[sec.id]? REN[sec.id](_prevSec) : '';
    if(chunk && chunk.indexOf('height:1px')<0){ /* 빈 stub 앞엔 접힘선 생략 */
      if(!JOINED[(_prevSec||'')+'|'+sec.id]) html+='<div class="luce-fold"></div>';
      html+=chunk; _prevSec=sec.id;
    } else {
      /* 빈 stub: 접힘선 없이 위치만 기록. 단 accounts는 계좌·공유 번들의 시작점이라
         stub여도 그룹↔번들 접힘선을 유지한다(하객: 접힘선+공유 / 에디터: 접힘선+파란 바+공유) */
      if(sec.id==='accounts' && !JOINED[(_prevSec||'')+'|'+sec.id]) html+='<div class="luce-fold"></div>';
      html+=chunk; _prevSec=sec.id;
    }
  }
  html+='<div class="luce-fold"></div>';
  html+=invFooter(sk,d);
  html+='</div>';
  return html;
}

function renderInvitation(d){
  d=d||{};
  return tplLuce(d);
}
