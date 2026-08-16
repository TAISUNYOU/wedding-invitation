/* ============================================================================
   CEZ Editor v4 — WYSIWYG (병행/격리 모듈)
   - 라우트: #/v4  (기존 #/editor 폼 에디터와 완전 분리)
   - 하객 렌더러 renderInvitation() 은 수정하지 않는다. 편집은 "오버레이"로만 얹는다.
   - 저장은 기존 saveEditor() 재사용(=SB.saveInvitation 영속 + 권한 게이팅).
   - Phase 1 슬라이스 1: Minimal 파일럿. 인라인 텍스트/표지 + ☰ 사이드바(섹션·정밀필드).
   전역 의존: editTarget, renderInvitation, blankData, getSections, defaultSectionsList,
             sampleInvData, DB, SB, esc, app, go, saveEditor.
   ============================================================================ */
(function(){
  'use strict';
  var V4 = { mode:'edit', openSec:null, pvMode:'live' };

  var SEC_LABEL = {cover:'표지 문구',invitation:'인사말',couple:'가족 정보',gallery:'갤러리',when:'date',where:'venue',accounts:'마음 전하실 곳',rsvp:'참석 의사 전달하기',notice:'information',share:'공유'};

  /* 인라인 편집 스키마 (스코프 선택자 + 인덱스). 템플릿 추가 시 여기만 확장. */
  function schemaFor(){
    return {
      texts:[
        {k:'eyebrow', sel:'.eyebrow', idx:0, ph:'SAVE THE DATE'},
        {k:'greeting', sel:'[data-pv-sec="invitation"] .greet', idx:0, multiline:true, ph:'인사말을 입력하세요'},
        {k:'groomKo',  sel:'[data-pv-sec="couple"] .couple .nm', idx:0, ph:'신랑 이름'},
        {k:'brideKo',  sel:'[data-pv-sec="couple"] .couple .nm', idx:1, ph:'신부 이름'},
        {k:'venueName',sel:'[data-pv-sec="where"] .info-line',   idx:0, ph:'식장 이름'},
        {k:'notice',   sel:'[data-pv-sec="notice"] .greet',      idx:0, multiline:true, ph:'안내사항'}
      ],
      images:[]
    };
  }

  /* 사이드바 정밀 필드(인라인으로 못 하는 것 위주) */
  var SECFIELDS = {
    cover:[{toggle:'coverNames',l:'이름 표시'},{k:'coverIntro',t:'ta',l:'표지 문구'}],
    invitation:[{toggle:'greetingHeader',l:'헤더 표시 (글리프 · 신랑신부 이름)'},{k:'greeting',t:'ta',l:'인사말'}],
    couple:[
      {k:'groomKo',l:'신랑 (한글)'},{k:'groomEn',l:'신랑 (영문)'},
      {k:'brideKo',l:'신부 (한글)'},{k:'brideEn',l:'신부 (영문)'},
      {k:'groomFather',l:'신랑 아버지',chk:'groomFatherDec'},
      {k:'groomMother',l:'신랑 어머니',chk:'groomMotherDec'},
      {k:'groomRelation',l:'신랑 호칭',ph:'예: 장남, 차남, 막내, 아들'},
      {k:'brideFather',l:'신부 아버지',chk:'brideFatherDec'},
      {k:'brideMother',l:'신부 어머니',chk:'brideMotherDec'},
      {k:'brideRelation',l:'신부 호칭',ph:'예: 장녀, 차녀, 막내, 딸'}
    ],
    when:[{k:'date',t:'date',l:'예식 날짜'},{k:'time',t:'time',l:'예식 시간'}],
    where:[{k:'venueName',l:'식장 이름'},{k:'venueAddr',t:'ta',l:'주소 (줄바꿈 가능) — 지도는 이 주소로 표시돼요',addrSearch:true}],
    notice:[{k:'notice',t:'ta',l:'안내사항',ph:'지하 주차 2시간 무료 · 신부 대기실은 1층 로비'}]
  };

  function inv(){ try{ return (typeof editTarget==='function')?editTarget():null; }catch(e){ return null; } }
  function data(){ var u=inv(); return u?u.data:null; }
  /* 진단 trace(수정 아님): staging 에선 자동 on, 운영은 window.CEZ_DEBUG=true 일 때만. 섹션 드래그 원인 규명용. */
  function _tr(){ try{ if(window.CEZ_DEBUG || (location.host||'').indexOf('staging')>=0) console.log.apply(console,['[CEZ-TRACE]'].concat([].slice.call(arguments))); }catch(_){} }
  var _tid=0, _curTid=0, _lastUpAt=0;   /* 드래그 1회 = Trace T#. 릴리즈 후 click(숨김토글) 오염 판별용 _lastUpAt */

  /* ---------------- 저장 ---------------- */
  var _sv,_bt,_dirty=false;
  window.addEventListener('beforeunload',function(e){
    if(_dirty && (location.hash||'').indexOf('#/editor')===0 && !isAdminPreview()){
      e.preventDefault(); e.returnValue='저장되지 않은 변경이 있어요.';
      return e.returnValue;
    }
  });
  /* 관리자 미리보기 가드: 관리자는 editTarget()이 '타인의 청첩장'을 가리키는데
     SB.saveInvitation은 관리자 본인 user_id로 저장 → 데이터 오염/ slug 충돌 위험.
     따라서 관리자 세션에서는 오토세이브를 끄고 시각 편집만 허용한다. */
  function isAdminPreview(){ try{ return !!(window.SB && SB.isAdmin && SB.isAdmin()); }catch(e){ return false; } }
  var _pxT;
  function adminProxySave(){
    var u=inv(); if(!u||!u._supabaseRowId){ setBadge('error'); if(typeof toast==='function')toast('대리 편집 저장 실패: 서버 청첩장이 없어요'); return; }
    SB.client.rpc('admin_save_invitation',{p_invitation_id:u._supabaseRowId,p_data:u.data,p_template:(u.data&&u.data.template)||'luce',p_slug:(u.slug||'')}).then(function(r){
      if(r.error&&String(r.error.message||'').indexOf('function')>=0){
        /* v45_admin_save_slug.sql 미실행 폴백 — 주소 제외 저장 */
        return SB.client.rpc('admin_save_invitation',{p_invitation_id:u._supabaseRowId,p_data:u.data,p_template:(u.data&&u.data.template)||'luce'}).then(function(r2){
          if(r2.error){ console.error('[proxy save]',r2.error); setBadge('error'); if(typeof toast==='function')toast('대리 편집 저장 실패: '+r2.error.message); }
          else { setBadge('saved'); if(typeof toast==='function')toast('저장됨 (주소 변경은 v45_admin_save_slug.sql 실행 필요)'); }
        });
      }
      if(r.error){ console.error('[proxy save]',r.error); setBadge('error'); if(typeof toast==='function')toast('대리 편집 저장 실패: '+r.error.message); }
      else setBadge('saved');
    });
  }
  window.V4proxyPublish=function(){
    var u=inv(); if(!u||!u._supabaseRowId)return;
    if(!confirm('이 회원의 청첩장을 즉시 공개할까요?\n(공개 권한도 함께 부여됩니다)'))return;
    if(typeof cezToggleInvPublish==='function'){
      /* 권한이 ACTIVE가 아니면 서버 게이트가 하객을 차단하므로 권한부터 부여 */
      try{ if(u._userId&&window.SB&&SB.client) SB.client.rpc('grant_permission',{p_user_id:u._userId,p_new_status:'ACTIVE',p_memo:'즉시 공개(관리자)'}); }catch(e){}
      cezToggleInvPublish(u._supabaseRowId,true,null);
      u.published=true; rebuildPublishCard(); updateStateBadge();
      if(typeof toast==='function')toast('공개되었습니다 (권한 부여 포함)');
    } else alert('관리자 콘솔을 먼저 열어 주세요.');
  };
  window.V4toggleProxy=function(){
    V4.proxyEdit=!V4.proxyEdit;
    var b=document.getElementById('v4-proxybtn');
    if(b){ b.textContent=V4.proxyEdit?'대리 편집 비활성화':'대리 편집 활성화'; b.style.background=V4.proxyEdit?'#fdeaea':''; b.style.color=V4.proxyEdit?'#e5484d':''; b.style.fontWeight=V4.proxyEdit?'700':''; }
    if(typeof toast==='function') toast(V4.proxyEdit?'대리 편집 모드 — 이 회원의 청첩장에 실제로 저장됩니다':'대리 편집 해제 — 저장 안 함(미리보기)');
  };
  function scheduleSave(){
    if(isAdminPreview()){
      if(V4.proxyEdit){ setBadge('saving'); clearTimeout(_pxT); _pxT=setTimeout(adminProxySave,700); return; }
      var b=document.getElementById('v4-badge'); if(b){ b.className='v4-badge'; b.textContent='관리자 미리보기 · 저장 안 됨'; } return; }
    _dirty=true;
    setBadge('saving');
    clearTimeout(_sv);
    _tr('scheduleSave queued (700ms debounce)');
    _sv=setTimeout(function(){
      _tr('scheduleSave → saveEditor()');
      try{ if(typeof saveEditor==='function') saveEditor(); }catch(e){ console.error('[v4 save]',e); _tr('saveEditor THREW', e && (e.message||e)); }
      setBadge('saved');
    },700);
  }
  var _lastSaveAt=0,_agoT;
  function _agoText(){
    if(!_lastSaveAt)return '';
    var s=Math.floor((Date.now()-_lastSaveAt)/1000);
    if(s<60)return '방금 저장됨';
    var m=Math.floor(s/60); if(m<60)return m+'분 전 저장';
    return Math.floor(m/60)+'시간 전 저장';
  }
  function _showAgo(){ var b=document.getElementById('v4-badge'); if(b&&!/저장 중|실패/.test(b.textContent)){ b.className='v4-badge saved'; b.textContent=_agoText(); } }
  function setBadge(s){
    var b=document.getElementById('v4-badge'); if(!b)return;
    if(s==='saving'){ b.className='v4-badge saving'; b.textContent='저장 중…'; }
    else if(s==='error'){ b.className='v4-badge error'; b.textContent='저장 실패 ⚠'; clearTimeout(_bt); }
    else {
      _dirty=false;
      _lastSaveAt=Date.now();
      b.className='v4-badge saved'; b.textContent='저장됨 ✓';
      clearTimeout(_bt); _bt=setTimeout(_showAgo,1800);
      clearInterval(_agoT); _agoT=setInterval(_showAgo,30000);
    }
  }
  window.V4logout=function(){
    if(!confirm('로그아웃할까요? 저장된 내용은 유지됩니다.'))return;
    if(window.SB&&typeof SB.signOut==='function'){ SB.signOut(); } else { location.hash='#/'; location.reload(); }
  };
  window.V4saveNow=function(){
    if(isAdminPreview()){
      if(V4.proxyEdit){ clearTimeout(_pxT); setBadge('saving'); adminProxySave(); return; } /* 대리 편집 활성화 시 즉시 실제 저장 */
      alert('관리자 미리보기에서는 저장되지 않아요.\n이 회원의 청첩장에 저장하려면 상단의 [대리 편집 활성화]를 눌러 주세요.');
      return;
    }
    clearTimeout(_sv); setBadge('saving');
    try{ if(typeof saveEditor==='function') saveEditor(); }catch(e){ console.error('[v4 saveNow]',e); }
    setTimeout(function(){ setBadge('saved'); if(typeof toast==='function') toast('저장이 완료되었습니다 ✓'); },400);
  };
  /* index.html 저장 오버라이드가 실패 시 호출 — 조용한 실패 방지 */
  window.V4saveError=function(e){
    setBadge('error');
    var msg=(e&&e.message)||'';
    if(/duplicate|unique|slug/i.test(msg)){
      var el=document.getElementById('v4-slug-msg');
      if(el){ el.textContent='✕ 이미 사용 중인 주소예요 — 다른 주소로 바꿔 주세요'; el.style.color='#e5484d'; }
      else if(typeof toast==='function') toast('이미 사용 중인 주소예요 — 공개 주소를 바꿔 주세요');
    }
  };

  /* ---------------- 캔버스 렌더 + 오버레이 ---------------- */
  function refreshCanvas(){
    var c=document.getElementById('v4-canvas'); var d=data();
    if(!c||!d)return;
    if(V4.pvMode==='post' && typeof renderThankYouPreview==='function'){ c.innerHTML=renderThankYouPreview(d); if(!V4.fullPv)decoratePost(c,d); return; }
    _tr('T'+_curTid+' RENDER_START');
    try{ c.innerHTML=renderInvitation(d); _tr('T'+_curTid+' RENDER_END'); }
    catch(err){ _tr('T'+_curTid+' RENDER_ERROR '+(err&&(err.stack||err.message||err))); throw err; }
    if(!V4.fullPv)decorate(c,d);
  }
  /* 공개 후(종료) 화면도 WYSIWYG: 제목·메시지 인라인 편집 (#6) */
  function decoratePost(root,d){
    if(!root||!d)return;
    [['thx-title','thankYouTitle'],['thx-msg','thankYouMessage']].forEach(function(pair){
      var el=root.querySelector('.'+pair[0]); if(!el)return;
      el.setAttribute('contenteditable','true');
      el.classList.add('v4-edit-text');
      el.addEventListener('input',function(){ d[pair[1]]=el.innerText; scheduleSave(); });
      if(pair[0]==='thx-title'){ el.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); el.blur(); } }); }
    });
  }
  var _cr;
  function refreshCanvasDebounced(){ clearTimeout(_cr); _cr=setTimeout(refreshCanvas,180); }
  /* 레거시 refreshPreview(#pv-scroll 대상)가 V4 캔버스도 갱신하도록 노출 — 드로어에 임베드된 구식 핸들러(setRsvpField·음악 토글 등)용 */
  window.V4refreshCanvas=refreshCanvas;

  function onInlineInput(el){
    var d=data(); if(!d)return;
    var k=el.getAttribute('data-k'); if(!k)return;
    d[k]=el.innerText;
    var f=document.getElementById('v4f-'+k); if(f && f.value!==d[k]) f.value=d[k]; /* 사이드바 즉시 동기화 */
    scheduleSave();
  }

  /* ---- 섹션 타이틀(모든 텍스트=데이터) ---- */
  function hasLabel(id){ try{ return typeof DEFAULT_SEC_LABELS!=='undefined' && !!DEFAULT_SEC_LABELS[id]; }catch(e){ return false; } }
  function labelDefault(id){ try{ return (typeof DEFAULT_SEC_LABELS!=='undefined' && DEFAULT_SEC_LABELS[id]) || id; }catch(e){ return id; } }
  function onLabelInput(el,sec){
    var d=data(); if(!d)return;
    d.sectionLabels=d.sectionLabels||{};
    d.sectionLabels[sec]=el.innerText;
    var f=document.getElementById('v4t-'+sec); if(f && f.value!==el.innerText) f.value=el.innerText;
    scheduleSave();
  }
  window.V4setLabel=function(sec,v){ var d=data(); if(!d)return; d.sectionLabels=d.sectionLabels||{}; d.sectionLabels[sec]=v; refreshCanvasDebounced(); scheduleSave(); };

  /* ---- Empty State: 비어도 영역 유지 + placeholder(클릭=편집) ---- */
  function fillEmpty(root,sec,title,hint){
    var el=root.querySelector('[data-pv-sec="'+sec+'"]'); if(!el)return;
    var empty = el.offsetHeight<=3 || el.textContent.trim()==='';
    if(!empty)return;
    el.style.height='';
    el.innerHTML='<div class="v4-ph-sec"><div class="v4-ph-title">'+esc(title)+'</div><div class="v4-ph-hint">'+esc(hint)+'</div></div>';
  }

  /* ---- BGM ---- */
  function musicChipLabel(){
    var d=data(); var m=(d&&d.music)||{};
    if(!m.enabled||m.kind==='none') return '♪ 배경음악 꺼짐';
    if(m.kind==='upload') return '♪ '+(m.name?(m.name.length>18?m.name.slice(0,17)+'…':m.name):'업로드한 음악');
    var pres=(DB.defaults&&DB.defaults.musicPresets)||[]; var p=pres[m.presetIdx];
    return '♪ '+((p&&p.name)||'배경 음악');
  }
  function musicCardHTML(){
    var d=data(); var m=d.music||{}; var on=!!m.enabled; var pres=(DB.defaults&&DB.defaults.musicPresets)||[];
    var play=function(url){
      if(!url) return '';
      var playing=(window._v4PvAudio&&!window._v4PvAudio.paused&&window._v4PvUrl===url);
      return '<button type="button" class="v4-mplay" data-url="'+esc(url)+'" onclick="event.stopPropagation();V4musicPreview(\''+esc(url)+'\')" title="미리듣기" style="flex:0 0 auto;margin-left:auto;width:26px;height:26px;border:1px solid #d6d6d6;background:#fff;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;color:#262626">'+(playing?'■':'▶')+'</button>';
    };
    var rows='<div class="v4-mrow'+((!on||m.kind==='none')?' sel':'')+'" onclick="V4music(\'off\')">끄기 (없음)</div>';
    pres.forEach(function(p,i){ rows+='<div class="v4-mrow'+((on&&m.kind==='preset'&&m.presetIdx===i)?' sel':'')+'" style="display:flex;align-items:center;gap:8px" onclick="V4music(\'preset\','+i+')"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">♪ '+esc((p&&p.name)||('샘플 '+(i+1)))+'</span>'+play(p&&p.url)+'</div>'; });
    var _upName=(m.kind==='upload'&&m.url)?(m.name||'업로드한 음악'):'';
    var _upInner=_upName
      ? '♪ '+esc(_upName)+' <span style="color:#22a06b;font-weight:700">✓</span>'
      : '직접 업로드 <span style="color:#9e9e9e;font-weight:400">(2분 이내 권장)</span>';
    rows+='<div class="v4-mrow'+((on&&m.kind==='upload'&&m.url)?' sel':'')+'"'+(_upName?' title="탭하여 다른 파일로 변경"':'')+' style="display:flex;align-items:center;gap:8px" onclick="V4musicUpload()"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+_upInner+'</span>'+((m.kind==='upload')?play(m.url):'')+'</div>';
    return rows;
  }
  /* 미리듣기 — 배포 화면의 음악 버튼처럼 재생/정지 토글 (한 번에 한 곡) */
  window.V4musicPreviewStop=function(){
    if(window._v4PvAudio){ try{window._v4PvAudio.pause();}catch(e){} try{rebuildMusicCard();}catch(e){} }
  };
  window.V4musicPreview=function(url){
    try{
      var a=window._v4PvAudio;
      if(a&&window._v4PvUrl===url&&!a.paused){ a.pause(); rebuildMusicCard(); return; }
      if(a){ try{a.pause();}catch(e){} }
      a=new Audio(url); window._v4PvAudio=a; window._v4PvUrl=url;
      a.onended=function(){ rebuildMusicCard(); };
      a.play().then(function(){ rebuildMusicCard(); }).catch(function(){ if(typeof toast==='function')toast('재생할 수 없어요 — 파일 주소를 확인해 주세요'); });
    }catch(e){}
  };
  function rebuildMusicCard(){ var el=document.getElementById('v4-musiccard'); if(el)el.innerHTML=musicCardHTML(); var chip=document.getElementById('v4-mchip'); if(chip)chip.textContent=musicChipLabel(); var cur=document.getElementById('v4-music-cur'); if(cur)cur.textContent=musicChipLabel(); }
  window.V4toggleMusic=function(){ V4.musicOpen=!V4.musicOpen; var sec=document.getElementById('v4-musicsec'); if(sec)sec.classList.toggle('open',V4.musicOpen); if(!V4.musicOpen)window.V4musicPreviewStop&&V4musicPreviewStop(); };
  window.addEventListener('hashchange',function(){ if(window.V4musicPreviewStop)V4musicPreviewStop(); });
  window.addEventListener('pagehide',function(){ if(window._v4PvAudio){ try{window._v4PvAudio.pause();}catch(e){} } });
  window.V4music=function(action,idx){
    var d=data(); if(!d)return; d.music=d.music||{enabled:false,kind:'preset',presetIdx:0,url:'',loop:true};
    if(action==='off'){ d.music.enabled=false; d.music.kind='none'; }
    else if(action==='preset'){ d.music.enabled=true; d.music.kind='preset'; d.music.presetIdx=idx; d.music.url=''; }
    d.music.loop=true; rebuildMusicCard(); scheduleSave();
  };
  window.V4musicUpload=function(){
    openFilePicker(false,function(files){
      var f=files[0]; if(!f)return;
      if(f.size>15*1024*1024){ alert('음악 파일은 15MB 이하만 업로드할 수 있어요.'); return; }
      if(typeof toast==='function') toast('음악 업로드 중…');
      var ext=(f.name.split('.').pop()||'mp3').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp3';
      v4EnsureSession().then(function(){ return v4UploadFile(f,ext,f.type||'audio/mpeg'); }).then(function(url){
        var d=data(); if(!d)return;
        d.music={enabled:true,kind:'upload',url:url,loop:true,name:(f.name||'')};
        rebuildMusicCard(); scheduleSave();
        if(typeof toast==='function') toast('배경음악이 등록되었습니다 ♪');
      }).catch(function(e){
        console.error('[music upload]',e);
        alert('음악 업로드에 실패했어요. 네트워크 확인 후 다시 시도해 주세요.');
      });
    /* accept: audio/* 만 주면 iOS 파일앱이 일부 MP3의 UTI를 오디오로 인식 못 해 회색(선택 불가)처리하는
       버그가 있음 → 확장자를 함께 명시하면 iOS가 확장자 기준으로 선택을 허용. (안드/데스크톱엔 무해) */
    },'audio/*,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/ogg,audio/flac,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.aif,.aiff');
  };
  window.V4openMusic=function(){ V4openDrawer(); V4.musicOpen=true; var sec=document.getElementById('v4-musicsec'); if(sec)sec.classList.add('open'); setTimeout(function(){ var el=document.getElementById('v4-musicsec'); if(el)el.scrollIntoView({behavior:'smooth',block:'center'}); },80); };

  /* ---- 선택 모델(양방향 연동) ---- */
  function markSelected(sec){
    var canvas=document.getElementById('v4-canvas'); if(!canvas)return;
    canvas.querySelectorAll('[data-pv-sec].v4-selected').forEach(function(e){ e.classList.remove('v4-selected'); });
    /* 가족 정보(couple)는 1px 스텁 — 혼주 줄이 들어 있는 인사말 카드를 하이라이트 */
    var target=(sec==='couple')?'invitation':sec;
    var el=canvas.querySelector('[data-pv-sec="'+target+'"]'); if(el) el.classList.add('v4-selected');
  }
  function clearSelected(){
    var canvas=document.getElementById('v4-canvas'); if(!canvas)return;
    canvas.querySelectorAll('[data-pv-sec].v4-selected').forEach(function(e){ e.classList.remove('v4-selected'); });
  }
  /* 프리뷰 드롭다운(rsvp·accounts)을 편집 중 섹션(openSec)과 동기화 — 편집 중인 것만 열고 나머지는 닫음 */
  function syncPreviewOpen(){
    var canvas=document.getElementById('v4-canvas'); if(!canvas)return;
    ['rsvp','accounts'].forEach(function(sid){ var s=canvas.querySelector('[data-pv-sec="'+sid+'"]'); var dt=s&&s.querySelector('details'); if(dt)dt.open=(V4.openSec===sid); });
  }
  function selectSection(sec){
    markSelected(sec);
    V4openDrawer();
    V4.openSec=sec; rebuildSecList();
    syncPreviewOpen();
    setTimeout(function(){ var c=document.querySelector('#v4-seclist .v4-sec[data-id="'+sec+'"]'); if(c) c.scrollIntoView({behavior:'smooth',block:'nearest'}); },70);
  }
  function highlightPreview(sec){
    var canvas=document.getElementById('v4-canvas'); if(!canvas)return;
    var el=canvas.querySelector('[data-pv-sec="'+((sec==='couple')?'invitation':sec)+'"]'); if(!el)return;
    markSelected(sec);
    /* 섹션 상단이 뷰포트 상단 근처(여백 28px)에 오도록 — center 방식은 긴 섹션에서 아래로 치우침 */
    var stage=document.querySelector('.v4-stage');
    if(stage){
      var top=el.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 28;
      stage.scrollTo({top:Math.max(0,top),behavior:'smooth'});
    } else {
      el.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }

  function decorate(root,d){
    if(!root||!d)return;
    var sc=schemaFor();
    sc.texts.forEach(function(f){
      var el=root.querySelectorAll(f.sel)[f.idx||0]; if(!el)return;
      el.setAttribute('contenteditable','true');
      el.classList.add('v4-edit-text');
      el.setAttribute('data-k',f.k);
      if(f.ph) el.setAttribute('data-ph',f.ph);
      el.addEventListener('input',function(){ onInlineInput(el); });
      /* 인라인 편집 중엔 텍스트 자체 파란 테두리만 — 섹션 아웃라인은 지워 이중 박스 방지 */
      el.addEventListener('focus',function(){ clearSelected(); });
      /* 입력 중엔 patch만(깜빡임 없음), 필드를 떠날 때 한 번 갱신해 의존 요소(지도 등) 동기화 */
      el.addEventListener('blur',function(){ if(f.k==='venueName'){ V4geoFill(el.innerText); } refreshCanvasDebounced(); });
      if(!f.multiline){
        el.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); el.blur(); } });
      }
    });
    sc.images.forEach(function(f){
      var el=root.querySelectorAll(f.sel)[f.idx||0];
      if(!el){ var iv=root.querySelector('.inv'); if(iv) el=iv.firstElementChild; } /* 표지 미지정 시 placeholder */
      if(!el)return;
      el.classList.add('v4-img-edit');
      el.removeAttribute('onclick'); /* 편집 모드에선 라이트박스 대신 교체 */
      el.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); pickImage(f.k); });
    });
    /* 섹션 타이틀 인라인 편집 (모든 텍스트=데이터) */
    root.querySelectorAll('[data-pv-sec]').forEach(function(secEl){
      var sec=secEl.getAttribute('data-pv-sec');
      var lbl=secEl.querySelector('.sect-label'); if(!lbl)return;
      lbl.setAttribute('contenteditable','true');
      lbl.classList.add('v4-edit-text');
      lbl.setAttribute('data-seclabel',sec);
      if(hasLabel(sec)) lbl.setAttribute('data-ph',labelDefault(sec));
      lbl.addEventListener('input',function(){ onLabelInput(lbl,sec); });
      lbl.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); lbl.blur(); } });
      lbl.addEventListener('focus',function(){ markSelected(sec); });
    });
    /* Empty State: 비어도 영역이 사라지지 않도록 placeholder 주입 (클릭=사이드바 편집)
       갤러리는 '＋ 사진 추가' 버튼이 담당(placeholder와 겹침 방지) */
    /* 안내사항은 이제 venue/date처럼 항상 카드 렌더 — placeholder 주입 불필요 */
    /* 빈 계좌: placeholder 대신 실제 파란 바 그대로 표시(입력 전에도 배포 모습과 동일) — 클릭=편집 */
    var acctEl=root.querySelector('[data-pv-sec="accounts"]');
    if(acctEl && acctEl.offsetHeight<=3){
      var d9=data();
      /* rsvp가 바로 위에 보이면 하객뷰(luceShare 15px)와 동일한 간격을 준다 — 안 그러면 파란 바 두 개가 붙음 */
      var _rsvpEl=root.querySelector('[data-pv-sec="rsvp"]');
      var _rsvpShown=_rsvpEl && _rsvpEl.offsetHeight>3;
      acctEl.style.height='auto'; acctEl.style.margin=(_rsvpShown?'15px':'0')+' 48px 0';
      var _albl=esc((d9&&typeof getSecLabel==='function'&&getSecLabel(d9,'accounts'))||'마음 전하실 곳');
      var _phrow=function(role){ return '<div class="luce-acc-row" style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:1px solid #eee">'
        +'<div style="text-align:left"><div style="font-size:11.5px;color:#b3b3b3">'+role+'</div><div style="font-size:13px;margin-top:3px;color:#b3b3b3">예금주 · OO은행</div><div style="font-size:14px;margin-top:2px;color:#b3b3b3">000-0000-0000</div></div>'
        +'<span style="flex:0 0 auto;border:1px solid #e0e0e0;background:#fff;border-radius:6px;padding:7px 13px;font-size:12px;color:#b3b3b3">복사</span></div>'; };
      /* 빈 계좌: 하객뷰와 동일한 드롭다운 구조 + placeholder 계좌 1행(입력하면 어떻게 보이는지 미리보기) */
      acctEl.innerHTML='<details class="luce-acct v4-acct-ph">'
        +'<summary style="list-style:none;display:flex;align-items:center;justify-content:space-between;background:#B9D9FF;padding:15px 20px;cursor:pointer;font-family:\'Pretendard\',sans-serif;font-size:13px;font-weight:500;color:#000">'+_albl+'<img src="/icon-acct.png" alt="" style="width:12px;height:auto"></summary>'
        +'<div style="background:#fff;padding:2px 20px 16px;font-family:\'Pretendard\',sans-serif">'+_phrow('신랑측')
        +'</div></details>';
      acctEl.querySelector('summary').addEventListener('click',function(e){ selectSection('accounts'); });
    }
    /* 편집 중인 섹션(rsvp·accounts)만 프리뷰 드롭다운 펼치고 나머지는 닫음 — 편집창과 동기화(초기 렌더·갱신 공통) */
    ['rsvp','accounts'].forEach(function(sid){ var _s=root.querySelector('[data-pv-sec="'+sid+'"]'); var _od=_s&&_s.querySelector('details'); if(_od)_od.open=(V4.openSec===sid); });
    /* 선택 모델: 섹션 클릭 → 선택. 인라인 텍스트는 그대로 편집, 그 외 영역은 사이드바 열기 */
    root.querySelectorAll('[data-pv-sec]').forEach(function(secEl){
      var sec=secEl.getAttribute('data-pv-sec');
      secEl.addEventListener('click',function(e){
        if(e.target.closest('[contenteditable="true"]')){ return; } /* 인라인 편집은 자체 테두리만 */
        if(e.target.closest('a,button,iframe,.acc-copy,.map-btn,.v4-click,.v4-inlinebtn')) return;
        if(sec==='share') return; /* 공유는 사이드바 편집 항목 없음 */
        /* summary 네이티브 토글이 syncPreviewOpen 뒤(기본동작)에 실행돼 다시 닫는 것 방지 — 펼침은 syncPreviewOpen이 담당 */
        if(e.target.closest('summary')){ e.preventDefault(); }
        selectSection(sec);
      });
    });
    wirePopovers(root);
  }

  /* ---- 이미지 최적화 업로드: 리사이즈(최대 1600px·JPEG .85) → Supabase Storage(URL 저장).
         실패/비로그인 시 dataURL 폴백 — 기존 dataURL 데이터도 그대로 렌더(하위호환). ---- */
  /* maxDim/quality 호출부 지정 — 표지는 1920/0.92(첫 화면), 갤러리 등 기본 1280/0.8(egress). */
  function v4Resize(file, maxDim, quality){
    maxDim = maxDim || 1280; quality = quality || 0.8;
    return new Promise(function(res){
      var img=new Image();
      img.onload=function(){
        var w=img.width, h=img.height;
        /* 이미 최적화된 작은 JPEG(≤100KB)이고 치수도 상한 이내면 재압축 스킵 — 화질 보존·CPU 절감(이중압축 방지) */
        if(file.type==='image/jpeg' && file.size && file.size<=100*1024 && w<=maxDim && h<=maxDim){
          URL.revokeObjectURL(img.src); res(file); return;
        }
        if(w>maxDim||h>maxDim){ var r=Math.min(maxDim/w,maxDim/h); w=Math.round(w*r); h=Math.round(h*r); }
        var c=document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        c.toBlob(function(b){ res(b||file); },'image/jpeg',quality);
        URL.revokeObjectURL(img.src);
      };
      img.onerror=function(){ res(file); };
      img.src=URL.createObjectURL(file);
    });
  }
  /* 업로드 전 세션 보장 — 오래 열어둔 탭의 만료 토큰을 갱신(getSession이 필요 시 refresh) */
  function v4EnsureSession(){
    try{
      if(window.SB&&SB.client&&SB.client.auth&&SB.client.auth.getSession){
        /* 세션 갱신 락에 걸려도 업로드가 멈추지 않게 2.5초만 기다림 */
        return Promise.race([
          SB.client.auth.getSession().then(function(){}).catch(function(){}),
          new Promise(function(r){ setTimeout(r,2500); })
        ]);
      }
    }catch(e){}
    return Promise.resolve();
  }
  function sbAccessToken(){
    try{
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i);
        if(k&&k.indexOf('sb-')===0&&k.indexOf('auth-token')>=0){
          var o=JSON.parse(localStorage.getItem(k)||'{}');
          return o.access_token||(o.currentSession&&o.currentSession.access_token)||null;
        }
      }
    }catch(e){}
    return null;
  }
  /* 범용 스토리지 업로드: supabase-js(8s 제한) → 토큰 직접 fetch → 실패 시 reject */
  function v4UploadFile(blob, ext, contentType){
    var path=(window.SB&&SB.user?SB.user.id:'anon')+'/'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.'+ext;
    /* 타임아웃을 파일 크기에 비례(≈15초/MB, 최소 client 8s·fetch 15s) — 음원(수 MB)을 모바일 회선으로
       올릴 때 고정 8/15초를 넘겨 정상 업로드가 중단되던 문제 방지. 이미지(<1MB)는 기존과 사실상 동일 */
    var _mb=(blob&&blob.size?blob.size:0)/1048576;
    var _clientTmo=Math.max(8000, Math.round(_mb*15000));
    var _fetchTmo =Math.max(15000, Math.round(_mb*15000));
    function viaClient(){
      if(!(window.SB&&SB.client&&SB.user&&SB.client.storage)) return Promise.reject(new Error('no client'));
      return Promise.race([
        SB.client.storage.from('invitation-images').upload(path,blob,{contentType:contentType,upsert:false,cacheControl:'31536000'}),
        new Promise(function(_,rej){ setTimeout(function(){rej(new Error('client timeout'));},_clientTmo); })
      ]).then(function(r){
        if(r&&r.error) throw r.error;
        var pub=SB.client.storage.from('invitation-images').getPublicUrl(path);
        var url=pub&&pub.data&&pub.data.publicUrl; if(!url) throw new Error('no url');
        return url;
      });
    }
    function viaFetch(){
      var cfg=(window.SB&&SB.cfg)?SB.cfg():null; var tok=sbAccessToken();
      if(!cfg||!cfg.url||!tok) return Promise.reject(new Error('no token'));
      var ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
      var to=ctrl?setTimeout(function(){ctrl.abort();},_fetchTmo):null;
      return fetch(cfg.url+'/storage/v1/object/invitation-images/'+path,{
        method:'POST',
        headers:{'apikey':cfg.key,'Authorization':'Bearer '+tok,'Content-Type':contentType,'cache-control':'max-age=31536000'},
        body:blob, signal:ctrl?ctrl.signal:undefined
      }).then(function(r){
        if(to)clearTimeout(to);
        if(!r.ok) throw new Error('upload '+r.status);
        return cfg.url+'/storage/v1/object/public/invitation-images/'+path;
      });
    }
    return viaClient().catch(function(e){ console.warn('[upload] client 실패 → 직접 fetch',e&&e.message); return viaFetch(); });
  }
  function v4UploadImage(file, maxDim, quality){
    return v4EnsureSession().then(function(){ return v4Resize(file, maxDim, quality); }).then(function(blob){
      return v4UploadFile(blob,'jpg','image/jpeg');
    }).catch(function(e){
      console.warn('[upload] 스토리지 실패 — dataURL 폴백', e&&e.message);
      return v4Resize(file, maxDim, quality).then(function(blob){
        return new Promise(function(res){ var r=new FileReader(); r.onload=function(ev){res(ev.target.result);}; r.readAsDataURL(blob); });
      });
    });
  }

    var _filePick;
  function openFilePicker(multiple,cb,accept){
    if(_filePick){ try{_filePick.remove();}catch(e){} }
    _filePick=document.createElement('input');
    _filePick.type='file'; _filePick.accept=accept||'image/*'; if(multiple)_filePick.multiple=true;
    _filePick.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(_filePick);
    _filePick.onchange=function(){
      var files=[].slice.call(_filePick.files||[]);
      try{ cb(files); }finally{ try{_filePick.remove();}catch(e){} _filePick=null; }
    };
    _filePick.click();
  }
  function pickImage(k){
    openFilePicker(false,function(files){
      var file=files[0]; if(!file)return;
      setBadge('saving');
      /* 대표/서브 표지는 첫 화면의 얼굴 → 고해상도 전용(1920/0.92). 그 외(갤러리 등)는 기본 1280/0.8 유지 */
      var isCover=(k==='cover'||k==='subCoverImage');
      var mx=isCover?1920:1280, q=isCover?0.92:0.8;
      v4UploadImage(file, mx, q).then(function(url){ var d=data(); if(!d)return; d[k]=url; refreshCanvas(); if(k==='cover'||k==='subCoverImage')rebuildCoverCard(); scheduleSave(); });
    });
  }

  /* ---------------- 사이드바 ---------------- */
  /* 텍스트 키는 프리뷰의 해당 요소만 patch → 전체 리렌더/깜빡임 없음 */
  function v4PatchText(k,v){
    var c=document.getElementById('v4-canvas'); if(!c)return false;
    var sc=schemaFor();
    for(var i=0;i<sc.texts.length;i++){ if(sc.texts[i].k===k){ var el=c.querySelectorAll(sc.texts[i].sel)[sc.texts[i].idx||0]; if(!el)return false; if(el.innerText!==v)el.innerText=v; return true; } }
    return false;
  }
  var _v4GeoT;
  window.V4set=function(k,v){ var d=data(); if(!d)return; d[k]=v;
    if(k==='venueName'){ d.mapQuery=v; clearTimeout(_v4GeoT); _v4GeoT=setTimeout(function(){ V4geoFill(v); },700); } /* 식장 이름 ↔ 지도·주소 자동연동(사이드바 입력 포함) */
    if(k==='date'&&v){ /* 공개 종료 = 예식일+3개월 자동 — 공개 후 예식일을 바꿔도(연기 등) 종료일이 따라간다 */
      try{ var _w=parseDate(v); _w.setHours(0,0,0,0); d.publishEnd=new Date(_w.getTime()+90*24*60*60*1000).toLocaleDateString('sv'); }catch(e){}
    }
    var f=document.getElementById('v4f-'+k); if(f&&f.value!==v)f.value=v;
    var patched=v4PatchText(k,v);
    if(!patched || k==='venueName') refreshCanvasDebounced();
    scheduleSave(); };

  /* 식장 이름 → 지도·주소 자동연동 (blur/입력 debounce). 네이버 지역검색 프록시(/api/geo-search)
     우선, 실패 시 Nominatim 폴백. 주소는 이후에도 직접 수정 가능(이름 재변경 시 재연동). */
  var _v4GeoSeq=0;
  function v4ApplyAddr(seq,addr){
    if(seq!==_v4GeoSeq||!addr)return false;
    var cur=data(); if(!cur)return false;
    cur.venueAddr=addr;
    var f=document.getElementById('v4f-venueAddr'); if(f)f.value=addr;
    refreshCanvasDebounced(); scheduleSave();
    return true;
  }
  function V4geoFill(name){
    name=(name||'').trim(); if(!name)return;
    var d=data(); if(!d)return;
    d.mapQuery=name;
    var seq=++_v4GeoSeq;
    function naverLookup(q){
      return fetch('/api/geo-search?q='+encodeURIComponent(q)).then(function(r){ return r.json(); })
        .then(function(js){ var it=js&&js.ok&&js.items&&js.items[0]; return it||null; });
    }
    naverLookup(name)
      .then(function(it){
        if(it&&(it.roadAddress||it.address))return it;
        return naverLookup('더'+name); /* '채플앳논현' 같은 축약형 → '더채플앳논현' 재시도 */
      })
      .then(function(it){
        if(seq!==_v4GeoSeq)return;
        if(it&&(it.roadAddress||it.address)){
          v4ApplyAddr(seq,it.roadAddress||it.address);
          /* 전화번호 자동 입력(수동 전환 전까지) */
          var cur=data();
          if(cur&&it.telephone){ cur.venuePhone=it.telephone; var pf=document.getElementById('v4f-venuePhone'); if(pf)pf.value=it.telephone; }
          return;
        }
        throw new Error('no result');
      })
      .catch(function(){
        /* 폴백: OSM (해외 등) */
        try{
          fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ko&q='+encodeURIComponent(name))
            .then(function(r){ return r.ok?r.json():null; })
            .then(function(js){
              if(seq!==_v4GeoSeq||!js||!js[0]||!js[0].display_name)return;
              var parts=js[0].display_name.split(',').map(function(s){return s.trim();});
              v4ApplyAddr(seq,parts.slice(0,4).reverse().join(' '));
            }).catch(function(){});
        }catch(e){}
      });
  }

  /* ---- 인라인 팝오버(프리뷰에서 바로: 가족·날짜·지도) ---- */
  window.V4closePop=function(){ var p=document.getElementById('v4-pop'); if(p)p.remove(); var s=document.getElementById('v4-popscrim'); if(s)s.remove(); };
  function popField(f){
    var d=data(); var v=(d&&d[f.k]!=null)?d[f.k]:'';
    if(f.t==='chk'){
      return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#555555;margin-top:8px;cursor:pointer"><input type="checkbox" '+(v?'checked':'')+' onchange="V4set(\''+f.k+'\',this.checked)" style="width:16px;height:16px;accent-color:#3182f6">'+esc(f.l)+'</label>';
    }
    var input=(f.t==='date'||f.t==='time')?'<input type="'+f.t+'" value="'+esc(v)+'" oninput="V4set(\''+f.k+'\',this.value)">'
      :'<input value="'+esc(v)+'" placeholder="'+esc(f.ph||'')+'" oninput="V4set(\''+f.k+'\',this.value)">';
    return '<div class="v4-fld"><label>'+esc(f.l)+'</label>'+input+'</div>';
  }
  function openPopoverCore(anchor,title,bodyHTML){
    window.V4closePop();
    var scrim=document.createElement('div'); scrim.id='v4-popscrim'; scrim.className='v4-popscrim'; scrim.onclick=window.V4closePop;
    var pop=document.createElement('div'); pop.id='v4-pop'; pop.className='v4-pop';
    pop.innerHTML='<div class="v4-pop-head"><b>'+esc(title)+'</b><button type="button" class="v4-x" onclick="V4closePop()">✕</button></div><div class="v4-pop-body">'+bodyHTML+'</div>';
    document.body.appendChild(scrim); document.body.appendChild(pop);
    var r=anchor.getBoundingClientRect();
    var pw=Math.min(320, window.innerWidth-24); pop.style.width=pw+'px';
    var left=Math.min(Math.max(12,r.left), window.innerWidth-12-pw);
    var top=r.bottom+8, ph=pop.offsetHeight;
    if(top+ph>window.innerHeight-12) top=Math.max(12, r.top-ph-8);
    pop.style.left=left+'px'; pop.style.top=top+'px';
  }
  function openPopover(anchor,title,fields){ openPopoverCore(anchor,title,fields.map(popField).join('')); }
  function openAcctPopover(anchor,slot){
    var d=data(); var v=(d&&d.accounts&&d.accounts[slot])||{};
    var o=(d&&Array.isArray(d.acctOrder))?d.acctOrder.find(function(x){return x.key===slot;}):null;
    var rel='<div class="v4-fld"><label>관계</label><input value="'+esc((o&&o.label)||'')+'" placeholder="예: 신랑, 신랑 아버지, 신부 어머니" oninput="V4accLabel(\''+slot+'\',this.value)" onchange="V4accFlush()"></div>';
    var f=function(field,label,val,ph){ return '<div class="v4-fld"><label>'+esc(label)+'</label><input value="'+esc(val||'')+'" placeholder="'+esc(ph||'')+'" oninput="V4acc(\''+slot+'\',\''+field+'\',this.value)" onchange="V4accFlush()"></div>'; };
    openPopoverCore(anchor,'계좌 수정', rel+f('holder','성함',v.holder,'홍길동')+f('bank','은행',v.bank,'국민은행')+f('number','계좌번호',v.number,'123-456-789'));
  }
  function wirePopovers(root){
    /* 헤더 이름(영문 조합 문자열) → 팝오버로 신랑/신부 한글·영문 편집 */
    var headerName=null;
    root.querySelectorAll('.names-en').forEach(function(el){ if(!headerName && !el.closest('[data-pv-sec]')) headerName=el; });
    if(headerName){
      headerName.classList.add('v4-click');
      headerName.addEventListener('click',function(e){ e.stopPropagation(); openPopover(headerName,'신랑 · 신부',[{k:'groomKo',l:'신랑 (한글)'},{k:'brideKo',l:'신부 (한글)'},{k:'groomEn',l:'신랑 (영문)'},{k:'brideEn',l:'신부 (영문)'}]); });
    }
    var whenSec=root.querySelector('[data-pv-sec="when"]');
    if(whenSec){ whenSec.querySelectorAll('.info-line').forEach(function(il){ il.classList.add('v4-click'); il.addEventListener('click',function(e){ e.stopPropagation(); openPopover(il,'예식 일시',[{k:'date',t:'date',l:'예식 날짜'},{k:'time',t:'time',l:'예식 시간'}]); }); }); }
    /* #4: 별도 '지도 변경' 버튼 제거. 예식장 이름 인라인 편집 → 지도 자동 갱신(blur 시). 상세는 사이드바. */
    /* v4.4: 대표 사진(폴라로이드) 클릭 → Crop 모달 */
    root.querySelectorAll('.luce-pola').forEach(function(pl){
      pl.style.cursor='pointer';
      pl.addEventListener('click',function(e){ e.stopPropagation(); window.V4openCrop(parseInt(pl.getAttribute('data-feat-i'),10)||0); });
    });
    /* 메인 표지: 호버 '사진 변경' + 크롭 모달(확대·이동·교체) */
    var coverwrap=root.querySelector('.luce-coverwrap');
    if(coverwrap){
      coverwrap.classList.add('v4-img-edit');
      coverwrap.style.cursor='pointer';
      coverwrap.addEventListener('click',function(e){ e.stopPropagation(); window.V4openCrop('cover'); });
    }
    /* 서브 표지: 호버 '사진 변경' + 크롭 모달(메인 표지와 동일 UX) */
    var subwin=root.querySelector('.luce-subwin');
    if(subwin){
      subwin.classList.add('v4-img-edit');
      subwin.style.cursor='pointer';
      subwin.addEventListener('click',function(e){ e.stopPropagation(); window.V4openCrop('sub'); });
    }
    /* #6: 계좌 행 클릭 → 바로 수정 팝오버(토글 없이) */
    root.querySelectorAll('.luce-acc-row[data-acct-slot]').forEach(function(row){
      var slot=row.getAttribute('data-acct-slot');
      row.classList.add('v4-click');
      row.addEventListener('click',function(e){ if(e.target.closest('button'))return; e.stopPropagation(); openAcctPopover(row,slot); });
    });
    /* v4.4: 갤러리 — 실제 그리드에 점선 '추가' 셀을 이어붙여 추가 위치를 그대로 보여줌 */
    var gallerySec=root.querySelector('[data-pv-sec="gallery"]');
    if(gallerySec){
      var gcount=((data()||{}).gallery||[]).filter(Boolean).length;
      var grid=gallerySec.querySelector('.luce-ggrid');
      if(!grid){
        /* 빈 갤러리: 접힘선 없이 그리드만 주입 — 음수 마진 접힘선이 섹션 아웃라인을 뚫고 나가 겹쳐 보이던 문제 */
        grid=document.createElement('div'); grid.className='luce-ggrid'; grid.style.marginTop='44px';
        gallerySec.appendChild(grid);
      }
      /* 그리드에 빈 자리가 있으면 점선 셀, 6장 차서 꽉 찼으면(2x3 유지) 그리드 아래 슬림 바 */
      if(gcount>=6){
        var bar=document.createElement('div');
        bar.className='v4-gal-addbar';
        bar.innerHTML='<span>＋</span><em>사진 추가</em>';
        bar.addEventListener('click',function(e){ e.stopPropagation(); if(typeof V4galAdd==='function') V4galAdd(); });
        grid.insertAdjacentElement('afterend',bar);
      } else {
        var cell=document.createElement('div');
        cell.className='v4-gal-addcell';
        cell.innerHTML='<span>＋</span><em>사진 추가</em>';
        cell.addEventListener('click',function(e){ e.stopPropagation(); if(typeof V4galAdd==='function') V4galAdd(); });
        grid.appendChild(cell);
      }
    }
  }
  window.V4acc=function(slot,field,v){ var d=data(); if(!d)return; d.accounts=d.accounts||{}; d.accounts[slot]=d.accounts[slot]||{}; d.accounts[slot][field]=v; scheduleSave(); _acT&&clearTimeout(_acT); _acT=setTimeout(patchAcctPreview,250); };
  var _acT;
  /* 계좌 섹션만 부분 갱신 — 전체 캔버스 재렌더(깜빡임·드롭다운 닫힘) 방지 */
  function patchAcctPreview(){
    var c=document.getElementById('v4-canvas'); var d=data(); if(!c||!d)return;
    var sec=c.querySelector('[data-pv-sec="accounts"]');
    var det=sec?sec.querySelector('details'):null;
    var rows=(typeof luceAcctRows==='function')?luceAcctRows({},d):'';
    if(!det||!rows){ refreshCanvas(); return; } /* 빈↔채움 구조 전환은 전체 렌더 */
    var wasOpen=det.open;
    var body=det.querySelector(':scope > div');
    if(!body){ refreshCanvas(); return; }
    body.innerHTML=rows;
    det.open=wasOpen;
    body.querySelectorAll('.luce-acc-row[data-acct-slot]').forEach(function(row){
      row.classList.add('v4-click');
      row.addEventListener('click',function(e){ if(e.target.closest('button'))return; e.stopPropagation(); openAcctPopover(row,row.getAttribute('data-acct-slot')); });
    });
    try{ document.querySelectorAll('.luce-acct').forEach(function(dt){ dt.open=true; }); }catch(e){}
  }
  window.V4accFlush=function(){ patchAcctPreview(); };

  function fieldHTML(f){
    var d=data();
    if(f.toggle){
      var _on=(d&&d[f.toggle]!==false); /* 기본 켜짐 */
      return '<div class="v4-fld"><label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;color:#262626;cursor:pointer">'+esc(f.l)
        +'<input type="checkbox" '+(_on?'checked':'')+' onchange="V4set(\''+f.toggle+'\',this.checked)" style="width:18px;height:18px;accent-color:#3182f6;margin:0"></label></div>';
    }
    var v=(d&&d[f.k]!=null)?d[f.k]:'';
    var input = (f.t==='ta')
      ? '<textarea id="v4f-'+f.k+'" rows="4" placeholder="'+esc(f.ph||'')+'" oninput="V4set(\''+f.k+'\',this.value)">'+esc(v)+'</textarea>'
      : '<input id="v4f-'+f.k+'" type="'+(f.t||'text')+'" value="'+esc(v)+'" placeholder="'+esc(f.ph||'')+'" oninput="V4set(\''+f.k+'\',this.value)">';
    if(f.chk){
      /* 필름 질감 토글과 같은 레이아웃 — 입력창 아래 한 줄 (라벨 좌 · 체크박스 우) */
      var cv=!!(d&&d[f.chk]);
      input+='<label style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:13px;font-weight:600;color:#262626;cursor:pointer">고인(故人) 표기'
        +'<input type="checkbox" '+(cv?'checked':'')+' onchange="V4set(\''+f.chk+'\',this.checked)" style="width:18px;height:18px;accent-color:#3182f6;margin:0">'
      +'</label>';
    }
    if(f.addrSearch){
      input+='<button type="button" class="v4-btn" style="margin-top:6px;padding:8px 12px;font-size:12.5px" onclick="V4addrSearch(\''+f.k+'\')">주소 찾기</button>';
    }
    return '<div class="v4-fld"><label>'+esc(f.l)+'</label>'+input+'</div>';
  }

  /* 다음(카카오) 우편번호 서비스 — 키 불필요·무료 */
  window.V4addrSearch=function(k){
    function open(){
      new daum.Postcode({
        oncomplete:function(r){
          var addr=r.roadAddress||r.jibunAddress||'';
          if(r.buildingName) addr+=' ('+r.buildingName+')';
          var d=data(); if(!d)return;
          d[k]=addr;
          var el=document.getElementById('v4f-'+k); if(el)el.value=addr;
          refreshCanvasDebounced(); scheduleSave();
        }
      }).open();
    }
    if(typeof daum!=='undefined'&&daum.Postcode){ open(); return; }
    var sc=document.createElement('script');
    sc.src='https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    sc.onload=open; sc.onerror=function(){ alert('주소 검색 모듈을 불러오지 못했어요.'); };
    document.head.appendChild(sc);
  };

  function galleryEditor(){
    var d=data(); var g=d.gallery||[];
    var feats=(typeof getFeaturedGallery==='function')?getFeaturedGallery(d):[];
    var featHtml='<div class="v4-note" style="font-weight:700;color:#555;margin-top:2px">대표 사진 (폴라로이드)</div>'
      +'<div style="display:flex;gap:8px;margin-top:8px">'+feats.map(function(it,i){
        return '<div class="v4-cthumb" style="flex:1;aspect-ratio:254/159" onclick="V4openCrop('+i+')"><img src="'+esc(it.src)+'" alt=""><div class="v4-cthumb-edit">편집</div></div>';
      }).join('')+'</div>'
      +'<div class="v4-note" style="font-weight:700;color:#555;margin-top:14px">일반 갤러리</div>'
      +'<div class="v4-note" style="margin-top:4px">사진을 잡고 <b style="color:#000">드래그</b>해 순서를 바꿀 수 있어요 (최대 20장)</div>'
      +'<label style="display:flex;align-items:center;gap:7px;margin-top:7px;font-size:12px;color:#9e9e9e;line-height:1.5;cursor:pointer;user-select:none"><input type="checkbox" '+(d.galleryNoZoom?'checked':'')+' onchange="V4toggleGalZoom(this.checked)" style="width:15px;height:15px;flex:0 0 auto;accent-color:#3182f6"><span>사진 확대 방지</span></label>';
    var thumbs=g.map(function(src,i){ return '<div class="v4-gthumb" data-sort-item data-gi="'+i+'"><img src="'+esc(src)+'" alt="" draggable="false"><button type="button" onclick="V4galRemove('+i+')" aria-label="삭제">✕</button></div>'; }).join('');
    return featHtml+'<div class="v4-gwrap" data-sortable="gallery">'+thumbs+'<button type="button" class="v4-gadd" onclick="V4galAdd()">＋</button></div>';
  }
  window.V4toggleGalZoom=function(on){ var d=data(); if(!d)return; d.galleryNoZoom=!!on; if(window.refreshCanvas)refreshCanvas(); scheduleSave(); };
  /* ── 공용 Sortable 드래그 UX (pointer 기반 · 마우스+터치 통일 · 손가락 따라오는 고스트 프리뷰) ──
     '재정렬 동작'은 그대로: onReorder(from,to) 안에서 splice + 저장. 여기선 UX(고스트+placeholder)만 추가한다.
     재사용: 컨테이너에 data-sortable="<name>", 항목마다 data-sort-item.
             cezSortable.register(name,{ onReorder(from,to), ignore:'셀렉터'(예 삭제버튼), handle:'셀렉터'(예 ☰ 잡을때만) }). */
  window.cezSortable = window.cezSortable || (function(){
    var reg={}, S=null, bound=false;
    /* 직속 항목만 — 중첩된 다른 sortable(예: 섹션 안에 펼쳐진 갤러리 썸네일/계좌 항목)의
       data-sort-item 은 제외한다. 안 그러면 섹션 인덱스가 밀려 from/to 가 d.sections 범위를 벗어나
       splice 가 undefined 를 반환 → 드래그가 아무 동작 안 함(발행/펼침 상태에서 재현). */
    function items(c){ return Array.prototype.slice.call(c.querySelectorAll('[data-sort-item]')).filter(function(el){ return el.closest('[data-sortable]')===c; }); }
    function idx(c,el){ return items(c).indexOf(el); }
    /* 삽입 위치 계산 — 대상 항목의 '중점' 기준 앞/뒤 판정. 결과는 0..N (N+1개 위치, 마지막 뒤 포함). */
    function computeInsert(c,x,y,axis){
      var its=items(c);
      for(var i=0;i<its.length;i++){ var r=its[i].getBoundingClientRect();
        if(axis==='y'){ if(y < r.top + r.height/2) return i; }
        else if(axis==='x'){ if(x < r.left + r.width/2) return i; }
        else { /* grid(줄바꿈) — 읽기 순서: 윗줄이거나, 같은 줄에서 중점 왼쪽 */
          if(y < r.top) return i;
          if(y <= r.bottom && x < r.left + r.width/2) return i; }
      }
      return its.length;                 /* 어떤 항목 중점 앞에도 안 걸리면 = 맨 뒤 */
    }
    function clearMarks(c){ try{ Array.prototype.forEach.call(c.querySelectorAll('.cez-ins-before,.cez-ins-after'),function(el){el.classList.remove('cez-ins-before');el.classList.remove('cez-ins-after');}); }catch(_){} }
    function markInsert(c,ins){ var its=items(c); if(ins<its.length){ its[ins].classList.add('cez-ins-before'); } else if(its.length){ its[its.length-1].classList.add('cez-ins-after'); } }
    /* 드래그 중 자동 스크롤 — 목록이 길 때 스크롤 컨테이너 가장자리에 오면 계속 스크롤(맨 밑/맨 위 도달 가능) */
    var _asRAF=null, _asDir=0;
    function scrollParent(el){ var n=el&&el.parentElement; while(n){ try{ var s=getComputedStyle(n); if(/(auto|scroll)/.test((s.overflowY||'')+(s.overflow||'')) && n.scrollHeight>n.clientHeight+2) return n; }catch(_){} n=n.parentElement; } return document.scrollingElement||document.documentElement; }
    function _asTick(){ if(!S||!_asDir){ _asRAF=null; return; } var sc=S.scrollEl; if(sc){ var b=sc.scrollTop; sc.scrollTop=b+_asDir*12; if(sc.scrollTop!==b && S.lastY!=null){ ghostMove(S.lastX,S.lastY); clearMarks(S.container); markInsert(S.container, computeInsert(S.container,S.lastX,S.lastY,S.cfg.axis||'grid')); } } _asRAF=requestAnimationFrame(_asTick); }
    function autoScroll(x,y){ if(!S)return; S.lastX=x; S.lastY=y; if(S.scrollEl===undefined) S.scrollEl=scrollParent(S.container); var sc=S.scrollEl; if(!sc){ _asDir=0; return; } var isDoc=(sc===document.scrollingElement||sc===document.documentElement); var r=isDoc?{top:0,bottom:(window.innerHeight||0)}:sc.getBoundingClientRect(); var EDGE=56, max=sc.scrollHeight-sc.clientHeight; if(y<r.top+EDGE && sc.scrollTop>0) _asDir=-1; else if(y>r.bottom-EDGE && sc.scrollTop<max) _asDir=1; else _asDir=0; if(_asDir){ sc.scrollTop += _asDir*9; } if(_asDir && !_asRAF) _asRAF=requestAnimationFrame(_asTick); }
    function stopAutoScroll(){ _asDir=0; if(_asRAF){ try{cancelAnimationFrame(_asRAF);}catch(_){} _asRAF=null; } }
    function ghostMake(el,x,y){
      var r=el.getBoundingClientRect(), g=el.cloneNode(true);
      g.className=el.className+' cez-ghost'; g.removeAttribute('data-sort-item');
      g.style.cssText='position:fixed;left:0;top:0;margin:0;width:'+r.width+'px;height:'+r.height+'px;z-index:99998;'
        +'pointer-events:none;box-shadow:0 14px 30px rgba(0,0,0,.28);opacity:.6;will-change:transform;'
        +'border-radius:'+getComputedStyle(el).borderRadius+';overflow:hidden';
      document.body.appendChild(g);
      return { el:g, dx:x-r.left, dy:y-r.top };
    }
    function ghostMove(x,y){ if(!S||!S.ghost)return; var off=(S.ptype==='touch')?26:0; S.ghost.el.style.transform='translate('+(x-S.ghost.dx)+'px,'+(y-S.ghost.dy-off)+'px) scale(1.03) rotate(1.5deg)'; }
    function engage(){ _tr('T'+_curTid+' ENGAGE'); S.engaged=true; var ge=(S.cfg.ghostSelector&&S.item.querySelector(S.cfg.ghostSelector))||S.item; S.ghost=ghostMake(ge,S.startX,S.startY); S.item.classList.add('cez-src'); S.container.classList.add('cez-sorting'); document.documentElement.classList.add('cez-nosel'); }
    function cleanup(){ if(!S)return; stopAutoScroll(); if(S.ghost&&S.ghost.el&&S.ghost.el.parentNode)S.ghost.el.parentNode.removeChild(S.ghost.el); if(S.item)S.item.classList.remove('cez-src'); if(S.container){clearMarks(S.container);S.container.classList.remove('cez-sorting');} if(S.killed)S.killed.forEach(function(el){el.setAttribute('draggable','true');}); document.documentElement.classList.remove('cez-nosel'); S=null; }
    function down(e){
      if(S)return;
      var item=(e.target&&e.target.closest)?e.target.closest('[data-sort-item]'):null; if(!item)return;
      var c=item.closest('[data-sortable]'); if(!c)return;
      var cfg=reg[c.getAttribute('data-sortable')]; if(!cfg)return;
      if(cfg.ignore&&e.target.closest(cfg.ignore))return;      /* 삭제버튼 등에서 시작 안 함 */
      if(cfg.handle&&!e.target.closest(cfg.handle))return;     /* handle 지정 시 그 부분 잡을 때만 */
      S={ cfg:cfg, container:c, item:item, from:idx(c,item), startX:e.clientX, startY:e.clientY, pid:e.pointerId, ptype:e.pointerType, engaged:false, ghost:null, killed:[] };
      _curTid=++_tid; _tr('T'+_curTid+' DOWN '+c.getAttribute('data-sortable')+' from='+S.from+' pid='+e.pointerId+' ptype='+e.pointerType);
      /* 조상의 native HTML5 draggable(예: 섹션 카드)을 잡는 동안 임시 해제 — 항목 대신 섹션이 끌리는 것 방지 */
      var an=item.parentElement; while(an){ if(an.getAttribute&&an.getAttribute('draggable')==='true'){ an.setAttribute('draggable','false'); S.killed.push(an); } an=an.parentElement; }
      try{ item.setPointerCapture(e.pointerId); }catch(_){}
    }
    function move(e){
      if(!S||e.pointerId!==S.pid)return;
      if(!S.engaged){ if(Math.abs(e.clientX-S.startX)<6&&Math.abs(e.clientY-S.startY)<6)return; engage(); } /* 6px 넘어야 드래그(탭 보존) */
      e.preventDefault(); ghostMove(e.clientX,e.clientY);
      autoScroll(e.clientX,e.clientY);
      clearMarks(S.container); markInsert(S.container, computeInsert(S.container,e.clientX,e.clientY,S.cfg.axis||'grid'));
    }
    function up(e){
      _tr('T'+_curTid+' UP('+e.type+') S?'+!!S+' pidMatch?'+!!(S&&e.pointerId===S.pid)+' engaged?'+!!(S&&S.engaged));
      if(e.type==='pointerup') _lastUpAt=Date.now();
      if(!S||e.pointerId!==S.pid)return;
      var job=null;
      if(S.engaged){ var ins=computeInsert(S.container,e.clientX,e.clientY,S.cfg.axis||'grid'); var from=S.from;
        /* ins===from(자기 앞)·from+1(자기 뒤)=제자리 무동작. 앞으로 이동은 제거로 한 칸 당겨짐 보정(-1) */
        if(ins!==from && ins!==from+1){ var to=(ins>from)?ins-1:ins; var cb=S.cfg.onReorder; job=function(){ cb(from,to); }; }
        _tr('T'+_curTid+' UP-compute ins='+ins+' from='+from+' willReorder='+!!job); }
      cleanup();                 /* 고스트·placeholder 먼저 정리 후 재정렬(재렌더) */
      if(job){ try{ job(); }catch(err){ _tr('T'+_curTid+' REORDER-THREW '+(err && (err.stack||err.message||err))); } }
    }
    function bind(){ if(bound)return; bound=true;
      document.addEventListener('pointerdown',down,{passive:true});
      document.addEventListener('pointermove',move,{passive:false});
      document.addEventListener('pointerup',up,{passive:true});
      document.addEventListener('pointercancel',up,{passive:true});
    }
    return { register:function(n,cfg){ reg[n]=cfg; bind(); } };
  })();
  /* 갤러리 재정렬 등록 — 기존 splice 로직 그대로(동작 불변), UX만 공용 헬퍼로 */
  cezSortable.register('gallery', { axis:'grid', ignore:'button', onReorder:function(from,to){ var d=data(); if(!d||!d.gallery)return; var it=d.gallery.splice(from,1)[0]; if(it) d.gallery.splice(to,0,it); refreshCanvas(); rebuildSecList(); scheduleSave(); } });
  window.V4galDownload=function(){
    var d=data(); var list=((d&&d.gallery)||[]).filter(Boolean).slice();
    (d&&Array.isArray(d.featuredGallery)?d.featuredGallery:[]).forEach(function(f){ if(f&&f.src&&list.indexOf(f.src)<0) list.unshift(f.src); });
    if(!list.length){ alert('저장할 사진이 없어요.'); return; }
    function run(){
      if(typeof JSZip==='undefined'){ alert('압축 모듈을 불러오지 못했어요.'); return; }
      if(typeof toast==='function') toast('사진을 모으는 중… ('+list.length+'장)');
      var zip=new JSZip(); var n=0;
      Promise.all(list.map(function(src,i){
        if(String(src).indexOf('data:')===0){
          var b64=src.split(',')[1]||''; zip.file('photo-'+(i+1)+'.jpg',b64,{base64:true}); n++; return Promise.resolve();
        }
        return fetch(src).then(function(r){ return r.blob(); }).then(function(bl){ zip.file('photo-'+(i+1)+'.jpg',bl); n++; }).catch(function(){});
      })).then(function(){
        if(!n){ alert('사진을 내려받지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
        zip.generateAsync({type:'blob'}).then(function(blob){
          var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
          a.download='cez-photos-'+((inv()&&inv().slug)||'gallery')+'.zip';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function(){ URL.revokeObjectURL(a.href); },4000);
          if(typeof toast==='function') toast(n+'장을 zip으로 저장했어요');
        });
      });
    }
    if(typeof JSZip==='undefined'){
      var sc=document.createElement('script'); sc.src='/vendor-jszip.js'; sc.onload=run;
      sc.onerror=function(){ alert('압축 모듈 로드 실패'); }; document.head.appendChild(sc);
    } else run();
  };
  window.V4galAdd=function(){
    var d=data(); if(!d)return; d.gallery=d.gallery||[];
    if(d.gallery.length>=20){ alert('갤러리는 최대 20장까지 등록할 수 있어요.'); return; }
    openFilePicker(true,function(files){
      if(!files.length)return;
      var room=20-d.gallery.length; files=files.slice(0,room); var n=files.length;
      setBadge('saving');
      /* 클릭한 순서대로 배치 — 업로드 완료 순서가 아니라 선택 순서 기준 */
      var results=new Array(n); var done=0;
      var finish=function(){ if(++done===n){ results.forEach(function(u){ if(u)d.gallery.push(u); }); refreshCanvas(); rebuildSecList(); scheduleSave(); } };
      files.forEach(function(file,i){
        /* 갤러리도 고해상도 저장(2048/q0.9) — 어두운/얼굴 작은 사진의 업로드 JPEG 손상 완화. 저장용량만↑, 서빙폭은 그대로라 egress 영향 최소 */
        v4UploadImage(file, 2048, 0.9).then(function(url){ results[i]=url; finish(); }).catch(function(){ results[i]=null; finish(); });
      });
    });
  };
  /* ---- 공개 설정(발행·공개기간·slug) — 기존 로직 재사용 ---- */
  function publishCardHTML(){
    var u=inv(); var d=data(); if(!u||!d)return '';
    var canPub=!!(window.SB&&SB.canPublish&&SB.canPublish());
    var isPub=!!u.published;
    var admin=isAdminPreview();
    /* #11: 최초 공개 후 일반 사용자는 slug 변경·공개 취소 불가 (관리자 예외) */
    var locked=!!u.slugLocked && isPub && !admin;
    var arch=(typeof cezArchState==='function')?cezArchState(d,isPub):{state:isPub?'PUBLISHED':'DRAFT'};

    try{ if(u.slug&&u._slugAtLoad==null) u._slugAtLoad=u.slug; }catch(e){}
    /* 주소: 도메인/i/ 접두사(비활성) + 슬러그만 수정 — 한 칸으로 통합 */
    var addr='<div class="v4-fld" style="margin-top:14px"><label>모바일 청첩장 주소</label>'
      +'<div style="font-size:12px;color:#9e9e9e;font-weight:500;margin:-2px 0 8px;line-height:1.55">'+(locked?'공개 후에는 주소를 변경할 수 없어요.':'결제 후에는 주소를 변경할 수 없어요. 오타가 없는지 확인해주세요')+'</div>'
      +'<div style="padding:12px;background:#f5f5f5"><div style="display:flex;gap:6px">'
        +'<div style="flex:1;min-width:0;display:flex;align-items:center;background:#fff;border:1px solid #e0e0e0;overflow:hidden">'
          +'<span style="flex:0 1 auto;min-width:30px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#9e9e9e;padding-left:11px" title="'+esc(location.origin)+'/i/">'+esc(location.origin.replace(/^https?:\/\//,''))+'/i/</span>'
          +'<input id="v4-slug-input" style="flex:1 1 60px;min-width:60px;background:transparent!important;border:0!important;outline:none!important;caret-color:#262626!important;color:#262626;padding:10px 8px 10px 2px" value="'+esc(u.slug||'')+'" placeholder="주소" maxlength="30" '+(locked?'readonly disabled':'')+' oninput="V4setSlug(this.value)">'
        +'</div>'
        +'<button type="button" class="v4-btn" style="flex:0 0 auto;padding:0 13px;background:#fff;border:1px solid #d6d6d6;color:#262626" onclick="V4copy()" title="청첩장 링크 복사">복사</button>'
      +'</div></div><div id="v4-slug-msg" style="font-size:12px;margin-top:6px;min-height:0"></div></div>';/*flex→box(대칭)→msg 밖→fld*/

    var html='';
    if(!isPub){
      /* ── 공개 전(첨부 디자인): 주소 → 결제 후 안내 → 결제 → 결제하기 ── */
      var _ymdKo=function(dt){ return dt.getFullYear()+'년 '+(dt.getMonth()+1)+'월 '+dt.getDate()+'일'; };
      var showEndKo='예식일', thankStartKo='예식 다음 날', thankEndKo='예식일로부터 3개월 후';
      try{ if(d.date){ var wd=parseDate(d.date); wd.setHours(0,0,0,0); showEndKo=_ymdKo(wd); thankStartKo=_ymdKo(new Date(wd.getTime()+864e5)); thankEndKo=_ymdKo(new Date(wd.getTime()+90*864e5)); } }catch(e){}
      html+=addr;
      html+='<div class="v4-fld" style="margin-top:14px"><label>'+(canPub?'공개하면':'결제 후')+' 이렇게 진행돼요</label>'
        +'<div style="background:#f5f5f5;padding:15px 16px">'
          +'<div style="font-size:13px;color:#757575;line-height:1.55">결제하시면 하객분들께 청첩장을 전달하실 수 있어요. <b style="color:#555555;font-weight:700">결제 후에도 사진/문구/템플릿 등을 수정할 수 있어요.</b> 이미 받으신 분들께도 수정된 내용으로 보여요.</div>'
          +'<div style="margin-top:16px"><div style="font-size:13px;font-weight:800;color:#555555">청첩장이 보여요</div><div style="font-size:13px;color:#555555;margin-top:3px">오늘 날짜 - '+esc(showEndKo)+'</div></div>'
          +'<div style="margin-top:13px"><div style="font-size:13px;font-weight:800;color:#555555">감사 인사 화면으로 바뀌어요</div><div style="font-size:13px;color:#555555;margin-top:3px">'+esc(thankStartKo)+' - '+esc(thankEndKo)+'</div></div>'
        +'</div></div>';
      if(!canPub && !admin){
        html+='<div class="v4-fld" style="margin-top:14px"><label>결제</label>'
          +'<div style="padding:12px;background:#f5f5f5">'
          +'<div style="display:flex;justify-content:space-between;font-size:13px;color:#555555"><span>모바일 청첩장 1건</span><span id="v4-pay-item">29,900원</span></div>'
          +'<details class="v4-disc-dd" style="margin-top:10px">'
            +'<summary style="cursor:pointer;font-size:12.5px;color:#888888;display:flex;justify-content:space-between;align-items:center;padding:2px 0">할인코드가 있으신가요?<img class="v4-disc-caret" src="/icon-acct.png" alt="" style="width:12px;height:auto"></summary>'
            +'<div style="display:flex;gap:6px;margin-top:8px">'
              +'<input id="v4-disc" placeholder="할인코드 입력" style="flex:1;min-width:0;border:1px solid #e0e0e0;background:#fff;padding:10px 11px;font-size:12.5px;font-family:inherit;text-transform:uppercase" oninput="this.value=this.value.toUpperCase();if(!this.value.trim()&&window.V4clearDiscount)V4clearDiscount()">'
              +'<button type="button" class="v4-btn" style="flex:0 0 auto;padding:0 13px;background:#fff;border:1px solid #d6d6d6;color:#262626" onclick="V4applyDiscount()">적용</button>'
            +'</div><div id="v4-disc-msg" style="font-size:12px;min-height:14px;margin-top:5px;color:#e5484d"></div>'
          +'</details>'
          +'<div id="v4-disc-row" style="display:none;justify-content:space-between;font-size:13px;color:#1f9d55;margin-top:6px"><span>할인 적용</span><span id="v4-pay-discamt"></span></div>'
          +'<div style="height:1px;background:#e0e0e0;margin:10px 0"></div>'
          +'<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:13px;font-weight:700;color:#262626">총 결제 금액</span><b id="v4-pay-price" style="font-size:16px;color:#262626">29,900원</b></div>'
        +'</div></div>';
      }
      /* 예식일을 입력해야 공개 가능(예식일까지 공개→감사화면 전환 로직 때문). 관리자 즉시공개는 예외 */
      var _noDate=!(d.date&&String(d.date).trim());
      html+=admin
        ? '<button type="button" class="v4-btn v4-btn-primary" style="margin-top:12px;width:100%" onclick="V4proxyPublish()">공개하기 (관리자 · 즉시)</button>'
        : (_noDate
          ? '<button type="button" class="v4-btn v4-btn-primary" style="margin-top:12px;width:100%;opacity:.45;cursor:not-allowed" disabled>예식일(공개 종료일)을 입력해야 공개할 수 있어요</button>'
          : '<button type="button" class="v4-btn v4-btn-primary" style="margin-top:12px;width:100%" onclick="'+(canPub?'V4publish()':'V4payappPay()')+'">'+(canPub?'바로 공개하기':'결제하기')+'</button>');
      setTimeout(function(){ if(window.V4payPriceSync)V4payPriceSync(); },0);
    } else {
      html+=addr;
      /* ── 공개 후: 상태 한 줄이면 충분 ── */
      if(arch.state==='ARCHIVE'){
        html+='<div class="v4-note" style="margin-top:10px;background:#fdf3df;padding:11px 12px;color:#8a6b1f"><b>보관 중</b> — 공개가 종료됐어요. 열람·수정은 가능하지만 다시 공개하려면 관리자에게 문의해 주세요.</div>';
      } else if(arch.state==='ADMIN_ARCHIVE'){
        html+='<div class="v4-note" style="margin-top:10px;color:#e5484d">관리자 보관 상태입니다.</div>';
      } else {
        var _dday='';
        try{ if(d.date){ var _w=parseDate(d.date); _w.setHours(0,0,0,0); var _n=Math.round((_w-new Date(new Date().setHours(0,0,0,0)))/86400000); if(_n>0)_dday=' 예식일까지 <b>D-'+_n+'</b>.'; else if(_n===0)_dday=' 오늘이 예식일이에요.'; } }catch(e){}
        var _fut=false;
        try{ if(d.publishStart){ var _t=new Date(); _t.setHours(0,0,0,0); _fut=new Date(d.publishStart+'T00:00:00')>_t; } }catch(e){}
        if(_fut){
          html+='<div class="v4-note" style="margin-top:10px;background:#eef4fd;padding:11px 12px;color:#1d4f91;line-height:1.7"><b>공개 예약됨</b> — <b>'+esc(d.publishStart)+'</b>부터 하객에게 공개돼요.'+_dday+'</div>';
        } else {
          html+='<div class="v4-note" style="margin-top:10px;background:#e6f6ec;padding:11px 12px;color:#14602f;line-height:1.7"><b>공개 중</b>'+_dday+(d.publishEnd?' 예식일 3개월 후인 <b>'+esc(d.publishEnd)+'</b>까지 내 청첩장을 소장 및 열람할 수 있고, 하객에게는 감사 인사 화면이 보여요.':'')+'</div>';
        }
        html+='<button type="button" class="v4-btn" style="margin-top:12px;width:100%;opacity:.45;cursor:default" disabled>공개 완료</button>';
      }
      if(admin) html+='<button type="button" class="v4-btn v4-btn-danger" style="margin-top:12px;width:100%" onclick="V4unpublish()">공개 중단 (관리자)</button>';
    }

    return html;
  }

  function rebuildPublishCard(){ var el=document.getElementById('v4-publishcard'); if(el)el.innerHTML=publishCardHTML(); }
  var _slugT=null;
  window.V4setSlug=function(v){
    var u=inv(); if(!u)return; if(u.slugLocked&&u.published&&!isAdminPreview()){ return; }
    u.slug=(v||'').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,30);
    var si=document.getElementById('v4-slug-input'); if(si&&si.value!==u.slug)si.value=u.slug;
    var chip=document.querySelector('.v4-slug'); if(chip)chip.textContent='/i/'+(u.slug||'_')+' ⧉';
    var pv=document.getElementById('v4-slug-preview'); if(pv)pv.innerHTML=esc(location.origin.replace(/^https?:\/\//,''))+'/i/<b>'+esc(u.slug||'…')+'</b>';
    /* 타이핑 중에는 저장하지 않는다 — 중간 값이 남의 주소와 겹치면 서버가 거부해 팝업이 뜨던 문제 */
    var msg=document.getElementById('v4-slug-msg');
    clearTimeout(_slugT);
    if((u.slug||'').length<3){ if(msg)msg.textContent=''; return; }
    _slugT=setTimeout(function(){
      if(!(window.SB&&SB.checkSlugAvailable)){ scheduleSave(); return; }
      SB.checkSlugAvailable(u.slug).then(function(free){
        var cur=inv(); if(!cur||cur.slug!==u.slug)return; /* 그새 더 입력함 */
        var mine=(cur._slugAtLoad&&cur._slugAtLoad===u.slug); /* 원래 내 주소면 '사용 중'이어도 OK */
        if(free||mine){ if(msg){ msg.textContent=mine&&!free?'✓ 현재 내 주소예요':'✓ 사용할 수 있는 주소예요'; msg.style.color='#1f9d55'; } scheduleSave(); }
        else { if(msg){ msg.textContent='✕ 이미 사용 중인 주소예요'; msg.style.color='#e5484d'; } }
      }).catch(function(){ scheduleSave(); });
    },600);
  };
  /* 상단바 상태 배지(제작중/공개중/보관중) 즉시 갱신 */
  function updateStateBadge(){
    var u=inv(); var d=data(); if(!u||!d)return;
    var el=document.querySelector('.v4-top .v4-state'); if(!el)return;
    var a=(typeof cezArchState==='function')?cezArchState(d,u.published):{state:u.published?'PUBLISHED':'DRAFT'};
    var L={DRAFT:['제작중','#888888','#f2f2f2'],PUBLISHED:['공개중','#1f9d55','#e6f6ec'],ARCHIVE:['보관중','#b8892f','#fdf3df'],ADMIN_ARCHIVE:['관리자보관','#e5484d','#fdeaea']}[a.state]||['제작중','#888888','#f2f2f2'];
    el.textContent=L[0]; el.style.color=L[1]; el.style.background=L[2];
  }

  /* 결제 안내 — 미결제 사용자가 배포를 시도할 때 (스마트스토어 결제 → 확인 후 자동 오픈) */
  /* 지류 할인 코드 적용 */
  window._cezDisc=null;
  /* 사용자가 날짜를 직접 수정한 경우에만 저장 (자동 채움은 저장하지 않는다) */
  window.V4pubdateChanged=function(){
    var inp=document.getElementById('v4-pubdate');
    try{
      var d=data();
      if(d&&inp&&inp.value&&d._pubdate!==inp.value){ d._pubdate=inp.value; if(typeof scheduleSave==='function')scheduleSave(); }
    }catch(e){}
    V4pubdateDday();
  };
  window.V4pubdateDday=function(){
    var el=document.getElementById('v4-dday'); if(!el)return;
    var d=data(); if(!d||!d.date){ el.textContent=''; return; }
    try{
      var w=parseDate(d.date); w.setHours(0,0,0,0);
      var p=new Date(); p.setHours(0,0,0,0);   /* 오늘 기준 */
      var DAY=86400000;
      var e=new Date(w.getTime()+90*DAY);
      var ko=function(x){ return x.getFullYear()+'년 '+(x.getMonth()+1)+'월 '+x.getDate()+'일'; };
      var n1=Math.round((w-p)/DAY)+1;   /* 공개일~예식일 (양끝 포함) */
      var n2=Math.round((e-p)/DAY)+1;   /* 공개일~소장 종료 */
      if(n1<1){ el.textContent='예식일이 지난 날짜예요'; return; }
      el.innerHTML='<div style="display:flex;gap:10px"><b style="color:#555555;flex:0 0 auto">공개 기간</b><span>'+n1+'일 ('+ko(w)+'까지)</span></div>'
        +'<div style="display:flex;gap:10px;margin-top:5px"><b style="color:#555555;flex:0 0 auto">소장 기간</b><span>'+n2+'일 ('+ko(e)+'까지)</span></div>';
    }catch(e){ el.textContent=''; }
  };
  window.V4applyDiscount=function(){
    var inp=document.getElementById('v4-disc'); var msg=document.getElementById('v4-disc-msg');
    var code=(inp&&inp.value||'').trim();
    var cfg=window._cezPayCfg||{};
    /* 코드를 비우고 적용하면 기존 적용분도 해제 */
    if(!code){ if(window.V4clearDiscount)V4clearDiscount(); return; }
    /* 테스트 무료키(staging 전용) — 프로덕션은 testUnlock=false라 무시됨 */
    if(cfg.testUnlock && (code==='테스트' || code.toUpperCase()==='TEST')){
      window._cezTestPrice=1000;  /* PayApp 최소금액 1,000원 — 결제 후 환불 */
      var _it=document.getElementById('v4-pay-item'), _pr=document.getElementById('v4-pay-price'), _dr=document.getElementById('v4-disc-row'), _da=document.getElementById('v4-pay-discamt');
      if(_dr)_dr.style.display='flex'; if(_da)_da.textContent='테스트'; if(_pr)_pr.textContent='1,000원';
      if(msg){ msg.textContent='테스트 결제 · 1,000원 (결제 후 PayApp에서 환불)'; msg.style.color='#1f9d55'; }
      return;
    }
    window._cezTestPrice=null;
    /* 순수 숫자 = 스마트스토어 주문번호 → 진짜인지 검증 후 9,900원 */
    var _digits=code.replace(/[^0-9]/g,'');
    if(_digits.length>=10 && _digits===code.replace(/\s/g,'')){
      if(msg){ msg.textContent='주문번호 확인 중…'; msg.style.color='#888888'; }
      (typeof v4EnsureSession==='function'?v4EnsureSession():Promise.resolve()).then(function(){
        return SB.client.rpc('check_paper_order',{p_order:_digits});
      }).then(function(r){
        var v=r.data;
        if(v==='OK'){ window._cezDisc=_digits; window._cezDiscPrice=((window._cezPayCfg&&window._cezPayCfg.pricePaper)||9900); if(window.V4payPriceSync)V4payPriceSync(); if(msg){ msg.textContent='종이 구매자 확인 · 9,900원 적용'; msg.style.color='#1f9d55'; } }
        else if(v==='USED'){ if(msg){ msg.textContent='이미 사용된 주문번호예요.'; msg.style.color='#e5484d'; } }
        else if(v==='NOTFOUND'){ if(msg){ msg.textContent='아직 확인 안 됐거나 없는 주문번호예요. 잠시 후 다시 시도해 주세요.'; msg.style.color='#e5484d'; } }
        else { if(msg){ msg.textContent='유효하지 않은 주문번호예요.'; msg.style.color='#e5484d'; } }
      }).catch(function(){ if(msg){ msg.textContent='확인에 실패했어요. 잠시 후 다시 시도해 주세요.'; msg.style.color='#e5484d'; } });
      return;
    }
    if(code.replace(/[^A-Z0-9]/gi,'').length<6){ if(msg){ msg.textContent='코드를 확인해 주세요.'; msg.style.color='#e5484d'; } return; }
    /* 공유 쿠폰(다회용) — 서버 검증. FREE=즉시 무료 해제, DISCOUNT=9,900원 적용 후 결제 */
    if(msg){ msg.textContent='코드 확인 중…'; msg.style.color='#888888'; }
    (typeof v4EnsureSession==='function'?v4EnsureSession():Promise.resolve()).then(function(){
      var _tok=(typeof sbAccessToken==='function'?sbAccessToken():null);
      return fetch('/api/redeem-coupon',{method:'POST',headers:{'Authorization':'Bearer '+_tok,'Content-Type':'application/json'},body:JSON.stringify({code:code})});
    }).then(function(r){return r.json();}).then(function(j){
        if(!j||!j.ok){ if(msg){ msg.textContent='유효하지 않은 코드예요.'; msg.style.color='#e5484d'; } return; }
        if(j.kind==='FREE'){
          window._cezDisc=null; window._cezDiscPrice=null; window._cezTestPrice=null; if(window.V4payPriceSync)V4payPriceSync();
          Promise.resolve(SB._loadProfile?SB._loadProfile():null).then(function(){
            var u=inv(); if(u){ u.tier='PAID'; u.publishPermission=true; u.paymentStatus='PAID'; }
            try{ if(typeof rebuildPublishCard==='function')rebuildPublishCard(); }catch(e){}
          });
          if(msg){ msg.textContent='무료 쿠폰 적용 — [바로 공개하기]로 공개할 수 있어요'; msg.style.color='#1f9d55'; }
        } else {
          window._cezDisc=code.replace(/[^A-Z0-9-]/gi,''); window._cezDiscPrice=(j.price||19900); if(window.V4payPriceSync)V4payPriceSync();
          if(msg){ msg.textContent='쿠폰 적용 · '+((j.price||19900).toLocaleString())+'원'; msg.style.color='#1f9d55'; }
        }
      }).catch(function(){ if(msg){ msg.textContent='확인에 실패했어요. 잠시 후 다시 시도해 주세요.'; msg.style.color='#e5484d'; } });
  };
  /* 토스 결제 시작 (pay-config enabled일 때) */
  window.V4payPriceSync=function(){
    function apply(cfg){
      var it=document.getElementById('v4-pay-item'), p=document.getElementById('v4-pay-price');
      var dr=document.getElementById('v4-disc-row'), da=document.getElementById('v4-pay-discamt');
      var base=cfg.price||29900;
      if(it)it.textContent=base.toLocaleString()+'원';
      var dp=window._cezDiscPrice;
      if(window._cezDisc && dp!=null){
        if(dr)dr.style.display='flex';
        if(da)da.textContent='-'+(base-dp).toLocaleString()+'원';
        if(p)p.textContent=dp.toLocaleString()+'원';
      } else {
        if(dr)dr.style.display='none';
        if(p)p.textContent=base.toLocaleString()+'원';
      }
    }
    if(window._cezPayCfg){ apply(window._cezPayCfg); return; }
    fetch('/api/pay-config').then(function(r){return r.json();}).then(function(cfg){ window._cezPayCfg=cfg; apply(cfg); }).catch(function(){});
  };
  /* 할인 초기화 — 코드 삭제 시 적용분·테스트가·메시지 모두 해제하고 정가로 복원 */
  window.V4clearDiscount=function(){
    window._cezDisc=null; window._cezDiscPrice=null; window._cezTestPrice=null;
    var msg=document.getElementById('v4-disc-msg'); if(msg){ msg.textContent=''; msg.style.color='#e5484d'; }
    if(window.V4payPriceSync)V4payPriceSync();
  };
  window.V4testUnlock=function(){
    var tok=(typeof sbAccessToken==='function'?sbAccessToken():null);
    if(!tok){ alert('로그인이 필요해요. 새로고침 후 다시 시도해 주세요.'); return; }
    if(typeof toast==='function')toast('테스트 잠금 해제 중…');
    fetch('/api/test-unlock',{method:'POST',headers:{'Authorization':'Bearer '+tok}}).then(function(r){return r.json();}).then(function(j){
      if(j&&j.ok){
        Promise.resolve(SB._loadProfile?SB._loadProfile():null).then(function(){
          var u=inv(); if(u){ u.tier='PAID'; u.publishPermission=true; u.paymentStatus='PAID'; }
          var ex=document.getElementById('v4-payguide'); if(ex)ex.remove();
          rebuildPublishCard();
          if(typeof toast==='function')toast('테스트: 공개 권한이 열렸어요');
        });
      } else { alert('테스트 잠금 해제 실패: '+((j&&j.error)||'서버 응답 없음')); }
    }).catch(function(){ alert('네트워크 오류로 실패했어요.'); });
  };
  window.V4payappPay=function(){
    if(!(window.SB&&SB.user)){ alert('로그인이 필요해요.'); return; }
    function withCfg(cfg){
      window._cezPayCfg=cfg;
      if(!cfg.payappEnabled){ alert('결제 기능을 준비하고 있어요. 조금만 기다려 주세요!'); return; }
      var price=(cfg.testUnlock && window._cezTestPrice!=null)
        ? window._cezTestPrice
        : (window._cezDiscPrice!=null?window._cezDiscPrice:(cfg.price||29900));
      function go(){
        try{
          PayApp.setDefault('userid', cfg.payappUserid||'thecezhouse');
          PayApp.setDefault('shopname','CEZ');
          PayApp.setParam('goodname','CEZ 모바일 청첩장');
          PayApp.setParam('price', String(price));
          PayApp.setParam('recvphone','01000000000');
          PayApp.setParam('feedbackurl', location.origin+'/api/payapp/feedback');
          PayApp.setParam('returnurl', location.origin+'/api/payapp/return');
          PayApp.setParam('var1', SB.user.id);
          PayApp.setParam('var2', window._cezDisc||'');
          PayApp.setParam('smsuse','n');
          PayApp.setParam('checkretry','y');
          PayApp.setParam('redirectpay','1');
          PayApp.setParam('skip_cstpage','y');
          PayApp.payrequest();
        }catch(e){ alert('결제 모듈 오류: '+(e.message||'')); }
      }
      if(typeof PayApp==='undefined'){
        var sc=document.createElement('script'); sc.src='https://lite.payapp.kr/public/api/v2/payapp-lite.js';
        sc.onload=go; sc.onerror=function(){ alert('결제 모듈을 불러오지 못했어요.'); };
        document.head.appendChild(sc);
      } else go();
    }
    if(window._cezPayCfg){ withCfg(window._cezPayCfg); return; }
    fetch('/api/pay-config').then(function(r){return r.json();}).then(withCfg)
      .catch(function(){ alert('결제 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); });
  };
  window.V4tossPay=function(){
    if(!(window.SB&&SB.user)){ alert('로그인이 필요해요.'); return; }
    if(!window._cezPayCfg){
      fetch('/api/pay-config').then(function(r){return r.json();}).then(function(cfg){ window._cezPayCfg=cfg; window.V4tossPay(); })
        .catch(function(){ alert('결제 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); });
      return;
    }
    var cfg=window._cezPayCfg;
    if(!cfg.enabled){ alert('결제 기능을 준비하고 있어요. 조금만 기다려 주세요!'); return; }
    var price=window._cezDiscPrice!=null?window._cezDiscPrice:(cfg.price||29900);
    function go(){
      try{
        var orderId='CEZ_'+SB.user.id+'_'+Date.now().toString(36)+(window._cezDisc?'_D'+window._cezDisc:'');
        var tp=TossPayments(window._cezPayCfg.clientKey);
        tp.requestPayment('카드',{
          amount:price,
          orderId:orderId,
          orderName:'CEZ 모바일 청첩장',
          customerEmail:(SB.user.email||undefined),
          successUrl:location.origin+'/api/toss/confirm',
          failUrl:location.origin+'/?payfail=cancel#/editor'
        }).catch(function(e){ if(e&&e.code!=='USER_CANCEL')alert('결제 창을 열지 못했어요: '+(e.message||'')); });
      }catch(e){ alert('결제 모듈 오류: '+(e.message||'')); }
    }
    if(typeof TossPayments==='undefined'){
      var sc=document.createElement('script'); sc.src='https://js.tosspayments.com/v1/payment';
      sc.onload=go; sc.onerror=function(){ alert('결제 모듈을 불러오지 못했어요.'); };
      document.head.appendChild(sc);
    } else go();
  };
  window.V4publish=async function(){
    var u=inv(); var d=data(); if(!u||!d)return;
    if(isAdminPreview()){ alert('관리자 미리보기에서는 공개할 수 없어요. (저장되지 않음)\n회원의 공개 권한은 관리자 콘솔에서 관리해 주세요.'); return; }
    try{ if(window.SB&&SB._loadProfile) await SB._loadProfile(); }catch(e){}
    if(window.SB&&SB.canPublish&&!SB.canPublish()){ window.V4payappPay(); return; }
    try{ if(document.activeElement&&document.activeElement.blur)document.activeElement.blur(); }catch(e){} /* 입력 중이던 값 커밋 */
    clearTimeout(_sv); /* 직접 저장이 최신 데이터를 포함하므로 디바운스 저장은 취소 */
    if(!u.slug||u.slug.length<3){ alert('공개 주소를 3자 이상 입력해 주세요.'); return; }
    if(typeof cezArchState==='function' && !isAdminPreview()){
      var _as=cezArchState(d,u.published);
      if(_as.state==='ARCHIVE'||_as.state==='ADMIN_ARCHIVE'){ alert('예식 후 3개월이 지나 보관 상태예요. 다시 공개(연장)는 관리자에게 문의해 주세요.'); return; }
    }
    /* 최초 배포 전 slug 중복 사전 체크 — 중복이면 저장이 조용히 실패하므로 여기서 막는다 */
    if(!u._supabaseRowId && window.SB && SB.checkSlugAvailable){
      try{ var ok=await SB.checkSlugAvailable(u.slug); if(!ok){ alert('이미 사용 중인 주소예요. 다른 주소를 입력해 주세요.'); return; } }catch(e){}
    }
    /* 배포 전 누락 점검 */
    var _miss=[];
    if(!d.date)_miss.push('예식 날짜');
    if(!(d.venueName||'').trim())_miss.push('예식장 이름');
    if(!((d.gallery||[]).filter(Boolean).length))_miss.push('갤러리 사진');
    var _hasAcct=false; try{ Object.keys(d.accounts||{}).forEach(function(k){ var v=d.accounts[k]; if(v&&(v.bank||v.number||v.holder))_hasAcct=true; }); }catch(e){}
    if(!_hasAcct)_miss.push('마음 전하실 곳(계좌)');
    var _missTxt=_miss.length?('[아직 입력하지 않은 항목]\n'+_miss.join(', ')+'\n입력 없이도 공개할 수 있지만, 해당 영역은 비어 보이거나 표시되지 않아요.\n\n'):'';
    if(!u.slugLocked && !confirm(_missTxt+'청첩장 공개 시 설정한 공개일부터 공개되고,\n입력한 url은 변경할 수 없어요.\n내용은 언제든 수정 가능합니다.\n\n공개할까요?')) return;
    /* 배포 시점 스냅샷 — 실수 삭제 시 복구용(요청 시 관리자 복원) */
    try{ var _snap=JSON.parse(JSON.stringify(d)); delete _snap._publishSnapshot; d._publishSnapshot={at:new Date().toISOString(),data:_snap}; }catch(e){}
    /* 바른손식: 배포=즉시 공개, 종료=예식일+3개월 자동(기존 publish_end/gate 재사용, 데이터 보존) */
    var today=new Date(); today.setHours(0,0,0,0);
    var iso=function(x){ return x.toLocaleDateString('sv'); };
    /* 배포 날짜(공개 시작일) — 입력값이 있으면 그 날부터, 없으면 오늘부터 */
    var startDate=today;
    try{
      var pdEl=document.getElementById('v4-pubdate');
      if(pdEl&&pdEl.value){ var pd=parseDate(pdEl.value); pd.setHours(0,0,0,0); if(pd>=today) startDate=pd; }
    }catch(e){}
    d.publishStart=iso(startDate);
    try{
      var base=d.date?parseDate(d.date):today; base.setHours(0,0,0,0);
      if(base<today) base=today; /* 과거 예식일 방어 */
      d.publishEnd=iso(new Date(base.getTime()+90*24*60*60*1000));
    }catch(e){ d.publishEnd=iso(new Date(today.getTime()+90*24*60*60*1000)); }
    u.published=true;
    u.slugLocked=true; /* #11: 최초 배포 후 잠금 */
    /* 배포는 디바운스 저장에 맡기지 않고 즉시 저장 + 결과 확인 (조용한 실패 방지) */
    if(window.SB && SB.user && typeof SB.saveInvitation==='function'){
      setBadge('saving');
      try{
        var saved=await SB.saveInvitation({ slug:u.slug, data:u.data, template:u.data.template||'luce', published:true, publish_start:u.data.publishStart||null, publish_end:u.data.publishEnd||null });
        u._supabaseRowId=saved.id; u.slugLocked=(saved.slug_locked!==false);
        setBadge('saved');
        if(typeof toast==='function') toast('공개 완료! 청첩장이 공개되었습니다.');
        try{ fetch('/api/notify-publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:u.slug})}); }catch(e){}
      }catch(e){
        console.error('[v4 publish]',e);
        u.published=false; u.slugLocked=!!u._supabaseRowId&&u.slugLocked;
        setBadge('error');
        alert('공개 저장에 실패했어요.\n'+((e&&e.message)||'네트워크 상태를 확인하고 다시 시도해 주세요.'));
        rebuildPublishCard(); updateStateBadge();
        return;
      }
    } else { scheduleSave(); }
    rebuildPublishCard(); updateStateBadge();
  };
  window.V4unpublish=function(){
    var u=inv(); if(!u)return;
    if(u.slugLocked&&!isAdminPreview()){ alert('배포 후에는 공개를 취소할 수 없어요. 관리자에게 문의해 주세요.'); return; }
    if(isAdminPreview()){
      /* 관리자 미리보기에선 scheduleSave가 저장을 안 하므로(과거: 공개취소가 서버에 반영 안 돼 하객 URL에 계속 노출),
         서버 RPC admin_toggle_publish로 published=false를 직접 반영. 성공 시에만 UI 갱신 */
      if(!u._supabaseRowId){ if(typeof toast==='function')toast('서버 청첩장이 없어요'); return; }
      if(!confirm('이 회원의 청첩장 공개를 중단할까요?\n하객 URL에서 더 이상 보이지 않습니다.'))return;
      if(!(window.SB&&SB.client)){ alert('서버 연결이 없어요.'); return; }
      setBadge('saving');
      SB.client.rpc('admin_toggle_publish',{p_invitation_id:u._supabaseRowId,p_published:false,p_memo:'공개 중단(관리자)'}).then(function(r){
        if(r.error){ setBadge('error'); alert('공개 중단 실패: '+r.error.message); return; }
        u.published=false; setBadge('saved'); if(typeof toast==='function')toast('공개를 중단했습니다.'); rebuildPublishCard(); updateStateBadge();
        if(typeof cezReloadMembers==='function'){ try{ cezReloadMembers(); }catch(e){} }
      });
      return;
    }
    /* 비관리자(잠금 전) — 즉시 저장으로 확실히 반영 */
    u.published=false;
    if(window.SB && SB.user && typeof SB.saveInvitation==='function'){
      setBadge('saving');
      SB.saveInvitation({ slug:u.slug, data:u.data, template:(u.data&&u.data.template)||'luce', published:false, publish_start:(u.data&&u.data.publishStart)||null, publish_end:(u.data&&u.data.publishEnd)||null })
        .then(function(){ setBadge('saved'); rebuildPublishCard(); updateStateBadge(); })
        .catch(function(e){ u.published=true; setBadge('error'); alert('공개 중단 저장 실패: '+((e&&e.message)||'')); rebuildPublishCard(); updateStateBadge(); });
    } else { scheduleSave(); rebuildPublishCard(); updateStateBadge(); }
  };
  window.V4galRemove=function(idx){ var d=data(); if(!d||!d.gallery)return; d.gallery.splice(idx,1); refreshCanvas(); rebuildSecList(); scheduleSave(); };

  /* v4.3 #6: 관계 자유 입력 · 기본 1개 · ＋로 최대 6개 (getAcctOrder는 index.html 렌더러와 공유) */
  function accountsEditor(){
    var d=data(); if(!d)return '';
    var order=(typeof getAcctOrder==='function')?getAcctOrder(d):[];
    var grouped=!!d.acctGroupBySide;
    var GRIP='<span class="v4-acct-grip" title="끌어서 순서 변경"><svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></svg></span>';
    function acc(o){
      var v=d.accounts[o.key]||{};
      var side=(o.side==='bride')?'bride':'groom';
      var sideTog = grouped ? ('<div class="v4-acct-side">'
          +'<button type="button" class="'+(side==='groom'?'on':'')+'" onclick="V4accSide(\''+o.key+'\',\'groom\')">신랑측</button>'
          +'<button type="button" class="'+(side==='bride'?'on':'')+'" onclick="V4accSide(\''+o.key+'\',\'bride\')">신부측</button>'
        +'</div>') : '';
      return '<div class="v4-acct-item" data-sort-item>'
        +'<div class="v4-acct-top" style="display:flex;align-items:center;gap:6px">'
          +GRIP
          +'<input class="v4-acct-rel" placeholder="관계 (예: 신랑, 신랑 아버지, 신부 어머니)" value="'+esc(o.label||'')+'" oninput="V4accLabel(\''+o.key+'\',this.value)" onchange="V4accFlush()">'
          +(order.length>1?'<button type="button" class="v4-acct-del" onclick="V4accRemove(\''+o.key+'\')" aria-label="삭제">✕</button>':'')
        +'</div>'
        + sideTog
        +'<div class="v4-fld"><input placeholder="성함" value="'+esc(v.holder||'')+'" oninput="V4acc(\''+o.key+'\',\'holder\',this.value)" onchange="V4accFlush()"></div>'
        +'<div class="v4-fld"><input placeholder="은행" value="'+esc(v.bank||'')+'" oninput="V4acc(\''+o.key+'\',\'bank\',this.value)" onchange=\"V4accFlush()\"></div>'
        +'<div class="v4-fld"><input placeholder="계좌번호" value="'+esc(v.number||'')+'" oninput="V4acc(\''+o.key+'\',\'number\',this.value)" onchange=\"V4accFlush()\"></div>'
      +'</div>';
    }
    var toggle='<label class="v4-acct-grouptog"><input type="checkbox" '+(grouped?'checked':'')+' onchange="V4accGroupToggle(this.checked)"><span>신랑측 · 신부측 구분해서 표시</span></label>';
    return toggle
      +'<div data-sortable="accounts">'+order.map(acc).join('')+'</div>'
      +(order.length<6?'<button type="button" class="v4-btn" style="width:100%;margin-top:10px" onclick="V4accAdd()">＋ 계좌 추가 ('+order.length+'/6)</button>':'<div class="v4-note">계좌는 최대 6개까지 등록할 수 있어요.</div>');
  }
  window.V4accGroupToggle=function(on){ var d=data(); if(!d)return; d.acctGroupBySide=!!on; rebuildAcctBody(); refreshCanvasDebounced(); scheduleSave(); };
  window.V4accSide=function(key,side){ var d=data(); if(!d||!Array.isArray(d.acctOrder))return; var o=d.acctOrder.find(function(x){return x.key===key;}); if(o){ o.side=(side==='bride'?'bride':'groom'); rebuildAcctBody(); refreshCanvasDebounced(); scheduleSave(); } };
  cezSortable.register('accounts', { axis:'y', handle:'.v4-acct-grip', ghostSelector:'.v4-acct-top', onReorder:function(from,to){ var d=data(); if(!d||!Array.isArray(d.acctOrder))return; var it=d.acctOrder.splice(from,1)[0]; if(it) d.acctOrder.splice(to,0,it); rebuildAcctBody(); refreshCanvasDebounced(); scheduleSave(); } });
  window.V4accLabel=function(key,v){ var d=data(); if(!d||!Array.isArray(d.acctOrder))return; var o=d.acctOrder.find(function(x){return x.key===key;}); if(o){ o.label=v; scheduleSave(); _acT&&clearTimeout(_acT); _acT=setTimeout(patchAcctPreview,250); } };
  function rebuildAcctBody(){ var b=document.querySelector('.v4-sec[data-id="accounts"] .v4-sec-body'); if(b) b.innerHTML=accountsEditor(); else rebuildSecList(); }
  window.V4accAdd=function(){ var d=data(); if(!d)return; var order=getAcctOrder(d); if(order.length>=6)return; d._acctSeq=(d._acctSeq||1)+1; var key='ac'+d._acctSeq; d.accounts[key]={bank:'',number:'',holder:''}; order.push({key:key,label:''}); rebuildAcctBody(); refreshCanvasDebounced(); scheduleSave(); };
  window.V4accRemove=function(key){ var d=data(); if(!d||!Array.isArray(d.acctOrder))return; d.acctOrder=d.acctOrder.filter(function(x){return x.key!==key;}); if(d.accounts)delete d.accounts[key]; rebuildAcctBody(); refreshCanvasDebounced(); scheduleSave(); };

  function titleFieldHTML(secId){
    var d=data(); var v=(d&&d.sectionLabels&&d.sectionLabels[secId])||'';
    return '<div class="v4-fld"><label>섹션 제목</label><input id="v4t-'+secId+'" value="'+esc(v)+'" placeholder="'+esc(labelDefault(secId))+'" oninput="V4setLabel(\''+secId+'\',this.value)"></div>';
  }
  function secBody(s){
    /* RSVP: 기존 엔진 그대로 재사용(설정 + Dashboard/통계/명단/엑셀). 삭제/재구현 금지 */
    if(s.id==='rsvp' && typeof rsvpFieldsSectionHTML==='function'){ return '<div class="v4-embed">'+rsvpFieldsSectionHTML(data())+'</div>'; }

    var head = '';  /* v4.4: 섹션 제목 편집 칸 제거(디자인 고정 워딩) */
    var body;
    if(s.id==='gallery') body=galleryEditor();
    else if(s.id==='accounts') body=accountsEditor();
    else { var fields=SECFIELDS[s.id]; body = fields ? fields.map(fieldHTML).join('') : '<div class="v4-note">미리보기에서 바로 편집할 수 있어요.</div>'; }
    return head+body;
  }

  var CORE_SECTIONS={invitation:1,couple:1}; /* 디폴트 — 숨김 불가 (예식장·예식일은 뮤트 가능하도록 제외) */
  function secCard(s,i){
    var label=SEC_LABEL[s.id]||s.id;
    var on=s.show!==false;
    if(CORE_SECTIONS[s.id]) on=true;
    var open=(V4.openSec===s.id);
    var _drag=!(s.id==='cover'||s.id==='invitation'||s.id==='couple');
    return '<div class="v4-sec'+(open?' open':'')+(on?'':' off')+'" data-i="'+i+'" data-id="'+s.id+'" data-sort-item>'
      +'<div class="v4-sec-head">'
        +(_drag?'<span class="v4-sec-grip" title="끌어서 순서 변경"><svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></svg></span>':'<span style="width:2px"></span>')
        +'<span class="v4-sec-name" onclick="V4toggleExpand(\''+s.id+'\')">'+esc(label)+'</span>'
        +(CORE_SECTIONS[s.id]?'':'<button type="button" class="v4-vis'+(on?' on':'')+'" onclick="V4toggleVis(\''+s.id+'\')" title="'+(on?'표시 중 — 누르면 숨겨요':'숨김 — 누르면 표시해요')+'">'
          +(on
            ?'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>'
            :'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" opacity=".35"/><circle cx="12" cy="12" r="2.6" opacity=".35"/><path d="M4 20L20 4"/></svg>')
        +'</button>')
        +'<span class="v4-exp" onclick="V4toggleExpand(\''+s.id+'\')"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
      +'</div>'
      +'<div class="v4-sec-body">'+secBody(s)+'</div>'
    +'</div>';
  }

  function secListHTML(){
    var d=data(); if(!d)return '';
    d.sections=d.sections||(typeof defaultSectionsList==='function'?defaultSectionsList():[]);
    var secs=getSections(d);
    if(window.CEZ_RSVP_DISABLED) secs=secs.filter(function(x){return x.id!=='rsvp';});
    secs=secs.filter(function(x){return x.id!=='share';}); /* 공유는 편집 옵션 없음 — 사이드바 제외 */
    return secs.map(function(s,i){ return secCard(s,i); }).join('');
  }
  function rebuildSecList(){
    var el=document.getElementById('v4-seclist'); if(el) el.innerHTML=secListHTML();
  }

  window.V4toggleExpand=function(id){ V4.openSec=(V4.openSec===id)?null:id; rebuildSecList(); if(V4.openSec===id) highlightPreview(id); syncPreviewOpen(); if(V4.openSec==='rsvp' && window.cezLoadRSVPs){ var _u=inv(); if(_u&&_u.slug)window.cezLoadRSVPs(_u.slug); } };
  window.V4toggleVis=function(id){
    if(CORE_SECTIONS[id])return; /* 디폴트 섹션은 숨김 불가 */
    var d=data(); if(!d)return;
    d.sections=d.sections||defaultSectionsList();
    var x=d.sections.find(function(z){return z.id===id;});
    if(!x)return;
    var newShow=!(x.show!==false); x.show=newShow; x.userOff=!newShow;
    _tr('T'+_curTid+' VIS-TOGGLE '+id+' → show='+newShow+' (afterDragUp='+((Date.now()-_lastUpAt)<800)+'ms='+(Date.now()-_lastUpAt)+')');
    /* 예식 일시(when)를 켜면 날짜가 비어 있을 때 오늘 날짜를 기본 입력 */
    if(id==='when' && newShow && !d.date){ try{ d.date=new Date().toLocaleDateString('sv'); }catch(e){} }
    refreshCanvas(); rebuildSecList(); scheduleSave();
  };

  var _LOCK_TOP={cover:1,invitation:1,couple:1};
  /* 섹션 재정렬 — 갤러리와 동일한 공용 Sortable(고스트+placeholder). 그립(.v4-sec-grip)만 잡아 이동.
     from/to = 렌더된 섹션 카드 순서 = d.sections 인덱스. 잠긴 상단 섹션은 이동/침범 불가(기존 규칙 유지). */
  cezSortable.register('sections', { axis:'y', handle:'.v4-sec-grip', ghostSelector:'.v4-sec-head', onReorder:function(from,to){
    var d=data(); var arr=d&&d.sections; if(!arr||from===to){ _tr('T'+_curTid+' REORDER SKIP from='+from+' to='+to+' (no arr or same)'); return; }
    _tr('T'+_curTid+' REORDER from='+from+' to='+to+' before='+arr.map(function(s){return s&&s.id;}).join(','));
    if(_LOCK_TOP[(arr[from]||{}).id]){ _tr('sec onReorder BLOCKED: from is locked ('+(arr[from]||{}).id+')'); return; }
    var lockN=0; while(lockN<arr.length && _LOCK_TOP[arr[lockN].id]) lockN++;
    if(to<lockN) to=lockN;                              /* 인사말·가족 정보 위로는 못 옮김 */
    var moved=arr.splice(from,1)[0]; if(moved) arr.splice(to,0,moved);   /* undefined(잘못된 인덱스) 삽입 방지 → d.sections 손상 차단 */
    _tr('T'+_curTid+' REORDER after='+arr.map(function(s){return s&&s.id;}).join(',')+' (moved='+((moved||{}).id)+')');
    refreshCanvas(); rebuildSecList(); scheduleSave();
    _tr('T'+_curTid+' REORDER DONE');
  } });

  function drawerInner(d){
    if(V4.pvMode==='post') return drawerInnerPost(d);
    var t=(DB.templates||[]).find(function(x){return x.id===d.template;});
    return '<div class="v4-drawer-head"><b>편집 설정</b><button type="button" class="v4-x" onclick="V4closeDrawer()">✕</button></div>'
      +'<div class="v4-drawer-body">'
        +'<div class="v4-grp">템플릿</div>'
        +'<div class="v4-tpl-row"><span id="v4-tpl-cur">'+tplDot(d.template)+esc(t?t.name:'—')+'</span><button type="button" class="v4-btn" id="v4-tplbtn" onclick="V4openPicker()">변경</button></div>'
        +'<div class="v4-grp">표지</div>'
        +'<div id="v4-covercard">'+coverCardHTML(d)+'</div>'
        +'<div class="v4-grp">배경 음악</div>'
        +'<div class="v4-sec'+(V4.musicOpen?' open':'')+'" id="v4-musicsec"><div class="v4-sec-head" onclick="V4toggleMusic()"><span class="v4-sec-name" id="v4-music-cur">'+esc(musicChipLabel())+'</span><span class="v4-exp"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div><div class="v4-sec-body" id="v4-musiccard">'+musicCardHTML()+'</div></div>'
        +'<div class="v4-grp">섹션</div>'
        +'<div id="v4-seclist" data-sortable="sections">'+secListHTML()+'</div>'
        +'<div class="v4-grp">공개 설정</div>'
        +'<div id="v4-publishcard">'+publishCardHTML()+'</div>'
        +'<div class="v4-grp">계정</div>'
        +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f5f5f5;padding:12px 14px"><span style="font-size:13px;color:#555555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0" title="로그인 계정">'+esc((window.SB&&SB.user&&SB.user.email)||'로그인 정보 없음')+'</span><button type="button" class="v4-btn" style="flex:0 0 auto;padding:8px 12px;font-size:12px;background:#fff;border:1px solid #d6d6d6;color:#262626" onclick="V4logout()">로그아웃</button></div>'
      +'</div>';
  }

  var TPL_DOT={luce:'#f1e8a1',cotton:'#F5F5F5',kakao:'#362724'};
  function tplDot(id){ var c=TPL_DOT[id]||'#eee'; return '<span class="v4-tpldot" style="background:'+c+'"></span>'; }
  function isDesk(){ return window.innerWidth>=1024; }
  /* ── 예식 후(감사장) 편집 패널 (P2) ── */
  function thankCoverCardHTML(d){
    var cov=esc(d.thankCover||'gamsa-cover.jpg?v=1');
    return '<div class="v4-cthumb" onclick="V4openCrop(\'thank\')"><img src="'+cov+'" alt=""><div class="v4-cthumb-edit">변경</div></div>';
  }
  function rebuildThankCard(){ var el=document.getElementById('v4-thankcard'); var d=data(); if(el&&d)el.innerHTML=thankCoverCardHTML(d); }
  function drawerInnerPost(d){
    var email=esc((window.SB&&SB.user&&SB.user.email)||'로그인 정보 없음');
    return '<div class="v4-drawer-head"><b>편집 설정</b><button type="button" class="v4-x" onclick="V4closeDrawer()">✕</button></div>'
      +'<div class="v4-drawer-body">'
        +'<div class="v4-grp">감사장 표지</div>'
        +'<div id="v4-thankcard">'+thankCoverCardHTML(d)+'</div>'
        +'<div class="v4-grp">배경 음악</div>'
        +'<div class="v4-sec'+(V4.musicOpen?' open':'')+'" id="v4-musicsec"><div class="v4-sec-head" onclick="V4toggleMusic()"><span class="v4-sec-name" id="v4-music-cur">'+esc(musicChipLabel())+'</span><span class="v4-exp"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div><div class="v4-sec-body" id="v4-musiccard">'+musicCardHTML()+'</div></div>'
        +'<div class="v4-grp">감사말</div>'
        +'<textarea id="v4-thankmsg" oninput="V4setThankMsg(this.value)" placeholder="감사 인사말을 입력하세요" style="width:100%;box-sizing:border-box;min-height:120px;padding:12px 13px;border:1px solid #e0e0e0;background:#fff;font-family:inherit;font-size:14px;line-height:1.7;color:#262626;resize:vertical">'+esc(d.thankYouMessage||'')+'</textarea>'
        +'<div class="v4-grp">이미지 저장</div>'
        +'<button type="button" class="v4-btn" style="width:100%" onclick="V4saveThankImage()">PNG로 저장하기</button>'
        +'<div class="v4-grp">계정</div>'
        +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f5f5f5;padding:12px 14px"><span style="font-size:13px;color:#555555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0" title="로그인 계정">'+email+'</span><button type="button" class="v4-btn" style="flex:0 0 auto;padding:8px 12px;font-size:12px;background:#fff;border:1px solid #d6d6d6;color:#262626" onclick="V4logout()">로그아웃</button></div>'
      +'</div>';
  }
  window.V4setThankMsg=function(v){ var d=data(); if(!d)return; d.thankYouMessage=v; if(window.refreshCanvas)refreshCanvas(); scheduleSave(); };
  function ensureH2C(cb){
    if(window.html2canvas){ cb(); return; }
    var ex=document.getElementById('v4-h2c-lib');
    if(ex){ var iv=setInterval(function(){ if(window.html2canvas){ clearInterval(iv); cb(); } },100); setTimeout(function(){ clearInterval(iv); },8000); return; }
    var sc=document.createElement('script'); sc.id='v4-h2c-lib'; sc.src='/vendor-html2canvas.js';
    sc.onload=function(){ cb(); };
    sc.onerror=function(){ if(typeof toast==='function')toast('이미지 저장 도구를 불러오지 못했어요'); };
    document.head.appendChild(sc);
  }
  /* P3: 감사장 화면을 PNG로 저장 — 편집 데코 없는 깨끗한 사본을 오프스크린 렌더 후 캡처 */
  window.V4saveThankImage=function(){
    var d=data(); if(!d)return;
    if(typeof renderThankYouPreview!=='function'){ if(typeof toast==='function')toast('감사장 렌더러를 찾지 못했어요'); return; }
    if(typeof toast==='function')toast('이미지를 만드는 중이에요…');
    ensureH2C(function(){
      var host=document.createElement('div');
      host.style.cssText='position:fixed;left:-9999px;top:0;width:420px;background:#fff';
      host.innerHTML=renderThankYouPreview(d);
      document.body.appendChild(host);
      var target=host.firstElementChild||host;
      setTimeout(function(){
        try{
          window.html2canvas(target,{useCORS:true,backgroundColor:'#ffffff',scale:2,logging:false}).then(function(canvas){
            var url;
            try{ url=canvas.toDataURL('image/png'); }
            catch(err){ if(typeof toast==='function')toast('이미지 저장 실패 — 사진 권한(CORS) 문제일 수 있어요'); host.remove(); return; }
            var u=(typeof inv==='function')?inv():null; var slug=(u&&u.slug)||'thankyou';
            var a=document.createElement('a'); a.href=url; a.download='cez-thankyou-'+slug+'.png';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            if(typeof toast==='function')toast('감사장 이미지를 저장했어요');
            host.remove();
          }).catch(function(){ if(typeof toast==='function')toast('이미지 저장에 실패했어요'); host.remove(); });
        }catch(e){ if(typeof toast==='function')toast('이미지 저장에 실패했어요'); host.remove(); }
      },500);
    });
  };
  window.V4openDrawer=function(){ var d=document.getElementById('v4-drawer'),s=document.getElementById('v4-scrim'); if(d)d.classList.add('open'); if(s&&!isDesk())s.classList.add('open'); if(isDesk())document.body.classList.add('v4-dock'); };
  window.V4closeDrawer=function(){ var d=document.getElementById('v4-drawer'),s=document.getElementById('v4-scrim'); if(d)d.classList.remove('open'); if(s)s.classList.remove('open'); document.body.classList.remove('v4-dock'); if(window.V4musicPreviewStop)V4musicPreviewStop(); };
  window.V4toggleDrawer=function(){
    var d=document.getElementById('v4-drawer');
    if(d&&d.classList.contains('open')){ V4.drawerUserClosed=true; window.V4closeDrawer(); }
    else { V4.drawerUserClosed=false; window.V4openDrawer(); }
  };

  /* ---------------- 표지 (대표/서브/그레인) ---------------- */
  /* 사이드바 표지 카드 — 드로어가 프리뷰를 가리므로 카드 안에서 바로 미리보기(그레인 반영) */
  function coverCardHTML(d){
    var grain=(d.coverGrainEnabled!==false);
    var cov=esc(d.cover||'luce-cover.jpg?v=4');
    var sub=esc(d.subCoverImage||'luce-gallery.jpg?v=3');
    function thumb(src,label,onClick,withGrain){
      return '<div style="flex:1;min-width:0"><div class="v4-cthumb" onclick="'+onClick+'">'
        +'<img src="'+src+'" alt="">'
        +(withGrain?'<div class="v4-cthumb-grain"></div>':'')
        +'<div class="v4-cthumb-edit">변경</div>'
      +'</div><div style="font-size:12px;color:#888888;text-align:center;margin-top:5px">'+label+'</div></div>';
    }
    return '<div style="display:flex;gap:10px">'
      +thumb(cov,'메인 표지',"V4openCrop('cover')",grain)
      +thumb(sub,'서브 표지',"V4openCrop('sub')",!!d.subCoverGrainEnabled)
    +'</div>';
  }
  function rebuildCoverCard(){ var el=document.getElementById('v4-covercard'); var d=data(); if(el&&d)el.innerHTML=coverCardHTML(d); }
  /* 필름 질감 — 현재 열린 크롭 대상(cover/sub/대표 사진)에 적용. 신규 필드는 additive(기본 꺼짐) */
  window.V4grainSet=function(on){ var d=data(); if(!d)return; on=!!on;
    if(_cropI==='cover')d.coverGrainEnabled=on;
    else if(_cropI==='sub')d.subCoverGrainEnabled=on;
    else { var it=cropItem(); if(it)it.grain=on; }
    var ov=document.getElementById('v4-cropgrain'); if(ov)ov.style.display=on?'':'none'; /* 팝업 속 사진에도 즉시 반영 */
    refreshCanvas(); rebuildCoverCard(); scheduleSave(); };

  /* ---------------- 대표 사진(폴라로이드) Crop 모달: 확대·축소·이동 ---------------- */
  var _cropI=0,_cropDrag=null,_cropMigStarted=false,_cropMigBackup=null;
  function cropItem(){
    var d=data(); if(!d)return null;
    if(_cropI==='cover'){ d.coverCrop=d.coverCrop||{s:1,x:0,y:0}; var cc=d.coverCrop; cc.src=d.cover||'luce-cover.jpg?v=4'; return cc; }
    if(_cropI==='sub'){ d.subCoverCrop=d.subCoverCrop||{s:1,x:0,y:0}; var c=d.subCoverCrop; c.src=d.subCoverImage||'luce-gallery.jpg?v=3'; return c; }
    if(_cropI==='thank'){ d.thankCoverCrop=d.thankCoverCrop||{s:1,x:0,y:0}; var ck=d.thankCoverCrop; ck.src=d.thankCover||'gamsa-cover.jpg?v=1'; return ck; }
    return getFeaturedGallery(d)[_cropI];
  }
  function cropAspect(){
    if(_cropI==='cover')return '380/500'; if(_cropI==='sub')return '240/151'; if(_cropI==='thank')return '5/4';
    var it=(getFeaturedGallery(data())||[])[_cropI]||{};   /* 대표사진: 수동 세로면 세로 크롭뷰(자동은 로드 후 갱신) */
    return (it.frameOrientation==='portrait')?'159/254':'254/159';
  }
  function _foriMode(it){ return (it&&it.frameOrientation==='portrait')?'portrait':'landscape'; }  /* 없으면 가로 기본 */
  function _setCropOri(ori){ var v=document.getElementById('v4-cropview'); if(v)v.style.aspectRatio=(ori==='portrait')?'159/254':'254/159'; }
  function _hlFori(mode){ var b=document.getElementById('v4-fori'); if(!b)return; Array.prototype.forEach.call(b.children,function(x){ x.classList.toggle('on', x.getAttribute('data-o')===mode); }); }
  var _cropPendingAuto=false;
  window._v4CropAuto=function(){   /* #v4-cropimg onload: 새 업로드면 이미지 비율로 프레임 방향 '초기값' 결정 */
    if(!_cropPendingAuto || typeof _cropI!=='number')return; _cropPendingAuto=false;
    var im=document.getElementById('v4-cropimg'); var it=cropItem(); if(!im||!it||!im.naturalWidth)return;
    it.frameOrientation=(im.naturalHeight>im.naturalWidth)?'portrait':'landscape';
    it.x=0; it.y=0; it.s=1; delete it.posX; delete it.posY; var z=document.getElementById('v4-cropzoom'); if(z)z.value=100;
    _setCropOri(it.frameOrientation); _hlFori(it.frameOrientation); if(typeof V4cropApply==='function')V4cropApply(); refreshCanvas(); scheduleSave();
  };
  window.V4framOri=function(mode){   /* 수동 세로/가로 — 방향 바뀌면 크롭 리셋(cover 재계산)해 사진 넘침/빈공간 방지 */
    if(typeof _cropI!=='number' || (mode!=='portrait'&&mode!=='landscape'))return; var it=cropItem(); if(!it)return;
    it.frameOrientation=mode; it.x=0; it.y=0; it.s=1; delete it.posX; delete it.posY;
    var z=document.getElementById('v4-cropzoom'); if(z)z.value=100;
    _setCropOri(mode); _hlFori(mode); if(typeof V4cropApply==='function')V4cropApply(); refreshCanvas(); scheduleSave();
  };
  window.V4openCrop=function(i){
    ensureStyle();
    var d=data(); if(!d)return;
    _cropI=i; var it=cropItem(); if(!it)return;
    var grainOn=(i==='cover')?(d.coverGrainEnabled!==false):(i==='sub'?!!d.subCoverGrainEnabled:!!it.grain);
    var panel=document.createElement('div'); panel.id='v4-croppanel'; panel.className='v4-tplpanel';
    panel.onclick=function(e){ if(e.target===panel)V4cropClose(); };
    panel.innerHTML='<div class="v4-tplpanel-in" style="width:340px">'
      +'<div class="v4-pop-head" style="padding:14px 16px 8px"><b>'+(i==='cover'?'메인 표지':(i==='sub'?'서브 표지':(i==='thank'?'감사장 표지':'대표 사진 '+(i+1))))+'</b><button type="button" class="v4-x" onclick="V4cropClose()">✕</button></div>'
      +'<div style="padding:0 16px 16px">'
        +'<div class="v4-cropview" id="v4-cropview" style="aspect-ratio:'+cropAspect()+'"><img id="v4-cropimg" src="'+esc(it.src)+'" draggable="false" onload="window._v4CropAuto&&window._v4CropAuto()">'
          +'<div class="v4-cthumb-grain" id="v4-cropgrain"'+(grainOn?'':' style="display:none"')+'></div></div>'
        +'<div style="display:flex;align-items:center;gap:10px;margin-top:14px"><span style="font-size:13px;color:#888888">축소</span>'
          +'<input type="range" id="v4-cropzoom" min="100" max="300" value="'+Math.round((it.s||1)*100)+'" style="flex:1;accent-color:#3182f6" oninput="V4cropZoom(this.value)">'
          +'<span style="font-size:13px;color:#888888">확대</span></div>'
        +((typeof i==='number')?('<div style="margin-top:14px"><div style="font-size:13px;font-weight:600;color:#262626;margin-bottom:7px">프레임 방향</div>'
          +'<div class="v4-fori" id="v4-fori">'
            +'<button type="button" data-o="portrait" class="'+(_foriMode(it)==='portrait'?'on':'')+'" onclick="V4framOri(\'portrait\')">세로</button>'
            +'<button type="button" data-o="landscape" class="'+(_foriMode(it)==='landscape'?'on':'')+'" onclick="V4framOri(\'landscape\')">가로</button>'
          +'</div><div style="font-size:11.5px;color:#9e9e9e;margin-top:6px">사진을 넣으면 비율에 맞춰 자동으로 선택돼요</div></div>'):'')
        +'<label style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:13px;font-weight:600;color:#262626;cursor:pointer">필름 질감 추가'
          +'<input type="checkbox" '+(grainOn?'checked':'')+' onchange="V4grainSet(this.checked)" style="width:18px;height:18px;accent-color:#3182f6">'
        +'</label>'
        +'<div style="display:flex;gap:8px;margin-top:14px">'
          +'<button type="button" class="v4-btn" style="flex:1" onclick="V4cropReplace()">사진 교체</button>'
          +'<button type="button" class="v4-btn v4-btn-primary" style="flex:1;padding:10px!important" onclick="V4cropClose()">완료</button>'
        +'</div>'
      +'</div></div>';
    document.body.appendChild(panel);
    V4cropApply();
    var view=document.getElementById('v4-cropview');
    view.addEventListener('pointerdown',function(e){ _cropDrag={x:e.clientX,y:e.clientY}; _cropMigStarted=false; _cropMigBackup=null; view.setPointerCapture(e.pointerId); });
    view.addEventListener('pointermove',function(e){
      if(!_cropDrag)return;
      var it2=cropItem(); var r=view.getBoundingClientRect();
      var dx=e.clientX-_cropDrag.x, dy=e.clientY-_cropDrag.y;
      var limX=Math.max(0,((it2.s||1)-1)*50);
      /* ── 커버: 세로 = object-position(posY), 가로 = translate.x ── */
      if(_cropI==='cover'){
        var usePosY = (it2.posY!=null) || !it2.y;   /* posY 있거나, 기존 translate.y가 0/없음일 때만 posY 경로 */
        if(usePosY){
          var im=document.getElementById('v4-cropimg');
          var iar=(im&&im.naturalWidth&&im.naturalHeight)?(im.naturalWidth/im.naturalHeight):(380/500);
          var renderedH=(r.width/iar)*(it2.s||1);                 /* object-fit:cover(세로 긴 사진=폭 맞춤) × 줌 */
          var overflowY=Math.max(1, renderedH - r.height);        /* 숨겨진 세로(px) — naturalHeight 반영 */
          var base=(it2.posY!=null)?it2.posY:50;
          var next=Math.max(0,Math.min(100, base - (dy/overflowY)*100)); /* 아래로 끌면 상단이 보임 → posY↓ */
          if(it2.posY==null){
            /* 실제 값이 바뀌는 순간에만 1회 마이그레이션 (열기·미세흔들림만으론 변환 안 함) */
            if(next!==50){
              if(!_cropMigStarted){ _cropMigStarted=true; _cropMigBackup={x:it2.x,y:it2.y,s:it2.s}; }
              it2.posY=next; it2.y=0;
            }
          }else{ it2.posY=next; }
        }else{
          /* 기존 줌+세로이동 크롭(translate.y≠0): 기존 translate.y 방식 유지(임시 호환) */
          it2.y=(it2.y||0)+(dy/r.height)*100;
          it2.y=Math.max(-limX,Math.min(limX,it2.y));
        }
        it2.x=(it2.x||0)+(dx/r.width)*100;
        it2.x=Math.max(-limX,Math.min(limX,it2.x));
      }else if(typeof _cropI==='number'){
        /* ── 대표사진: object-position 팬 — 비율 불일치(가로사진↔세로프레임 등) 방향으로 이동 가능.
           기존 translate 데이터는 최초 실제 이동 시 posX/posY로 migrate(열기만으론 변환 안 함) ── */
        var im=document.getElementById('v4-cropimg');
        var iar=(im&&im.naturalWidth&&im.naturalHeight)?(im.naturalWidth/im.naturalHeight):(r.width/r.height);
        var war=r.width/r.height, s=it2.s||1, cw, ch;
        if(iar>=war){ ch=r.height*s; cw=ch*iar; } else { cw=r.width*s; ch=cw/iar; }
        var overX=Math.max(0,cw-r.width), overY=Math.max(0,ch-r.height);
        if(it2.posX==null && it2.posY==null){
          if(!_cropMigStarted){ _cropMigStarted=true; _cropMigBackup={x:it2.x,y:it2.y,s:it2.s}; }
          it2.posX=50; it2.posY=50; it2.x=0; it2.y=0;
        }
        if(overX>1) it2.posX=Math.max(0,Math.min(100,(it2.posX==null?50:it2.posX)-(dx/overX)*100));
        if(overY>1) it2.posY=Math.max(0,Math.min(100,(it2.posY==null?50:it2.posY)-(dy/overY)*100));
      }else{
        /* ── 서브/감사장: 기존 translate 유지 ── */
        it2.x=(it2.x||0)+(dx/r.width)*100;
        it2.y=(it2.y||0)+(dy/r.height)*100;
        it2.x=Math.max(-limX,Math.min(limX,it2.x)); it2.y=Math.max(-limX,Math.min(limX,it2.y));
      }
      _cropDrag={x:e.clientX,y:e.clientY};
      V4cropApply();
    });
    view.addEventListener('pointerup',function(){
      _cropDrag=null;
      /* 마이그레이션했지만 순변화 0(posY가 다시 50)이면 원복 → 데이터 무변경 */
      if(_cropMigStarted){
        var it3=cropItem();
        if(it3 && _cropMigBackup){
          var netZero=(typeof _cropI==='number')
            ? ((it3.posX==null||it3.posX===50) && (it3.posY==null||it3.posY===50))
            : (it3.posY===50);
          if(netZero){ it3.x=_cropMigBackup.x; it3.y=_cropMigBackup.y; it3.s=_cropMigBackup.s; delete it3.posX; delete it3.posY; }
        }
        _cropMigStarted=false; _cropMigBackup=null;
      }
      refreshCanvasDebounced(); scheduleSave();
    });
  };
  function V4cropApply(){
    var it=cropItem();
    var img=document.getElementById('v4-cropimg');
    if(!img) return;
    if(_cropI==='cover' && it && it.posY!=null){
      img.style.objectPosition='50% '+(+it.posY)+'%';
      img.style.transform='translate('+(it.x||0)+'%,0%) scale('+(it.s||1)+')';
    }else if(typeof _cropI==='number' && it && (it.posX!=null||it.posY!=null)){
      img.style.objectPosition=(it.posX==null?50:it.posX)+'% '+(it.posY==null?50:it.posY)+'%';
      img.style.transform='scale('+(it.s||1)+')';
    }else{
      img.style.objectPosition='';   /* 기본 50% 50% */
      img.style.transform='translate('+(it.x||0)+'%,'+(it.y||0)+'%) scale('+(it.s||1)+')';
    }
  }
  window.V4cropZoom=function(v){ var it=cropItem(); it.s=Math.max(1,parseInt(v,10)/100);
    var lim=Math.max(0,(it.s-1)*50); it.x=Math.max(-lim,Math.min(lim,it.x||0));
    if(!(_cropI==='cover'&&it.posY!=null)) it.y=Math.max(-lim,Math.min(lim,it.y||0)); /* posY 경로는 y=0 유지 */
    V4cropApply(); refreshCanvasDebounced(); scheduleSave(); };
  window.V4cropReplace=function(){
    openFilePicker(false,function(files){
      var f=files[0]; if(!f)return; setBadge('saving');
      var _isCover=(_cropI==='cover'||_cropI==='sub'), _mx=_isCover?1920:1280, _q=_isCover?0.92:0.8; /* 표지/서브 재업로드도 고해상도 파이프라인(pickImage와 동일) */
      v4UploadImage(f,_mx,_q).then(function(url){ var it=cropItem(); it.src=url; it.s=1; it.x=0; it.y=0; if(typeof _cropI==='number'){ _cropPendingAuto=true; delete it.frameOrientation; } var dd=data(); if(_cropI==='sub'){ dd.subCoverImage=url; rebuildCoverCard(); } if(_cropI==='cover'){ dd.cover=url; rebuildCoverCard(); } if(_cropI==='thank'){ dd.thankCover=url; rebuildThankCard(); } var im=document.getElementById('v4-cropimg'); if(im)im.src=url; var z=document.getElementById('v4-cropzoom'); if(z)z.value=100; V4cropApply(); refreshCanvas(); scheduleSave(); });
    });
  };
  window.V4cropClose=function(){ var p=document.getElementById('v4-croppanel'); if(p)p.remove(); refreshCanvas(); scheduleSave(); };

  /* ---------------- FAQ 플로팅 패널 (유저 공개 · 어드민에서 편집) ---------------- */
  window.V4openFaq=function(){
    ensureStyle();
    var faqs=(typeof window.cezGetFaqs==='function')?window.cezGetFaqs():[];
    faqs=faqs.filter(function(f){return f.visible!==false;}).slice().sort(function(a,b){return (a.sort_order||100)-(b.sort_order||100);});
    var cats=[]; faqs.forEach(function(f){ var c=f.category||'기타'; if(cats.indexOf(c)<0)cats.push(c); });
    var body=cats.map(function(c){
      var items=faqs.filter(function(f){return (f.category||'기타')===c;}).map(function(f,i){
        return '<details class="v4-faq-item"><summary>'+esc(f.question)+'</summary><div class="v4-faq-a">'+esc(f.answer).replace(/\n/g,'<br>')+'</div></details>';
      }).join('');
      return '<div class="v4-grp" style="margin-top:18px">'+esc(c)+'</div>'+items;
    }).join('');
    var panel=document.createElement('div'); panel.id='v4-faqpanel'; panel.className='v4-tplpanel';
    panel.onclick=function(e){ if(e.target===panel)panel.remove(); };
    panel.innerHTML='<div class="v4-tplpanel-in">'
      +'<div class="v4-pop-head" style="padding:14px 16px 8px"><b>자주 묻는 질문</b><button type="button" class="v4-x" onclick="document.getElementById(\'v4-faqpanel\').remove()">✕</button></div>'
      +'<div class="v4-tplpanel-list" style="padding-bottom:8px">'+(body||'<div class="v4-note">등록된 FAQ가 없습니다.</div>')+'</div>'
      +'<div style="padding:12px 16px 18px;border-top:1px solid #f0f0f0;text-align:center"><a href="https://talk.naver.com/profile/w5v8sp" target="_blank" rel="noopener" style="font-size:13px;font-weight:600;color:#3182f6;text-decoration:none">해결되지 않았나요? 네이버 톡톡으로 문의하기 →</a></div>'
    +'</div>';
    document.body.appendChild(panel);
  };
  window.cezFaqRefresh=function(){ var ex=document.getElementById('v4-faqpanel'); if(ex){ ex.remove(); window.V4openFaq(); } };

  /* ---------------- 픽커: 플로팅 패널 (#8) — 페이지 이동 없음, 실제 렌더러·내부 스크롤 ---------------- */
  var _pickPrev=null;
  window.V4openPicker=function(){
    /* 온보딩과 같은 썸네일 2장을 드로어 안 드롭다운으로 — 뒷화면을 가리지 않는다 */
    var btn=document.getElementById('v4-tplbtn');
    var ex=document.getElementById('v4-tpldrop'); if(ex){ ex.remove(); if(btn)btn.textContent='변경'; return; }
    if(btn)btn.textContent='완료';
    var d=data(); if(!d)return;
    var row=document.querySelector('.v4-tpl-row'); if(!row)return;
    var tpls=(DB.templates||[]).filter(function(t){ return t.visible!==false || t.id===d.template; });
    var cards=tpls.map(function(t){
      var prev=''; try{ prev=renderInvitation(sampleInvData(t.id)); }catch(e){ prev='<div style="padding:40px 12px;color:#aaa;font-size:12px">미리보기 없음</div>'; }
      return '<div class="v4-pick'+(d.template===t.id?' sel':'')+'" onclick="V4dropChoose(\''+t.id+'\')">'
        +'<div class="v4-pick-nm">'+esc(t.name)+'</div>'
        +'<div class="v4-pick-prev"><div class="v4-pick-prev-in">'+prev+'</div></div></div>';
    }).join('');
    var drop=document.createElement('div'); drop.id='v4-tpldrop';
    drop.innerHTML=cards;
    row.insertAdjacentElement('afterend',drop);
  };
  /* 템플릿 기본 표지 — 사용자가 올린 사진이 아니면(=기본 표지면) 템플릿에 맞는 기본 표지로 교체.
     카카오 메인 표지엔 이름·문구가 인쇄돼 있어 오버레이(coverNames/coverIntro) 억제. */
  var _DEF_COVERS=['luce-cover.jpg?v=4','luce-cover.png','kakao-cover.png','kakao-cover.png?v=6'];
  var _DEF_SUBS=['luce-gallery.jpg?v=3','luce-gallery.png','kakao-sub.png','kakao-sub.png?v=2','',null];
  function V4applyTplDefaults(d){
    if(!d||!d.template)return;
    var isK=(d.template==='kakao');
    /* 기본 표지일 때만 템플릿 기본 표지로 교체. 사용자가 올린 사진은 그대로 유지.
       표지가 실제로 바뀔 때만 크롭 리셋(레몬↔코튼처럼 같은 표지면 조정한 위치 유지). */
    if(d.cover==null || _DEF_COVERS.indexOf(d.cover)>=0){
      var _nc=isK?'kakao-cover.png?v=6':'luce-cover.jpg?v=4';
      if(d.cover!==_nc){ d.cover=_nc; d.coverCrop=null; }
    }
    if(d.subCoverImage==null || _DEF_SUBS.indexOf(d.subCoverImage)>=0){
      var _ns=isK?'kakao-sub.png?v=2':'luce-gallery.jpg?v=3';
      if(d.subCoverImage!==_ns){ d.subCoverImage=_ns; d.subCoverCrop=null; }
    }
  }
  window.V4applyTplDefaults=V4applyTplDefaults;
  window.V4dropChoose=function(id){
    var d=data(); if(!d)return;
    if(d.template!==id){
      d.template=id; V4applyTplDefaults(d); refreshCanvas(); scheduleSave();
      var cur=document.getElementById('v4-tpl-cur');
      if(cur){ var t=(DB.templates||[]).find(function(x){return x.id===id;}); cur.innerHTML=tplDot(id)+esc((t&&t.name)||id); }
    }
    /* 드롭다운 유지 — [완료] 버튼으로 닫는다. 선택 표시만 갱신 */
    try{
      var tpls=(DB.templates||[]).filter(function(t){ return t.visible!==false || t.id===d.template; });
      document.querySelectorAll('#v4-tpldrop .v4-pick').forEach(function(c,i){
        var cur=tpls[i]&&tpls[i].id===id;
        c.classList.toggle('sel',!!cur);
        var nm=c.querySelector('.v4-pick-nm');
        if(nm&&tpls[i]) nm.innerHTML=esc(tpls[i].name);
      });
    }catch(e){}
  };
  /* #2: 미리보기를 한 번이라도 스크롤하면 안내 영구 제거(세션 기준) */
  window.V4tplHintDone=function(){
    try{ if(sessionStorage.getItem('v4TplHint')==='1')return; sessionStorage.setItem('v4TplHint','1'); }catch(e){}
    document.querySelectorAll('.v4-tplhint').forEach(function(h){ h.remove(); });
  };
  window.V4pickTpl=function(id){
    var d=data(); if(!d)return; d.template=id; V4applyTplDefaults(d);
    refreshCanvas(); /* 뒤 메인 프리뷰 즉시 변경 */
    var cur=document.getElementById('v4-tpl-cur');
    if(cur){ var t=(DB.templates||[]).find(function(x){return x.id===id;}); cur.innerHTML=tplDot(id)+esc((t&&t.name)||id); }
    document.querySelectorAll('#v4-tplpanel .v4-tplcard').forEach(function(c){ c.classList.toggle('sel', c.getAttribute('data-tpl')===id); });
  };
  window.V4pickCancel=function(){ var d=data(); if(d&&_pickPrev!=null&&d.template!==_pickPrev){ d.template=_pickPrev; V4applyTplDefaults(d); refreshCanvas(); var cur=document.getElementById('v4-tpl-cur'); if(cur){ var t=(DB.templates||[]).find(function(x){return x.id===d.template;}); cur.innerHTML=tplDot(d.template)+esc((t&&t.name)||d.template); } } var p=document.getElementById('v4-tplpanel'); if(p)p.remove(); };
  window.V4pickOk=function(){ var d=data(); if(d&&_pickPrev!=null&&d.template!==_pickPrev){ scheduleSave(); } var p=document.getElementById('v4-tplpanel'); if(p)p.remove(); };
  window.V4choose=function(id){ var d=data(); if(d){ d.template=id; V4applyTplDefaults(d); scheduleSave(); } V4.mode='edit'; window.renderEditorV4(); };
  window.V4back=function(){ V4.mode='edit'; window.renderEditorV4(); };
  window.V4exit=function(){ go(isAdminPreview()?'#/admin':'#/editor'); };

  /* ── 온보딩 ── */
  function obView(u){
    ensureStyle();
    var d=u.data; V4.ob=V4.ob||{step:1};
    var st=V4.ob.step, TOTAL=3;
    var dots=''; for(var n=1;n<=TOTAL;n++){ dots+='<span style="width:8px;height:8px;border-radius:50%;background:'+(n<=st?'#3182f6':'#e0e0e0')+'"></span>'; }
    var body='';
    if(st===1){
      var tpls=(DB.templates||[]).filter(function(t){return t.visible!==false;});
      body='<div style="font-size:19px;font-weight:800;color:#262626">어떤 디자인으로 시작할까요?</div>'
        +'<div class="v4-note" style="margin-top:6px">나중에 바꿀 수 있어요.</div>'
        +'<div style="display:flex;gap:12px;margin-top:16px;justify-content:flex-start;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;padding-bottom:4px">'+tpls.map(function(t){
          var prev=''; try{ prev=renderInvitation(Object.assign({},sampleInvData(t.id),{template:t.id})); }catch(e){}
          return '<div class="v4-tplcard'+((d.template===t.id)?' sel':'')+'" style="flex:0 0 150px;min-width:150px;margin-top:0;scroll-snap-align:start" onclick="V4obTpl(\''+t.id+'\')">'
            +'<div class="v4-tplcard-nm" style="font-size:13px">'+tplDot(t.id)+esc(t.name)+'</div>'
            +'<div class="v4-tplcard-prev" style="height:240px"><div class="v4-ob-zoom" style="width:380px;transform:scale(.3947);transform-origin:0 0;pointer-events:none">'+prev+'</div></div></div>';
        }).join('')+'</div>';
    } else if(st===2){
      body='<div style="font-size:19px;font-weight:800;color:#262626">청첩장 주소를 정해 주세요</div>'
        +'<div class="v4-note" style="margin-top:6px">배포 전까지는 언제든 바꿀 수 있어요.<br>영문 소문자·숫자·하이픈만 입력 가능해요.&nbsp;<span style="white-space:nowrap">(3~30자)</span></div>'
        +'<div style="display:flex;align-items:center;gap:6px;margin-top:16px;font-family:var(--mono);font-size:13px;color:#888888">/i/'
          +'<input id="v4-ob-slug" value="'+esc(V4.ob.slug||'')+'" placeholder="doyoon-seoha" maxlength="30" style="flex:1;border:1px solid #e0e0e0;border-radius:10px;padding:12px;font-size:13px;font-family:var(--mono)" oninput="V4obSlug(this.value)"></div>'
        +'<div id="v4-ob-slugmsg" class="v4-note" style="margin-top:8px;min-height:18px">'+(V4.ob.slugMsg||'')+'</div>';
    } else {
      body='<div style="font-size:19px;font-weight:800;color:#262626">기본 정보를 알려주세요</div>'
        +'<div class="v4-note" style="margin-top:6px">나중에 에디터에서 언제든 수정할 수 있어요.</div>'
        +'<div style="display:flex;gap:10px;margin-top:14px"><div class="v4-fld" style="flex:1;margin-top:0"><label>신랑 이름 <span style="color:#e5484d">*</span></label><input id="v4-ob-g" value="'+esc(d.groomKo||'')+'" placeholder="예: 김도윤"></div>'
        +'<div class="v4-fld" style="flex:1;margin-top:0"><label>신부 이름 <span style="color:#e5484d">*</span></label><input id="v4-ob-b" value="'+esc(d.brideKo||'')+'" placeholder="예: 박서하"></div></div>'
        +'<div style="display:flex;gap:10px"><div class="v4-fld" style="flex:1"><label>신랑 영문 이름 <span style="color:#e5484d">*</span></label><input id="v4-ob-ge" value="'+esc(d.groomEn||'')+'" placeholder="예: Doyoon Kim"></div>'
        +'<div class="v4-fld" style="flex:1"><label>신부 영문 이름 <span style="color:#e5484d">*</span></label><input id="v4-ob-be" value="'+esc(d.brideEn||'')+'" placeholder="예: Seoha Park"></div></div>'
        +'<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start"><div class="v4-fld" style="flex:1.4 1 180px;min-width:180px"><label>예식 날짜</label><input type="date" id="v4-ob-date" value="'+esc(d.date||'')+'" style="min-width:0;white-space:nowrap"></div>'
        +'<div class="v4-fld" style="flex:1 1 110px;min-width:110px"><label>예식 시간</label><input type="time" id="v4-ob-time" value="'+esc(d.time||'')+'" style="min-width:0;white-space:nowrap"></div></div>'
        +'<div class="v4-fld"><label>예식 장소</label><input id="v4-ob-venue" value="'+esc(d.venueName||'')+'" placeholder="예: 더채플앳청담"></div>';
    }
    return '<div class="v4-body" style="align-items:center;justify-content:center;display:flex">'
      +'<div style="width:420px;max-width:92vw;background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.12);padding:26px 24px 22px;font-family:\'TossFace\',\'Pretendard\',sans-serif">'
        +'<div style="display:flex;gap:6px;margin-bottom:18px">'+dots+'</div>'
        +body
        +'<div style="display:flex;justify-content:space-between;margin-top:22px">'
          +(st>1?'<button type="button" class="v4-btn" onclick="V4obPrev()">이전</button>':'<span></span>')
          +'<button type="button" class="v4-btn v4-btn-primary" style="padding:10px 26px!important" onclick="V4obNext()">'+(st===TOTAL?'시작하기':'다음')+'</button>'
        +'</div>'
      +'</div></div>';
  }
  window.V4obTpl=function(id){ var d=data(); if(d){d.template=id; V4applyTplDefaults(d);} window.renderEditorV4();
    setTimeout(function(){ try{ var el=document.querySelector('.v4-tplcard.sel'); if(el&&el.scrollIntoView)el.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'}); }catch(e){} },40); };
  var _obSlugT;
  window.V4obSlug=function(v){
    V4.ob.slug=(v||'').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,30); var sf=document.getElementById('v4-ob-slug'); if(sf&&sf.value!==V4.ob.slug)sf.value=V4.ob.slug;
    V4.ob.slugOk=false;
    var msg=document.getElementById('v4-ob-slugmsg');
    if(!V4.ob.slug){ if(msg)msg.textContent=''; V4.ob.slugOk=false; return; }
    if(V4.ob.slug.length<3){ if(msg){ msg.textContent='3자 이상 입력해 주세요'; msg.style.color='#e5484d'; } V4.ob.slugOk=false; return; }
    if(msg){ msg.textContent='확인 중…'; msg.style.color='#888888'; }
    clearTimeout(_obSlugT);
    _obSlugT=setTimeout(function(){
      if(!(window.SB&&SB.checkSlugAvailable)){ if(msg){msg.textContent='연결 대기 중…';} return; }
      var cur=V4.ob.slug, done=false;
      var to=setTimeout(function(){ if(done)return; done=true; if(msg&&cur===V4.ob.slug){ msg.textContent='확인이 지연되고 있어요. 네트워크 확인 후 다시 입력해 주세요.'; msg.style.color='#e5484d'; } },8000);
      SB.checkSlugAvailable(cur).then(function(ok){
        if(done||cur!==V4.ob.slug)return; done=true; clearTimeout(to);
        V4.ob.slugOk=ok;
        if(msg){ msg.textContent=ok?'✓ 사용할 수 있는 주소예요':'✕ 이미 사용 중인 주소예요'; msg.style.color=ok?'#1f9d55':'#e5484d'; }
      }).catch(function(e){
        if(done)return; done=true; clearTimeout(to);
        console.error('[v4 ob] slug check 실패',e);
        if(msg&&cur===V4.ob.slug){ msg.textContent='확인에 실패했어요. 잠시 후 다시 입력해 주세요.'; msg.style.color='#e5484d'; }
      });
    },450);
  };
  window.V4obPrev=function(){ V4.ob.step=Math.max(1,V4.ob.step-1); window.renderEditorV4(); };
  window.V4obNext=function(){
    var u=inv(); var d=data(); if(!u||!d)return;
    var st=V4.ob.step;
    if(st===1){ if(!d.template){ alert('템플릿을 선택해 주세요.'); return; } }
    if(st===2){
      if(!V4.ob.slug||V4.ob.slug.length<3){ alert('주소는 3자 이상 입력해 주세요.'); return; }
      if(V4.ob.slugOk!==true){
        /* 자동 확인이 실패/지연됐어도 다음 버튼에서 즉시 재확인 */
        var m=document.getElementById('v4-ob-slugmsg');
        if(window.SB&&SB.checkSlugAvailable){
          if(m){ m.textContent='확인 중…'; m.style.color='#888888'; }
          SB.checkSlugAvailable(V4.ob.slug).then(function(ok){
            V4.ob.slugOk=ok;
            if(ok){ window.V4obNext(); }
            else if(m){ m.textContent='✕ 이미 사용 중인 주소예요'; m.style.color='#e5484d'; }
          }).catch(function(e){ console.error('[v4 ob] slug 재확인 실패',e); if(m){ m.textContent='주소 확인에 실패했어요. 네트워크 상태를 확인해 주세요.'; m.style.color='#e5484d'; } });
        } else { alert('서버 연결 대기 중이에요. 잠시 후 다시 시도해 주세요.'); }
        return;
      }
      u.slug=V4.ob.slug;
    }
    if(st===3){
      var g=document.getElementById('v4-ob-g'), b=document.getElementById('v4-ob-b');
      var dt=document.getElementById('v4-ob-date'), tm=document.getElementById('v4-ob-time'), vn=document.getElementById('v4-ob-venue');
      if(g)d.groomKo=g.value.trim(); if(b)d.brideKo=b.value.trim();
      var ge=document.getElementById('v4-ob-ge'), be=document.getElementById('v4-ob-be');
      d.groomEn=ge?ge.value.trim():(d.groomEn||''); d.brideEn=be?be.value.trim():(d.brideEn||'');
      if(!d.groomKo||!d.brideKo||!d.groomEn||!d.brideEn){ alert('신랑·신부 이름(국문·영문)을 모두 입력해 주세요.'); return; }
      /* 온보딩에 입력한 값만 반영 — 안 쓴 날짜/장소는 섹션 눈꺼짐 처리 */
      d.date=(dt&&dt.value)||''; if(tm&&tm.value)d.time=tm.value;
      d.venueName=(vn&&vn.value.trim())||''; if(d.venueName){ d.mapQuery=d.venueName; if(typeof V4geoFill==='function')V4geoFill(d.venueName); }
      try{ if(typeof defaultSectionsList==='function'){ d.sections=d.sections||defaultSectionsList();
        var _ss=function(id,on){ var s=d.sections.find(function(x){return x.id===id;}); if(s){ s.show=!!on; s.userOff=!on; } };
        _ss('when', !!d.date); _ss('where', !!d.venueName);
      } }catch(e){}
      V4.obDone=true; V4.obActive=false; scheduleSave(); window.renderEditorV4(); return;
    }
    V4.ob.step=st+1; window.renderEditorV4();
  };

  function pickerView(d){
    var tpls=(DB.templates||[]).filter(function(t){ return t.visible!==false || t.id===d.template; });
    var cards=tpls.map(function(t){
      var prev=''; try{ prev=renderInvitation(sampleInvData(t.id)); }catch(e){ prev='<div style="padding:40px 12px;color:#aaa;font-size:12px">미리보기 없음</div>'; }
      return '<div class="v4-pick'+(d.template===t.id?' sel':'')+'" onclick="V4choose(\''+t.id+'\')">'
        +'<div class="v4-pick-prev"><div class="v4-pick-prev-in">'+prev+'</div></div>'
        +'<div class="v4-pick-nm">'+esc(t.name)+(d.template===t.id?' <span class="v4-cur">현재</span>':'')+'</div></div>';
    }).join('');
    return '<div class="v4-body"><div class="v4-top">'
      +'<div class="l"><span onclick="V4back()" style="cursor:pointer">←</span> <span style="font-weight:700">템플릿 선택</span></div>'
      +'<div style="width:40px"></div></div>'
      +'<div class="v4-stage"><div class="v4-pick-grid">'+cards+'</div></div></div>';
  }

  function editorView(d){
    var u=inv();
    var slug=(u&&u.slug)||'';
    return '<div class="v4-body">'
      +'<div class="v4-top">'
        +'<div class="l">'+(isAdminPreview()?'<span onclick="V4exit()" class="v4-back" title="관리자로 돌아가기">←</span>':'')
          +'<b style="font-weight:800;letter-spacing:-.02em">CEZ</b>'
          +(function(){var a=(typeof cezArchState==='function')?cezArchState(d,u&&u.published):{state:'DRAFT'};var L={DRAFT:['제작중','#888888','#f2f2f2'],PUBLISHED:['공개중','#1f9d55','#e6f6ec'],ARCHIVE:['보관중','#b8892f','#fdf3df'],ADMIN_ARCHIVE:['관리자보관','#e5484d','#fdeaea']}[a.state]||['제작중','#888888','#f2f2f2'];return '<span class="v4-state" style="color:'+L[1]+';background:'+L[2]+';margin-left:8px">'+L[0]+'</span>';})()
          +'</div>'
        +'<div class="v4-topbtns">'
          +'<span id="v4-badge" class="v4-badge"></span>'
          +'<button type="button" class="v4-tbtn" onclick="V4saveNow()">저장하기</button>'
          +(isAdminPreview()?'<button type="button" class="v4-tbtn" id="v4-proxybtn" onclick="V4toggleProxy()" title="회원 청첩장에 실제 저장하는 CS용 모드">대리 편집 활성화</button>':'')
          +'<button type="button" class="v4-iconbtn" onclick="V4fullPv(true)" aria-label="전체화면 미리보기" title="전체화면 미리보기"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>'
          +'<button type="button" class="v4-tbtn" onclick="V4qr()">QR</button>'
          +'<button type="button" class="v4-iconbtn" onclick="V4toggleDrawer()" aria-label="설정">☰</button></div>'
      +'</div>'
      +'<div class="v4-stage"><div class="v4-phone"><div id="v4-canvas">'+((V4.pvMode==='post'&&typeof renderThankYouPreview==='function')?renderThankYouPreview(d):renderInvitation(d))+'</div></div></div>'
      +'<div class="v4-pvdock v4-pvmode"><button type="button" class="'+(V4.pvMode!=='post'?'on':'')+'" onclick="V4pv(\'live\')">예식 전</button><button type="button" class="'+(V4.pvMode==='post'?'on':'')+'" onclick="V4pv(\'post\')">예식 후</button></div>'
      +'<button type="button" class="v4-faqbtn" onclick="V4openFaq()"><span class="v4-faq-q">?</span>자주 묻는 질문</button>'
      +'<div class="v4-scrim" id="v4-scrim" onclick="V4closeDrawer()"></div>'
      +'<div class="v4-drawer" id="v4-drawer">'+drawerInner(d)+'</div>'
    +'</div>';
  }
  window.V4preview=function(){
    var u=inv();
    if(u&&u.slug&&typeof pubURL==='function'){ window.open(pubURL(u.slug),'_blank','noopener'); }
    else { alert('공개 주소가 아직 없어요. ☰ → 공개 설정에서 정해 주세요.'); }
  };
  window.V4copy=function(){ var u=inv(); if(!u||!u.slug){ alert('공개 주소를 먼저 정해 주세요. (☰ → 공개 설정)'); return; } if(typeof copyURL==='function'){ try{ copyURL(); }catch(e){} } };
  window.V4qr=function(){ var u=inv(); if(!u||!u.slug){ alert('공개 주소를 먼저 정해 주세요. (☰ → 공개 설정)'); return; } if(typeof openQRModal==='function'){ try{ openQRModal(); }catch(e){} } else { alert('QR 기능을 불러오지 못했어요.'); } };
  /* 공개 중 / 공개 후(종료) 화면 전환 — 기존 renderThankYouPreview 재사용(공개 종료 페이지 확인) */
  /* 전체보기 — 편집 UI 숨기고 하객 시점 미리보기 */
  window.V4fullPv=function(on){
    V4.fullPv=!!on;
    if(V4.fullPv){
      /* 전체보기 진입 전 사이드바 상태 기억 → 편집 복귀 시 그대로 복원 */
      var _dr=document.getElementById('v4-drawer');
      V4._drawerWasOpen=!!(_dr&&_dr.classList.contains('open'));
      if(typeof window.V4closeDrawer==='function') V4closeDrawer();
    }
    document.body.classList.toggle('v4-fullpv',V4.fullPv);
    var x=document.getElementById('v4-fullpv-exit');
    if(V4.fullPv && !x){
      var b=document.createElement('button'); b.type='button'; b.id='v4-fullpv-exit';
      b.innerHTML='<span style="margin-right:10px">✕</span>편집으로 돌아가기'; b.onclick=function(){ window.V4fullPv(false); };
      document.body.appendChild(b);
    } else if(!V4.fullPv && x){ x.remove(); }
    refreshCanvas();
    /* 편집 복귀: 진입 전 열려 있었으면 다시 열고, 닫혀 있었으면 그대로 둠 */
    if(!V4.fullPv && V4._drawerWasOpen && typeof window.V4openDrawer==='function'){ window.V4openDrawer(); V4._drawerWasOpen=false; }
  };
  window.V4pv=function(mode){
    V4.pvMode=mode; refreshCanvas();
    var btns=document.querySelectorAll('.v4-pvmode button');
    if(btns[0]) btns[0].classList.toggle('on',mode!=='post');
    if(btns[1]) btns[1].classList.toggle('on',mode==='post');
    /* 편집 패널도 예식 전/후에 맞게 스왑 */
    var dr=document.getElementById('v4-drawer'); if(dr){ try{ dr.innerHTML=drawerInner(data()); }catch(e){} }
  };

  function ensureQRLib(){
    if(typeof QRCode!=='undefined'||document.getElementById('v4-qrlib'))return;
    /* v4.5: 셀프호스팅(기존 1.5.3 CDN 경로는 번들 미포함 404 — QR이 아예 동작 안 하던 원인) */
    var sc=document.createElement('script'); sc.id='v4-qrlib';
    sc.src='/vendor-qrcode.js';
    sc.onerror=function(){ var f=document.createElement('script'); f.src='https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js'; document.head.appendChild(f); };
    document.head.appendChild(sc);
  }
  window.renderEditorV4=function(){
    ensureStyle(); ensureQRLib();
    /* 전체보기 상태는 전체 재렌더 시 해제 (라우트 이탈 잔존 방지) */
    if(V4.fullPv){ V4.fullPv=false; document.body.classList.remove('v4-fullpv'); var _fx=document.getElementById('v4-fullpv-exit'); if(_fx)_fx.remove(); }
    var u=inv();
    if(!u){ app().innerHTML='<div style="padding:60px 24px;text-align:center;color:#888">편집할 청첩장이 없습니다.</div>'; return; }
    if(!u.data) u.data=blankData();
    /* v4.4: 구 디폴트 갤러리(샘플 4장) 자동 제거 — 사용자가 넣은 적 없는 사진 */
    if(Array.isArray(u.data.gallery)&&u.data.gallery.join(',')==='02.jpg,03.jpg,04.jpg,06.jpg'){ u.data.gallery=[]; }
    /* v4.4: 구 템플릿(minimal 등)은 에디터에서 Lemon Archive로 마이그레이션(하객 렌더 보존과 별개) */
    if(u.data.template && u.data.template!=='luce' && u.data.template!=='cotton' && u.data.template!=='kakao'){ u.data.template='luce'; }
    /* 보관 정책: 예식+6개월(ADMIN_ARCHIVE)은 작성자도 접근 불가 — 관리자만 */
    if(typeof cezArchState==='function' && !isAdminPreview()){
      var _a=cezArchState(u.data,u.published);
      if(_a.state==='ADMIN_ARCHIVE'){
        app().innerHTML='<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px;text-align:center;font-family:Pretendard,sans-serif"><div><div style="font-size:20px;font-weight:700;color:#262626;margin-bottom:12px">보관이 종료된 청첩장입니다</div><div style="font-size:14px;color:#888888;line-height:1.7">예식 후 6개월이 지나 관리자 보관 상태로 전환되었습니다.<br>열람이나 복구가 필요하시면 관리자에게 문의해 주세요.</div></div></div>';
        return;
      }
    }
    /* v4.4 P2: 신규 사용자 온보딩 — 템플릿 → 주소 → 기본 정보(이름·일시·장소)
       obActive: 진행 중 slug가 세팅돼도 온보딩이 끊기지 않게(스텝 스킵 버그 픽스) */
    if(!isAdminPreview() && !V4.obDone && (V4.obActive || (!u.slug && !u._supabaseRowId))){
      V4.obActive=true; app().innerHTML=obView(u);
      requestAnimationFrame(function(){ document.querySelectorAll('.v4-ob-zoom').forEach(function(z){
        var w=z.parentElement.clientWidth; if(w<=20)return;
        var s=w/380; z.style.transform='scale('+s+')'; z.style.transformOrigin='0 0';
        var hh=z.scrollHeight; if(hh>0) z.style.marginBottom=(-hh*(1-s))+'px'; /* transform은 레이아웃 높이를 안 줄이므로 보정 */
      }); });
      return;
    }
    if(V4.mode==='pick' || !u.data.template){ app().innerHTML=pickerView(u.data); return; }
    app().innerHTML=editorView(u.data);
    /* 토스 결제 복귀: 승인 완료(paid=1) → 프로필 갱신 후 자동 배포 */
    try{
      var _qs=new URLSearchParams(location.search);
      if(_qs.get('paid')==='1'){
        history.replaceState(null,'',location.pathname+location.hash);
        if(typeof toast==='function') toast('결제 완료! 이제 [바로 공개하기]로 공개할 수 있어요.');
        Promise.resolve(SB&&SB._loadProfile?SB._loadProfile():null).then(function(){
          var _u=inv(); if(_u){ _u.tier='PAID'; _u.publishPermission=true; _u.paymentStatus='PAID'; }
          try{ rebuildPublishCard(); }catch(e){}
          try{ if(window.innerWidth>=1024 && !V4.drawerUserClosed) V4openDrawer(); }catch(e){}
        });
      } else if(_qs.get('payfail')){
        var _pf=_qs.get('payfail');
        history.replaceState(null,'',location.pathname+location.hash);
        if(_pf!=='cancel' && typeof toast==='function') toast('결제가 완료되지 않았어요: '+_pf);
      }
    }catch(e){}
    /* PC: 사이드바 기본 도킹(딤 없음). ☰로 닫으면 유지 */
    if(window.innerWidth>=1024 && !V4.drawerUserClosed){ try{ window.V4openDrawer(); }catch(e){} }
    var c=document.getElementById('v4-canvas');
    if(V4.pvMode!=='post'){ decorate(c,u.data); } else { decoratePost(c,u.data); }
  };

  /* ---------------- 스타일 ---------------- */
  function ensureStyle(){
    if(document.getElementById('v4-style'))return;
    var css=[
      /* TossFace는 이모지 코드포인트에만(unicode-range) — 숫자·문자는 Pretendard(회색 이모지 숫자 방지) */
      '@font-face{font-family:"TossFace";src:url("/fonts/tossface.ttf") format("truetype");font-display:swap;unicode-range:U+200D,U+2049,U+20E3,U+2122,U+2139,U+2194-21AA,U+2300-23FF,U+24C2,U+25AA-27BF,U+2934-2935,U+2B00-2BFF,U+3030,U+303D,U+3297,U+3299,U+FE0F,U+1F000-1FAFF}',
      /* Toss Face: 이모지 코드포인트만 Toss 아이콘으로 렌더, 텍스트는 폴백. 에디터에서만 로드 */
      '.v4-body,.v4-pop{font-family:"TossFace","Pretendard",var(--sans),system-ui,sans-serif}',
      '.v4-body{position:fixed;inset:0;background:#f1f1f1;z-index:45;display:flex;flex-direction:column}',
      '.v4-top{height:54px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:#fff;border-bottom:1px solid #e4e4e4}',
      '.v4-top .l{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;color:#262626}',
      '.v4-beta{font-size:12px;color:#b8892f;border:1px solid #f0d9a8;background:#fff8ec;border-radius:6px;padding:1px 6px;font-weight:700;letter-spacing:.04em}',
      '.v4-badge{font-size:12px;min-width:58px;text-align:right;color:#888888}',
      '.v4-badge.saving{color:#b8892f}.v4-badge.saved{color:#1f9d55}.v4-badge.error{color:#e5484d;font-weight:700}',
      /* 상단 액션 버튼 통일: 38px 높이 · 동일 radius */
      '.v4-iconbtn{width:38px;height:38px;border:1px solid #e4e4e4;background:#fff;border-radius:10px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}',
      '.v4-iconbtn:hover{background:#f5f5f5}',
      '.v4-back{cursor:pointer;font-size:18px;margin-right:2px}',
      '.v4-state{flex:0 0 auto;font-size:12px;font-weight:700;border-radius:6px;padding:4px 8px;letter-spacing:-.01em;white-space:nowrap}',
      '.v4-slug{font-size:12px;color:#888888;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34vw}',
      '.v4-slug:hover{color:#3182f6}',
      '.v4-topbtns{display:flex;align-items:center;gap:10px;flex:0 0 auto}',
      '.v4-tbtn{border:1px solid #e4e4e4;background:#fff;border-radius:10px;height:38px;padding:0 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}',
      '.v4-tbtn:hover{border-color:#3182f6;color:#3182f6}',
      '.v4-selected{outline:2px solid #3182f6 !important;outline-offset:10px;border-radius:6px}',
      '@media(max-width:600px){.v4-slug{display:none}.v4-tbtn{padding:8px 10px}.v4-top{padding:0 10px}.v4-topbtns{gap:6px}.v4-fld input,.v4-fld textarea,#v4-ob-slug,#v4-ob-date,#v4-ob-time,#v4-ob-g,#v4-ob-b,#v4-ob-ge,#v4-ob-be,#v4-ob-venue{font-size:16px!important}}',
      '.v4-stage{flex:1;overflow-x:hidden;overflow-y:auto;display:flex;justify-content:center;padding:26px 16px 90px;background:#222222}',
      /* 편집기 프리뷰의 네이버 지도는 비대화 — 편집 중 실수 터치로 네이버 법적공지로 이탈 방지. 하객 화면(#v4-canvas 밖)은 그대로 동작 */
      '#v4-canvas .cez-nmap{pointer-events:none}',
      /* 단, "전체 미리보기(full preview)"에서는 하객처럼 지도 동작 */
      'body.v4-fullpv #v4-canvas .cez-nmap{pointer-events:auto}',
      /* #8: 실제 배포 화면(.pub-paper 480px)과 동일 폭 — WYSIWYG 픽셀 일치 */
      '.v4-phone{width:380px;max-width:calc(100vw - 32px);background:#fff;box-shadow:0 22px 60px rgba(0,0,0,.16);overflow:hidden;align-self:flex-start}',
      /* inline text */
      '.v4-edit-text{outline:1.5px dashed transparent;outline-offset:2px;border-radius:4px;cursor:text;transition:outline-color .12s,background .12s;min-width:1em}',
      '.v4-edit-text:hover{outline-color:#5b9dff;background:rgba(91,157,255,.06)}',
      '.v4-edit-text:focus{outline:2px solid #3182f6;background:#fff}',
      '.v4-edit-text:empty:before{content:attr(data-ph);color:#bcbcbc}',
      /* image */
      '.v4-img-edit{position:relative;cursor:pointer}',
      '.v4-img-edit:after{content:"📷 사진 변경";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.34);color:#fff;font-size:13px;font-weight:600;opacity:0;transition:opacity .15s}',
      '.v4-img-edit:hover:after{opacity:1}',
      '@media(hover:none){.v4-edit-text{outline-color:rgba(91,157,255,.45)}.v4-img-edit:after{opacity:.85}}',
      /* scrim + drawer */
      '.v4-scrim{position:fixed;inset:0;background:rgba(0,0,0,.32);opacity:0;pointer-events:none;transition:opacity .2s;z-index:55}',
      '.v4-scrim.open{opacity:1;pointer-events:auto}',
      '.v4-drawer{position:fixed;top:0;right:0;bottom:0;width:340px;max-width:88vw;background:#fff;box-shadow:-10px 0 34px rgba(0,0,0,.14);transform:translateX(100%);transition:transform .22s;z-index:60;display:flex;flex-direction:column}',
      '.v4-drawer.open{transform:none}',
      '.v4-drawer-head{flex:0 0 auto;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid #eee;font-size:15px}',
      '.v4-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:#888}',
      '.v4-drawer-body{flex:1;overflow:auto;padding:14px 16px 40px}',
      '.v4-grp{font-size:15px;font-weight:800;letter-spacing:-.01em;color:#222222;margin:16px 0 8px}',
      '.v4-tpl-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;color:#262626;padding:4px 2px}',
      '.v4-btn{border:1px solid #d6d6d6;background:#fff;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer}',
      '.v4-btn:hover{border-color:#3182f6;color:#3182f6}',
      '.v4-btn-primary{background:#3182f6!important;color:#fff!important;border-color:#3182f6!important;padding:11px!important}',
      '.v4-btn-primary:hover{background:#1f6fe0!important}',
      '.v4-btn-danger{background:#fff!important;color:#e5484d!important;border-color:#f3c9cb!important;padding:11px!important}',
      '.v4-btn-danger:hover{background:#fff4f4!important}',
      '.v4-sec{border:1px solid #ececec;border-radius:12px;margin-bottom:8px;overflow:hidden;background:#fff}',
      '.v4-sec.off{opacity:.55}',
      '.v4-sec-head{display:flex;align-items:center;gap:8px;padding:10px 11px;user-select:none;-webkit-user-select:none}',
      '.v4-sec-grip{cursor:grab;color:#8a8a8a;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;display:inline-flex;align-items:center;justify-content:center;touch-action:none;padding:11px 13px;margin:-5px -3px -5px -7px;border-radius:7px;min-width:24px}',
      '.v4-sec-grip:active{background:#ececec;cursor:grabbing}',
      '.v4-sec-grip:hover{background:#f4f4f4}',
      '.v4-sec-name{flex:1;font-size:13px;font-weight:600;color:#262626;cursor:pointer}',
      '.v4-eye{border:0;background:transparent;cursor:pointer;font-size:15px;padding:2px}',
      '.v4-tpldot{display:inline-block;width:13px;height:13px;border:1px solid rgba(0,0,0,.15);vertical-align:-2px;margin-right:7px}',
      '.v4-vis{border:0;background:#e4e4e4;color:#888888;width:28px;height:24px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;padding:0}',
      '.v4-vis:hover{background:#d6d6d6}',
      '.v4-vis.on{background:#e6f6ec;color:#1f9d55}',
      '.v4-vis.on:hover{background:#d6efdf}',
      '.v4-exp{cursor:pointer;color:#b0b0b0;transition:transform .18s;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px}',
      '.v4-sec.open .v4-exp{transform:rotate(180deg)}',
      '.v4-sec-body{padding:0 12px 12px;display:none}',
      '.v4-sec.open .v4-sec-body{display:block}',
      '.v4-fld{margin-top:10px}',
      '.v4-fld label{display:block;font-size:12px;color:#888888;margin-bottom:5px;font-weight:600}',
      '.v4-fld input,.v4-fld textarea{width:100%;border:1px solid #e0e0e0;border-radius:9px;padding:10px 11px;font-size:13px;font-family:inherit;box-sizing:border-box}',
      '.v4-fld input:focus,.v4-fld textarea:focus{outline:none;border-color:#3182f6}',
      '.v4-fld textarea{resize:vertical;line-height:1.6}',
      '.v4-note{font-size:12px;color:#9e9e9e;margin-top:8px;line-height:1.5}',
      '.v4-gwrap{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
      '.v4-gwrap.v4-galdrag{touch-action:none}',
      '.v4-gwrap.v4-galdrag .v4-gthumb{cursor:grabbing}',
      '.v4-gthumb{position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid #eee;cursor:grab;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}',
      '.v4-gthumb:active{cursor:grabbing}',
      '.v4-gthumb img{-webkit-user-drag:none;pointer-events:none}',
      '.v4-gthumb.v4-gdragging{opacity:.4}',
      '.v4-gthumb.v4-gover{box-shadow:-8px 0 0 0 rgba(49,130,246,.35)}',
      /* 공용 Sortable 드래그 UX */
      '.cez-ins-before,.cez-ins-after{position:relative}',
      '.cez-ins-before::before,.cez-ins-after::before{content:"";position:absolute;background:#3182f6;z-index:6;border-radius:2px;box-shadow:0 0 4px rgba(49,130,246,.9)}',
      '.v4-gthumb.cez-ins-before::before{left:0;top:0;bottom:0;width:4px}',
      '.v4-gthumb.cez-ins-after::before{right:0;top:0;bottom:0;width:4px}',
      '.cez-src{position:relative}',
      '.cez-src::after{content:"";position:absolute;inset:0;border:1.6px dashed #b9c0cc;border-radius:inherit;background:#f4f6f9;z-index:5;pointer-events:none}',
      '.cez-nosel,.cez-nosel *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}',
      '[data-sortable].cez-sorting{touch-action:none}',
      '.v4-sec.cez-ins-before::before{top:0;left:0;right:0;height:3px}',
      '.v4-sec.cez-ins-after::before{bottom:0;left:0;right:0;height:3px}',
      '.v4-ghint{width:100%;font-size:11px;color:#9e9e9e;margin-top:6px;display:flex;align-items:center;gap:5px}',
      '.v4-gthumb img{width:100%;height:100%;object-fit:cover;display:block}',
      '.v4-gthumb button{position:absolute;top:2px;right:2px;width:18px;height:18px;border:0;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:10px;cursor:pointer;line-height:1}',
      '.v4-gadd{width:64px;height:64px;border:1px dashed #cccccc;border-radius:8px;background:#fafafa;font-size:22px;color:#b0b0b0;cursor:pointer}',
      '.v4-gadd:hover{border-color:#3182f6;color:#3182f6}',
      /* picker */
      '.v4-pick-grid{display:flex;gap:16px;overflow-x:auto;padding:22px 20px;align-items:flex-start}',
      '.v4-pick{flex:0 0 156px;border:1px solid #e4e4e4;border-radius:14px;overflow:hidden;background:#fff;cursor:pointer;transition:box-shadow .15s}',
      '.v4-pick:hover{box-shadow:0 8px 22px rgba(0,0,0,.1)}',
      '.v4-pick.sel{outline:2px solid #3182f6;outline-offset:-1px}',
      '.v4-pick-prev{height:236px;overflow:hidden;pointer-events:none;background:#fafafa;border-bottom:1px solid #eee}',
      '.v4-pick-prev-in{width:380px;transform:scale(.41);transform-origin:top left;pointer-events:none}',
      '.v4-pick-nm{padding:11px 13px;font-size:13px;font-weight:600;color:#262626;display:flex;align-items:center;gap:6px}',
      '#v4-tpldrop{display:flex;gap:10px;margin-top:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;padding-bottom:4px}',
      '#v4-tpldrop .v4-pick{flex:0 0 124px;min-width:124px;scroll-snap-align:start}',
      '#v4-tpldrop .v4-pick-prev{height:207px;border-bottom:0;overflow:hidden;pointer-events:none;background:#fff}',
      '#v4-tpldrop .v4-pick-prev-in{transform:scale(.326);transform-origin:top left;pointer-events:none}',
      '#v4-tpldrop .v4-pick-nm{border-bottom:1px solid #f0f0f0;white-space:nowrap;overflow:hidden}',
      '.v4-cur{font-size:12px;color:#3182f6;border:1px solid #cfe0ff;background:#f0f6ff;border-radius:5px;padding:1px 5px}',
      /* Empty State placeholder (프리뷰 내부) */
      '.v4-ph-sec{padding:34px 22px;text-align:center;cursor:pointer;border:1px dashed rgba(120,120,110,.4);border-radius:12px;margin:18px 22px;background:rgba(255,255,255,.4)}',
      '.v4-ph-title{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a3a3a3}',
      '.v4-ph-hint{margin-top:8px;font-size:13px;color:#8a8a8a}',
      /* BGM */
      '.v4-mrow{padding:9px 11px;border:1px solid #ececec;border-radius:9px;margin-top:6px;font-size:13px;cursor:pointer;color:#444}',
      '.v4-mrow:hover{border-color:#3182f6}',
      '.v4-mrow.sel{background:#eef5ff;border-color:#3182f6;color:#1a63d6;font-weight:600}',
      '.v4-mchip{position:fixed;left:16px;bottom:18px;z-index:50;border:1px solid #e4e4e4;background:#fff;border-radius:9999px;padding:9px 16px;font-size:13px;font-weight:600;color:#444;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.12)}',
      '.v4-mchip:hover{border-color:#3182f6;color:#3182f6}',
      '@media(min-width:1024px){ .v4-scrim{display:none!important} body.v4-dock .v4-stage{margin-right:340px} body.v4-dock .v4-top{padding-right:354px} body.v4-dock .v4-pvdock{right:356px} .v4-stage,.v4-top{transition:margin .22s,padding .22s} }',
      /* 전체보기 모드 */
      '.v4-fullpv .v4-top,.v4-fullpv .v4-mchip,.v4-fullpv .v4-faqbtn,.v4-fullpv .v4-pvdock{display:none!important}',
      '#v4-fullpv-exit{position:fixed;top:14px;right:14px;z-index:70;border:1px solid #e0e0e0;background:rgba(255,255,255,.95);border-radius:9999px;padding:9px 18px;font-size:13px;font-weight:700;color:#444;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.15)}',
      /* 공개 중/후 토글 — 하단 독 (음악 칩·FAQ 버튼과 동일 톤) */
      '.v4-pvdock{position:fixed;right:16px;bottom:18px;z-index:50;display:inline-flex;background:#4d4d4d;border-radius:6px;padding:3px;box-shadow:0 4px 14px rgba(0,0,0,.15)}',
      '.v4-pvdock button{border:0;background:transparent;padding:6px 14px;font-size:12px;font-weight:500;color:rgba(255,255,255,.6);cursor:pointer;line-height:1.2;border-radius:5px}',
      '.v4-pvdock button.on{background:#fff;color:#000}',
      /* 기존 폼 섹션(RSVP 등) 드로어 임베드 정리 */
      '.v4-embed .ed-section{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;margin:0!important}',
      '.v4-embed .ed-section > h2{display:none!important}',
      '.v4-embed .sec-help{font-size:12px;color:#9e9e9e;margin:6px 0 10px}',
      '.v4-embed .tablecard{overflow-x:auto}',
      '.v4-embed table{font-size:12px}',
      /* RSVP 통계 모바일 폭(#5): 2열·큰 숫자·넘침 없음 */
      '.v4-embed .rsvp-stats{grid-template-columns:1fr 1fr!important;gap:10px!important;margin:12px 0!important}',
      '.v4-embed .rsvp-stat{padding:14px 12px!important}',
      '.v4-embed .rsvp-stat .v{font-size:26px!important;line-height:1.1}',
      '.v4-embed .rsvp-stat .k{font-size:11px!important}',
      '.v4-embed .rsvp-side-split{grid-template-columns:1fr 1fr!important}',
      /* 인라인 팝오버 */
      '.v4-click{cursor:pointer;border-radius:5px;transition:background .12s;min-height:1em}',
      '.v4-click:hover{background:rgba(91,157,255,.12);outline:1px dashed #5b9dff;outline-offset:2px}',
      '.v4-click:empty:before{content:attr(data-ph-empty);color:#b3b3b3;font-style:normal}',
      '.v4-inlinebtn{display:block;margin:14px auto 0;border:1px dashed #cccccc;background:rgba(255,255,255,.5);border-radius:9px;padding:9px 14px;font-size:13px;font-weight:600;color:#888888;cursor:pointer;font-family:var(--sans,system-ui)}',
      '.v4-inlinebtn:hover{border-color:#3182f6;color:#3182f6}',
      '.v4-gal-addcell{aspect-ratio:110/147;border:1.5px dashed #b3b3b3;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#999999;background:rgba(255,255,255,.35);cursor:pointer;font-family:"TossFace","Pretendard",var(--sans,system-ui)}',
      '.v4-gal-addcell span{font-size:18px;line-height:1}',
      '.v4-gal-addcell em{font-style:normal;font-size:12px;margin-top:4px}',
      '.v4-gal-addbar{margin-top:8px;border:1.5px dashed #b3b3b3;display:flex;align-items:center;justify-content:center;gap:7px;color:#999999;background:rgba(255,255,255,.35);cursor:pointer;padding:13px 0;font-family:"TossFace","Pretendard",var(--sans,system-ui)}',
      '.v4-gal-addbar span{font-size:16px;line-height:1}',
      '.v4-gal-addbar em{font-style:normal;font-size:12px}',
      '.v4-gal-addcell:hover{border-color:#3182f6;color:#3182f6}',
      '.v4-gal-addbar{display:block;margin:14px 25px 0;width:calc(100% - 50px);border:1.5px dashed #b3b3b3;background:rgba(255,255,255,.4);padding:11px;font-size:13px;color:#999999;cursor:pointer;font-family:"TossFace","Pretendard",sans-serif}',
      '.v4-gal-addbar:hover{border-color:#3182f6;color:#3182f6}',
      '.v4-cthumb{position:relative;aspect-ratio:4/3;border-radius:10px;overflow:hidden;border:1px solid #e4e4e4;cursor:pointer;background:#f2f2f2}',
      '.v4-cthumb img{width:100%;height:100%;object-fit:cover;display:block}',
      '.v4-cthumb-grain{position:absolute;inset:0;background:url(/grain.png) center/cover;mix-blend-mode:overlay;opacity:.5;pointer-events:none}',
      '.v4-cthumb-edit{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;padding:3px 8px;border-radius:6px}',
      '.v4-popscrim{position:fixed;inset:0;z-index:70;background:transparent}',
      '.v4-pop{position:fixed;z-index:71;background:#fff;border:1px solid #e4e4e4;border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.2);padding:6px 14px 14px;font-family:var(--sans,system-ui)}',
      '.v4-pop-head{display:flex;align-items:center;justify-content:space-between;padding:8px 0 6px}',
      '.v4-pop-head b{font-size:13px;color:#262626}',
      '.v4-pop-body .v4-fld{margin-top:10px}',
      /* 템플릿 플로팅 패널 (#8) */
      '.v4-tplpanel{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);padding:18px}',
      '.v4-tplpanel-in{background:#fff;border-radius:18px;width:360px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.25);font-family:"TossFace","Pretendard",var(--sans),sans-serif}',
      '.v4-tplpanel-list{flex:1;overflow-y:auto;padding:4px 16px 8px}',
      '.v4-tplcard{border:1.5px solid #ececec;border-radius:14px;overflow:hidden;margin-top:12px;cursor:pointer;transition:border-color .12s}',
      '.v4-tplcard.sel{border-color:#3182f6;box-shadow:0 0 0 3px rgba(49,130,246,.15)}',
      '.v4-tplcard-nm{padding:11px 14px;font-size:13px;font-weight:700;color:#262626;display:flex;align-items:center;gap:6px;border-bottom:1px solid #f2f2f2}',
      '.v4-tplcard-prev{height:300px;overflow:hidden;background:#fafafa}',
      /* 미리보기 렌더 폭 = 실제 배포 화면(480px)과 동일, zoom으로 카드 폭(~326px)에 맞춤 */
      '.v4-tplcard-zoom{width:380px;zoom:.85;pointer-events:none}',
      '.v4-tplpanel-foot{flex:0 0 auto;display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #f0f0f0}',
      /* #2: 픽커 스크롤 안내 (1회 스크롤 시 제거) */
      '.v4-tplhint{position:sticky;bottom:0;left:0;right:0;padding:26px 0 12px;text-align:center;font-size:12px;font-weight:600;color:#fff;background:linear-gradient(180deg,transparent,rgba(0,0,0,.45));pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.4)}',
      /* #6: 계좌 동적 아이템 */
      '.v4-acct-item{border:1px solid #ececec;border-radius:12px;padding:12px;margin-top:10px}',
      '.v4-acct-grip{cursor:grab;color:#c0c0c0;display:inline-flex;align-items:center;flex:0 0 auto;padding:2px;touch-action:none}',
      '.v4-acct-side{display:flex;gap:6px;margin-top:8px}',
      '.v4-acct-side button{flex:1;padding:7px 0;border:1px solid #e0e0e0;background:#fff;border-radius:8px;font-size:12px;font-weight:600;color:#8a8a8a;cursor:pointer;font-family:inherit}',
      '.v4-acct-side button.on{border-color:#3182f6;background:#eef5ff;color:#1f6feb}',
      '.v4-fori{display:flex;gap:6px}',
      '.v4-fori button{flex:1;padding:8px 0;border:1px solid #e0e0e0;background:#fff;border-radius:8px;font-size:12.5px;font-weight:600;color:#8a8a8a;cursor:pointer;font-family:inherit}',
      '.v4-fori button.on{border-color:#3182f6;background:#eef5ff;color:#1f6feb}',
      '.v4-acct-grouptog{display:flex;align-items:center;gap:8px;margin:2px 0 4px;font-size:12.5px;color:#555;cursor:pointer;user-select:none}',
      '.v4-acct-grouptog input{width:16px;height:16px;flex:0 0 auto;accent-color:#3182f6}',
      '.v4-acct-item.cez-ins-before::before{top:-3px;left:0;right:0;height:3px}',
      '.v4-acct-item.cez-ins-after::before{bottom:-3px;left:0;right:0;height:3px}',
      '.v4-acct-rel{flex:1;border:0;border-bottom:1px solid #e0e0e0;padding:8px 4px;font-size:13px;font-weight:700;color:#262626;font-family:inherit}',
      '.v4-acct-rel:focus{outline:none;border-bottom-color:#3182f6}',
      '.v4-acct-del{flex:0 0 auto;width:26px;height:26px;border:1px solid #eee;background:#fff;border-radius:8px;color:#e5484d;cursor:pointer;font-size:11px;line-height:1}',
      '.v4-cropview{position:relative;width:100%;aspect-ratio:254/159;overflow:hidden;background:#eee;border-radius:8px;touch-action:none;cursor:grab}',
      '.v4-cropview:active{cursor:grabbing}',
      '.v4-cropview img{width:100%;height:100%;object-fit:cover;transform-origin:center;pointer-events:none;user-select:none}',
      /* FAQ 플로팅 버튼·패널 */
      '.v4-faqbtn{position:fixed;left:16px;bottom:18px;z-index:50;display:inline-flex;align-items:center;gap:6px;border:0;background:#f2f2f2;color:#222222;border-radius:6px;padding:8px 12px;font-size:12px;font-weight:400;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.1);font-family:inherit}',
      '.v4-faqbtn .v4-faq-q{font-size:13px;color:#222222;font-weight:400}',
      '.v4-faqbtn:hover{background:#e8e8e8}',
      '.v4-faqbtn:hover{border-color:#3182f6;color:#3182f6}',
      '.v4-faq-item{border:1px solid #ececec;border-radius:12px;margin-top:8px;background:#fff;overflow:hidden}',
      '.v4-faq-item summary{list-style:none;cursor:pointer;padding:13px 14px;font-size:13px;font-weight:600;color:#262626;display:flex;justify-content:space-between;align-items:center}',
      '.v4-faq-item summary::-webkit-details-marker{display:none}',
      '.v4-faq-item summary::after{content:"+";color:#b0b0b0;font-weight:400;font-size:16px}',
      '.v4-faq-item[open] summary::after{content:"−"}',
      '.v4-faq-a{padding:0 14px 14px;font-size:13px;line-height:1.75;color:#555555}',
      /* 할인코드 드롭다운 */
      '.v4-disc-dd summary{list-style:none}',
      '.v4-disc-dd summary::-webkit-details-marker,.v4-disc-dd summary::marker{display:none;content:""}',
      '.v4-disc-dd[open] .v4-disc-caret{transform:rotate(180deg)}',
      '.v4-disc-caret{transition:transform .15s}',
      /* ═══ v4.5 flat: 모든 시스템 UI R=0 · 선 대신 면 · 드로어 여백 ═══ */
      '.v4-top,.v4-top *,.v4-body,.v4-body *,.v4-drawer,.v4-drawer *,.v4-pop,.v4-pop *,.v4-tplpanel,.v4-tplpanel *,.v4-mchip,.v4-faqbtn,.v4-pvdock,.v4-pvdock *,#v4-fullpv-exit,.v4-payguide,#v4-payguide *{border-radius:0!important}',
      '.v4-btn{border-color:#d6d6d6!important;background:#fff}',
      '.v4-btn:hover{background:#e4e4e4;border-color:transparent!important;color:#262626}',
      '.v4-btn-primary{background:#3182f6!important;color:#fff}','.v4-btn-primary:hover{background:#1a63d6!important;color:#fff}',
      '.v4-btn-danger{background:#fdeaea!important;color:#e5484d!important}','.v4-btn-danger:hover{background:#fbdcdc!important}',
      '.v4-tbtn,.v4-iconbtn{border-color:transparent!important;background:#f2f2f2}',
      '.v4-tbtn:hover,.v4-iconbtn:hover{background:#e8f0fe;color:#3182f6}',
      '.v4-fld input,.v4-fld textarea{border:1px solid #e0e0e0!important;background:#fff}',
      '.v4-fld input:focus,.v4-fld textarea:focus{border-color:#3182f6!important;background:#fff}',
      '.v4-sec{border-color:transparent!important;background:#f5f5f5}',
      '.v4-acct-item,.v4-faq-item{border-color:transparent!important;background:#f5f5f5}',
      '.v4-mchip,.v4-faqbtn,.v4-pvdock{border-color:transparent!important}',
      /* 드로어 여백 — 조금 더 널찍하게 */
      '.v4-drawer-body{padding:20px 20px 46px!important}',
      '.v4-grp{margin:26px 0 10px!important}',
      '.v4-sec{margin-bottom:10px!important}',
      '.v4-sec-head{padding:13px 14px!important}',
      '.v4-sec-body{padding:2px 14px 15px!important}',
      '.v4-fld{margin-top:12px!important}'
    ].join('\n');
    var st=document.createElement('style'); st.id='v4-style'; st.textContent=css; document.head.appendChild(st);
  }
})();
