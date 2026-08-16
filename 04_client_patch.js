/* ============================================================
   CEZ 모청 · v2.5 클라이언트 오버라이드 패치
   로드 위치: index.html 다음, editor_v4.js 앞 (런타임 오버라이드 — 로드 순서 의존).
   역할:
   - SB.canPublish / publishBlockReason 을 permission_status(4-state) 기준으로 재작성
   - SB._loadProfile 에 permission_status 필드 노출 (기존 profile 필드 유지)
   - 어드민 패널(cezReloadMembers / cezTogglePerm) 을 새 뷰·RPC 로 교체
   - 에디터에 권한 상태 배지(4-state) 삽입
   롤백: index.html 에서 이 <script> 제거.
   ============================================================ */

(function(){
  'use strict';

  var log = function(){ try { if(window.CEZ_DEBUG) console.log.apply(console, ['[CEZ v2.5]'].concat([].slice.call(arguments))); } catch(e){} };
  var _esc = window.esc || function(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
  var _toast = function(msg){ try{ if(typeof window.toast==='function')window.toast(msg); else console.log('toast:',msg);}catch(e){} };

  function pollUntil(check, cb, maxMs){
    var start = Date.now();
    var t = setInterval(function(){
      try { if(check()){ clearInterval(t); cb(); return; } } catch(e){}
      if(Date.now() - start > (maxMs || 30000)){ clearInterval(t); }
    }, 150);
  }


  /* ============================================================
     A. SB 클라이언트 오버라이드
     ============================================================ */
  pollUntil(function(){ return window.SB && window.SB.client; }, function(){
    log('applying SB overrides');

    /* _loadProfile: users 테이블에 permission_status 컬럼이 이미 있음.
       기존 select('*') 그대로 두고, 프로필 하이드레이션만 확인. */
    var origLoadProfile = SB._loadProfile.bind(SB);
    SB._loadProfile = async function(){
      await origLoadProfile();
      /* profile 은 이제 permission_status 를 포함 (SQL 마이그레이션 후) */
      if(this.profile){
        this.profile.permission_status = this.profile.permission_status || 'NONE';
      }
      log('profile · permission_status =', this.profile && this.profile.permission_status);
    };

    /* 4-state 게이트 */
    SB.canPublish = function(){
      return !!(this.profile && this.profile.permission_status === 'ACTIVE');
    };

    SB.getPermissionStatus = function(){
      return (this.profile && this.profile.permission_status) || 'NONE';
    };

    SB.publishBlockReason = function(){
      if(!this.user) return '네이버 로그인이 필요합니다';
      if(!this.profile) return '프로필 로드 중...';
      var st = this.profile.permission_status || 'NONE';
      if(st === 'ACTIVE') return null;
      var msgs = {
        NONE:           '결제 및 관리자 승인 후 공개할 수 있습니다',
        PENDING_REVIEW: '결제 확인 중 · 관리자 승인 대기 중입니다',
        SUSPENDED:      '관리자에 의해 공개 권한이 중지되었습니다'
      };
      return msgs[st] || '공개 권한이 없습니다';
    };

    /* saveInvitation 오버라이드: 권한 없으면 published=false 로 강제 */
    if(typeof SB.saveInvitation === 'function' && !SB._savePatched){
      var origSave = SB.saveInvitation.bind(SB);
      SB.saveInvitation = async function(payload){
        if(!SB.canPublish()){
          payload = Object.assign({}, payload, { published: false });
        }
        return origSave(payload);
      };
      SB._savePatched = true;
    }

    /* 이미 로그인된 상태면 프로필 리로드 후 UI 재갱신 */
    if(SB.user){
      SB._loadProfile().then(function(){
        if(typeof window.onAuthChange === 'function') {
          window.onAuthChange(SB.user, SB.profile);
        }
      });
    }
  });


  /* ============================================================
     B. 에디터 권한 상태 배지 (우측 하단 부동)
     ============================================================ */
  var BADGE_STYLES = {
    NONE:           { bg:'#F2F4F6', color:'#4E5968', label:'권한 없음',           sub:'결제 및 관리자 승인 필요' },
    PENDING_REVIEW: { bg:'#FFF8E1', color:'#B07914', label:'결제 확인 · 승인 대기', sub:'관리자 승인 후 공개 가능' },
    ACTIVE:         { bg:'#E6F3E6', color:'#2E8B57', label:'공개 가능',           sub:'저장 시 URL 이 활성화됩니다' },
    SUSPENDED:      { bg:'#FFEEEE', color:'#D14B4B', label:'공개 중지됨',         sub:'관리자에게 문의해 주세요' }
  };

  function renderBadge(){
    if(!window.SB || !SB.user || !SB.profile) return;
    var h = location.hash || '';
    if(h.indexOf('#/editor') !== 0){ removeBadge(); return; }
    if(!document.querySelector('.ed-foot')) return;

    var status = SB.getPermissionStatus ? SB.getPermissionStatus() : 'NONE';
    var s = BADGE_STYLES[status] || BADGE_STYLES.NONE;

    var existing = document.querySelector('.cez-perm-badge');
    if(existing){
      var existingStatus = existing.getAttribute('data-status');
      if(existingStatus === status) return; /* unchanged */
      existing.remove();
    }

    var badge = document.createElement('div');
    badge.className = 'cez-perm-badge';
    badge.setAttribute('data-status', status);
    badge.style.cssText = [
      'position:fixed',
      'bottom:86px',
      'right:24px',
      'z-index:70',
      'background:' + s.bg,
      'color:' + s.color,
      'border-radius:14px',
      'padding:12px 18px',
      'font-size:13px',
      'font-weight:700',
      'box-shadow:0 8px 24px rgba(0,0,0,.10),0 2px 6px rgba(0,0,0,.04)',
      'letter-spacing:-0.02em',
      'font-family:var(--sans,system-ui,sans-serif)',
      'max-width:260px'
    ].join(';');
    badge.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;line-height:1">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + s.color + '"></span>' +
        '<span>' + s.label + '</span>' +
      '</div>' +
      '<div style="font-size:11.5px;font-weight:500;margin-top:4px;opacity:.75;line-height:1.4">' + s.sub + '</div>';
    document.body.appendChild(badge);
  }

  function removeBadge(){
    var b = document.querySelector('.cez-perm-badge');
    if(b) b.remove();
  }

  window.addEventListener('hashchange', renderBadge);
  pollUntil(function(){ return window.SB && SB.profile; }, function(){ renderBadge(); });
  setInterval(renderBadge, 1500);


  /* ============================================================
     C. 어드민 패널 (cezReloadMembers 재구현)
     ============================================================ */
  pollUntil(function(){
    return typeof window.cezReloadMembers === 'function' && window.SB;
  }, function(){
    log('replacing admin panel functions');

    var STATUS_LABEL = {
      NONE:           '권한 없음',
      PENDING_REVIEW: '승인 대기',
      ACTIVE:         '공개 가능',
      SUSPENDED:      '중지됨'
    };
    var STATUS_CLASS = {
      NONE:           'unpaid',
      PENDING_REVIEW: 'expired',
      ACTIVE:         'paid',
      SUSPENDED:      'expired'
    };

    window.cezReloadMembers = async function(){
      if(!SB || !SB.user) return;
      if(!SB.isAdmin || !SB.isAdmin()){
        var tb = document.getElementById('cez-mem-tbody');
        if(tb) tb.innerHTML =
          '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--ds-danger)">어드민 권한이 없습니다.</td></tr>';
        return;
      }

      var r = await SB.client.from('v_admin_members').select('*');
      if(r.error){ console.error(r.error); _toast('회원 조회 실패: ' + r.error.message); return; }
      var members = r.data || [];

      var stats = {
        total: members.length,
        paid:  members.filter(function(m){ return (m.paid_payment_count || 0) > 0; }).length,
        perm:  members.filter(function(m){ return m.permission_status === 'ACTIVE'; }).length,
        pub:   members.filter(function(m){ return m.is_publicly_visible === true; }).length
      };
      var setT = function(id, v){ var e = document.getElementById(id); if(e) e.textContent = v; };
      setT('ms-t', stats.total);
      setT('ms-paid', stats.paid);
      setT('ms-perm', stats.perm);
      setT('ms-pub', stats.pub);

      var rows = members.map(function(m){
        var cd = m.created_at ? new Date(m.created_at) : null;
        var dateStr = cd
          ? cd.getFullYear() + '-' + String(cd.getMonth()+1).padStart(2,'0') + '-' + String(cd.getDate()).padStart(2,'0')
          : '-';

        var nameCell = '<div class="u-name">' + _esc(m.nickname || '') + '</div>' +
                       '<div class="u-mail">' + _esc(m.email || '') + '</div>';
        if(m.slug){
          nameCell += '<div style="font-size:11px;color:var(--ds-text-muted);margin-top:3px">/i/<code>' + _esc(m.slug) + '</code></div>';
        }

        var naver = m.naver_user_id
          ? '<code style="font-size:11.5px;background:var(--ds-cta-secondary);padding:2px 6px;border-radius:4px">' + _esc(m.naver_user_id) + '</code>'
          : '<span style="color:var(--ds-text-muted)">-</span>';

        var payHtml;
        if((m.paid_payment_count || 0) > 0){
          payHtml = '<span class="badge paid">결제 ' + m.paid_payment_count + '건</span>';
          if(m.latest_payment_source){
            payHtml += '<div style="font-size:10.5px;color:var(--ds-text-muted);margin-top:3px">' +
              _esc(m.latest_payment_source) + ' · ' + _esc(m.latest_payment_status || '') +
              (m.latest_payment_amount ? (' · ₩' + m.latest_payment_amount.toLocaleString('ko-KR')) : '') +
              '</div>';
          }
        } else {
          payHtml = '<span class="badge unpaid">결제 없음</span>';
        }

        var st = m.permission_status || 'NONE';
        var permHtml = '<span class="badge ' + STATUS_CLASS[st] + '">' + STATUS_LABEL[st] + '</span>';
        if(st === 'ACTIVE' && m.publish_permission_at){
          permHtml += '<div style="font-size:10.5px;color:var(--ds-text-muted);margin-top:3px">' +
            new Date(m.publish_permission_at).toLocaleDateString('ko-KR') + ' 부여</div>';
        }
        if(m.is_publicly_visible){
          permHtml += '<div style="margin-top:4px;color:var(--ds-success);font-size:11px;font-weight:600">● 공개 중</div>';
        }

        var noteHtml = '<textarea data-uid="' + m.id + '" onblur="cezSaveMemo(this)" placeholder="비고..." ' +
          'style="width:140px;height:46px;padding:6px 8px;border:1px solid var(--ds-line);border-radius:6px;font-size:11.5px;resize:vertical;font-family:inherit;background:#fff">' +
          _esc(m.admin_note || '') + '</textarea>';

        var actBtns = '<div style="display:flex;flex-direction:column;gap:5px;align-items:stretch">';
        if(st === 'ACTIVE'){
          actBtns += '<button type="button" class="btn btn-danger btn-sm" style="padding:5px 8px;font-size:11px" onclick="cezSetPerm(\'' + m.id + '\',\'SUSPENDED\')">권한 중지</button>';
        } else if(st === 'SUSPENDED'){
          actBtns += '<button type="button" class="btn-primary" style="padding:6px 8px;font-size:11px;font-weight:600" onclick="cezSetPerm(\'' + m.id + '\',\'ACTIVE\')">권한 재활성화</button>';
        } else if(st === 'PENDING_REVIEW'){
          actBtns += '<button type="button" class="btn-primary" style="padding:6px 8px;font-size:11px;font-weight:600" onclick="cezSetPerm(\'' + m.id + '\',\'ACTIVE\')">공개 승인</button>';
        } else {
          actBtns += '<button type="button" class="btn-primary" style="padding:6px 8px;font-size:11px;font-weight:600" onclick="cezSetPerm(\'' + m.id + '\',\'ACTIVE\')">권한 부여</button>';
          actBtns += '<button type="button" class="btn btn-secondary btn-sm" style="padding:4px 8px;font-size:10.5px" onclick="cezSetPerm(\'' + m.id + '\',\'PENDING_REVIEW\')">승인 대기</button>';
        }
        actBtns += '<button type="button" class="btn btn-secondary btn-sm" style="padding:4px 8px;font-size:10.5px" onclick="cezViewAudit(\'' + m.id + '\',\'' + _esc((m.nickname || m.email || '').replace(/'/g, '\\\'')) + '\')">이력</button>';
        actBtns += '</div>';

        return '<tr>' +
          '<td>' + nameCell + '</td>' +
          '<td>' + naver + '</td>' +
          '<td style="font-size:11.5px;color:var(--ds-text-muted)">' + dateStr + '</td>' +
          '<td>' + payHtml + '</td>' +
          '<td>' + permHtml + '</td>' +
          '<td>' + noteHtml + '</td>' +
          '<td>' + actBtns + '</td>' +
        '</tr>';
      }).join('');

      var tb = document.getElementById('cez-mem-tbody');
      if(tb) tb.innerHTML = rows ||
        '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--ds-text-muted)">아직 회원이 없습니다.</td></tr>';
    };

    /* cezSetPerm — 4-state 권한 전환 */
    window.cezSetPerm = async function(uid, newStatus){
      if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
      var LABELS = {
        ACTIVE:         '공개 권한 부여',
        PENDING_REVIEW: '승인 대기 표시',
        SUSPENDED:      '⚠️ 공개 권한 중지 — 공개 URL 이 즉시 비공개 전환됩니다',
        NONE:           '권한 초기화'
      };
      var memo = prompt(LABELS[newStatus] + '\n\n메모/사유 (선택):', '');
      if(memo === null) return;

      var r = await SB.client.rpc('grant_permission', {
        p_user_id: uid,
        p_new_status: newStatus,
        p_memo: memo || ''
      });
      if(r.error){ _toast('실패: ' + r.error.message); return; }

      var successMsgs = {
        ACTIVE:         '✓ 권한이 부여되었습니다',
        PENDING_REVIEW: '승인 대기로 표시되었습니다',
        SUSPENDED:      '권한이 중지되었습니다',
        NONE:           '권한이 초기화되었습니다'
      };
      _toast(successMsgs[newStatus] || '변경되었습니다');
      cezReloadMembers();
    };

    /* cezSaveMemo — 감사 로그 포함 */
    window.cezSaveMemo = async function(el){
      var uid = el.getAttribute('data-uid');
      var memo = el.value;
      var r = await SB.client.rpc('set_admin_memo', { p_user_id: uid, p_memo: memo });
      if(r.error){ _toast('메모 저장 실패: ' + r.error.message); return; }
      el.style.borderColor = 'var(--ds-success)';
      setTimeout(function(){ el.style.borderColor = 'var(--ds-line)'; }, 800);
    };

    /* cezViewAudit — 사용자별 감사 이력 */
    window.cezViewAudit = async function(uid, name){
      var r = await SB.client.from('v_user_audit_trail').select('*').eq('user_id', uid);
      if(r.error){ alert('이력 조회 실패: ' + r.error.message); return; }
      var rows = r.data || [];
      if(!rows.length){ alert(name + '\n\n감사 이력이 없습니다.'); return; }
      var txt = rows.map(function(l){
        var dt = new Date(l.created_at);
        var actor = l.actor_admin_email ? l.actor_admin_email : '(시스템)';
        return '[' + dt.toLocaleString('ko-KR') + ']\n' +
               '  ' + l.action_type + ' · ' + actor + '\n' +
               '  ' + (l.note || '(메모 없음)');
      }).join('\n\n');
      alert(name + ' — 감사 이력 (' + rows.length + '건)\n\n' + txt);
    };

    /* legacy 호환: 기존 cezTogglePerm 호출을 새 API 로 라우팅 */
    window.cezTogglePerm = function(uid, allow){
      return cezSetPerm(uid, allow ? 'ACTIVE' : 'SUSPENDED');
    };

    /* 어드민 화면이 열려있으면 즉시 재로딩 */
    if(document.getElementById('cez-mem-tbody')){ cezReloadMembers(); }
  });


  log('v2.5 client patch loaded');
})();

/* ============================================================
   CEZ Admin Console v3 · 통합 회원 관리 UI Patch (v2 · 드로어 5 섹션 + 타임라인)
   ============================================================
   변경사항 (v1 → v2):
   ✓ 상단 탭 제거 (결제 로그 · 감사 로그 별도 탭 없음)
   ✓ 회원 목록만 최상단 · 나머지는 모두 드로어 안으로
   ✓ 드로어 5 섹션: 계정 · 결제 · 발행 권한 · 청첩장 · 변경 이력
   ✓ Section D 청첩장에 강제 공개/종료 버튼 추가 (admin_toggle_publish RPC)
   ✓ Section E 변경 이력 = 타임라인 형태 (v_user_audit_trail 사용자별 조회)

   시작 마커: cez-admin-console-v3-start
   ============================================================ */

/* cez-admin-console-v3-start */
(function(){
  'use strict';

  var log = function(){ try{ console.log.apply(console, ['[Admin Console v3]'].concat([].slice.call(arguments))); }catch(e){} };
  var _esc = window.esc || function(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
  var _toast = function(msg){ try{ if(typeof window.toast==='function')window.toast(msg); else console.log('toast:',msg);}catch(e){} };

  function pollUntil(check, cb, maxMs){
    var start = Date.now();
    var t = setInterval(function(){
      try { if(check()){ clearInterval(t); cb(); return; } } catch(e){}
      if(Date.now() - start > (maxMs || 30000)){ clearInterval(t); log('poll timeout'); }
    }, 150);
  }

  /* ============================================================
     Styles
     ============================================================ */
  function injectStyles(){
    if(document.getElementById('cez-admin-v3-styles')) return;
    var css = `
      .cez-adm-actbar { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 20px; align-items:center; }
      .cez-adm-members-table { width:100%; table-layout:auto !important; }
      .cez-adm-members-table td { vertical-align:top; padding:16px 14px; }
      .cez-adm-members-table td:nth-child(1), .cez-adm-members-table td:nth-child(2), .cez-adm-members-table td:nth-child(3){ width:1%; white-space:nowrap; }
      .cez-adm-members-table td:nth-child(1) > div{ max-width:220px; }
      .cez-adm-members-table td:nth-child(2) > *, .cez-adm-members-table td:nth-child(3) > *{ display:block; }
      .cez-adm-members-table { min-width:860px; }
      .cez-adm-members-table th { font-size:11.5px !important; color:var(--ds-text-muted) !important; }
      .cez-adm-actions { display:flex; flex-direction:column; gap:4px; align-items:stretch; min-width:88px; }
      .cez-adm-actions button {
        padding:4px 6px !important; font-size:10.5px !important; font-weight:600;
        border-radius:6px; border:0; cursor:pointer; text-align:center;
      }
      .cez-adm-actions button.primary { background:var(--ds-primary); color:#fff; }
      .cez-adm-actions button.secondary { background:var(--ds-cta-secondary); color:var(--ds-text); }
      .cez-adm-actions button.danger { background:#FEE2E2; color:#991B1B; }
      .cez-adm-actions button:hover { opacity:0.85; }

      /* Drawer */
      .cez-drawer-backdrop {
        position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:9000;
        opacity:0; transition:opacity var(--t); pointer-events:none;
      }
      .cez-drawer-backdrop.open { opacity:1; pointer-events:auto; }
      .cez-drawer {
        position:fixed; top:0; right:0; height:100vh; width:min(620px, 100vw);
        background:#fff; z-index:9001; box-shadow:-8px 0 32px rgba(0,0,0,.12);
        transform:translateX(100%); transition:transform var(--t) var(--ease-out);
        overflow-y:auto; display:flex; flex-direction:column;
      }
      .cez-drawer.open { transform:translateX(0); }
      .cez-drawer-header {
        display:flex; justify-content:space-between; align-items:flex-start; gap:12px;
        padding:20px 24px 16px; border-bottom:1px solid var(--ds-line); background:#fff;
        position:sticky; top:0; z-index:2;
      }
      .cez-drawer-name { font-size:18px; font-weight:700; color:var(--ds-text); letter-spacing:-0.02em; }
      .cez-drawer-sub { font-size:12.5px; color:var(--ds-text-muted); margin-top:2px; }
      .cez-drawer-badges { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
      .cez-drawer-close {
        background:transparent; border:0; font-size:24px; cursor:pointer; color:var(--ds-text-muted);
        width:32px; height:32px; border-radius:16px; display:flex; align-items:center; justify-content:center;
      }
      .cez-drawer-close:hover { background:var(--ds-cta-secondary); color:var(--ds-text); }
      .cez-drawer-body { padding:20px 24px 40px; }
      .cez-drawer-section {
        background:var(--ds-cta-secondary); border-radius:var(--r-card-sm); padding:16px 18px;
        margin-bottom:14px;
      }
      .cez-drawer-section-title {
        font-size:11px; font-weight:700; color:var(--ds-text-muted);
        letter-spacing:.06em; text-transform:uppercase; margin-bottom:10px;
        display:flex; align-items:center; justify-content:space-between;
      }
      .cez-drawer-field { display:flex; justify-content:space-between; padding:6px 0; font-size:13px; gap:8px; }
      .cez-drawer-field-label { color:var(--ds-text-muted); flex-shrink:0; }
      .cez-drawer-field-value { color:var(--ds-text); font-weight:500; text-align:right; word-break:break-word; }
      .cez-drawer-actions {
        display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;
      }
      .cez-drawer-actions button {
        padding:10px 12px; font-size:12.5px; font-weight:600; border-radius:10px;
        border:0; cursor:pointer;
      }
      .cez-drawer-actions button.grant { background:var(--ds-primary); color:#fff; }
      .cez-drawer-actions button.revoke { background:#FEE2E2; color:#991B1B; }
      .cez-drawer-actions button.reset { background:var(--ds-cta-secondary-hover); color:var(--ds-text); grid-column:1/-1; }
      .cez-drawer-actions button.secondary { background:#fff; color:var(--ds-text); border:1px solid var(--ds-line); }

      /* Payment list within drawer */
      .cez-drawer-payment-row {
        padding:10px 12px; margin-bottom:6px; background:#fff; border-radius:8px;
        border:1px solid var(--ds-line); font-size:12.5px;
      }
      .cez-drawer-payment-row .head {
        display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;
      }
      .cez-drawer-payment-row .meta {
        color:var(--ds-text-muted); font-size:11px; margin-top:2px;
      }

      /* Timeline (Section E) */
      .cez-timeline {
        position:relative; padding-left:20px; border-left:2px solid var(--ds-line);
        margin-top:8px;
      }
      .cez-timeline-item {
        position:relative; padding-bottom:16px;
      }
      .cez-timeline-item:before {
        content:''; position:absolute; left:-27px; top:6px;
        width:10px; height:10px; border-radius:5px; background:var(--ds-primary);
        border:2px solid #fff; box-shadow:0 0 0 1px var(--ds-line);
      }
      .cez-timeline-item.suspend:before { background:#EF4444; }
      .cez-timeline-item.auto:before { background:var(--ds-text-muted); }
      .cez-timeline-item .date {
        font-size:11px; color:var(--ds-text-muted); font-weight:600;
        letter-spacing:-0.02em; margin-bottom:2px;
      }
      .cez-timeline-item .action {
        font-size:13px; font-weight:600; color:var(--ds-text); letter-spacing:-0.02em;
      }
      .cez-timeline-item .actor {
        font-size:11.5px; color:var(--ds-text-muted); margin-top:2px;
      }
      .cez-timeline-item .memo {
        font-size:12.5px; color:var(--ds-text-2); margin-top:6px; padding:8px 10px;
        background:#fff; border-radius:8px; border-left:3px solid var(--ds-primary);
      }
      .cez-timeline-empty {
        text-align:center; color:var(--ds-text-muted); padding:20px 12px; font-size:12.5px;
      }

      /* Badge overrides */
      .badge.perm-auto { background:#D1FAE5; color:#065F46; }
      .badge.perm-force-granted { background:#DBEAFE; color:#1E40AF; }
      .badge.perm-force-blocked { background:#FEE2E2; color:#991B1B; }
      .badge.perm-none { background:#F3F4F6; color:#6B7280; }
      .badge.inv-open { background:#D1FAE5; color:#065F46; }
      .badge.inv-scheduled { background:#FEF3C7; color:#92400E; }
      .badge.inv-closed { background:#E5E7EB; color:#4B5563; }
      .badge.inv-blocked { background:#FEE2E2; color:#991B1B; }
      .badge.inv-draft { background:#F3F4F6; color:#6B7280; }
      .badge.inv-none { background:#F9FAFB; color:#9CA3AF; }
    `;
    var style = document.createElement('style');
    style.id = 'cez-admin-v3-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ============================================================
     Formatters
     ============================================================ */
  function fmtDate(iso){
    if(!iso) return '-';
    try{
      var d = new Date(iso);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }catch(e){ return '-'; }
  }
  function fmtDateTime(iso){
    if(!iso) return '-';
    try{
      var d = new Date(iso);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') +
             ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }catch(e){ return '-'; }
  }
  function fmtShort(iso){
    if(!iso) return '-';
    try{
      var d = new Date(iso);
      return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') +
             ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }catch(e){ return '-'; }
  }
  function fmtRelative(iso){
    if(!iso) return '-';
    try{
      var d = new Date(iso);
      var diff = (Date.now() - d.getTime()) / 1000;
      if(diff < 60) return '방금';
      if(diff < 3600) return Math.floor(diff/60) + '분 전';
      if(diff < 86400) return Math.floor(diff/3600) + '시간 전';
      if(diff < 604800) return Math.floor(diff/86400) + '일 전';
      return fmtDate(iso);
    }catch(e){ return '-'; }
  }
  function fmtWon(n){
    if(n == null) return '-';
    return '₩' + Number(n).toLocaleString('ko-KR');
  }

  /* ============================================================
     Badge renderers
     ============================================================ */
  function renderPaymentBadge(m){
    var paid = m.paid_payment_count || 0;
    var total = m.total_payment_count || 0;
    if(paid > 0){
      var sub = m.latest_payment_source ?
        '<div style="font-size:10.5px;color:var(--ds-text-muted);margin-top:2px">' +
        _esc(m.latest_payment_source) + ' · ' + fmtWon(m.latest_payment_amount) + '</div>' : '';
      return '<span class="badge paid">결제완료</span>' + sub;
    }
    /* 쿠폰·주문번호로 권한이 열린 회원 — coupons 기록과 매칭해 표시 */
    var cp = (window._cezCouponByEmail || {})[String(m.email||'').toLowerCase()];
    if(cp && cp.status==='PENDING'){
      return '<span class="badge expired">승인 대기</span>' +
        '<div style="font-size:10.5px;color:var(--ds-text-muted);margin:3px 0 5px">주문 ' + _esc(String(cp.code).replace('ORD-','')) + '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<button type="button" class="btn-primary" style="padding:3px 10px;font-size:11px;font-weight:700" onclick="cezClaimApprove(\'' + _esc(cp.code) + '\')">승인</button>' +
          '<button type="button" class="btn btn-line btn-sm" style="padding:3px 8px;font-size:11px;color:var(--ds-danger,#e5484d)" onclick="cezClaimReject(\'' + _esc(cp.code) + '\')">거절</button>' +
        '</div>';
    }
    if(cp){
      var lbl = cp.code && cp.code.indexOf('ORD-')===0 ? ('주문 ' + cp.code.slice(4)) : ('쿠폰 ' + cp.code);
      return '<span class="badge paid">결제확인</span><div style="font-size:10.5px;color:var(--ds-text-muted);margin-top:2px">' + _esc(lbl) + '</div>';
    }
    if(m.payment_status === 'PAID') return '<span class="badge paid">결제확인</span>';
    if(total > 0) return '<span class="badge expired">결제대기</span>';
    return '<span class="badge unpaid">미결제</span>';
  }
  function renderPermissionBadge(m){
    var mode = m.entitlement_mode;
    var labels = { AUTO: '자동 승인', FORCE_GRANTED: '수동 승인', FORCE_BLOCKED: '수동 차단', NONE: '미부여' };
    var cls = 'perm-' + (mode || 'none').toLowerCase().replace(/_/g,'-');
    return '<span class="badge ' + cls + '">' + (labels[mode] || labels.NONE) + '</span>';
  }
  function renderInvitationBadge(m){
    var st = m.invitation_state;
    var labels = { NONE:'없음', DRAFT:'초안', SCHEDULED:'공개 전', OPEN:'공개 중', CLOSED:'공개 종료', BLOCKED:'권한 차단' };
    var cls = 'inv-' + (st || 'none').toLowerCase();
    var subtext = '';
    if(m.slug) subtext += '<div style="font-size:10.5px;color:var(--ds-text-muted);margin-top:2px">/i/<code>' + _esc(m.slug) + '</code></div>';
    return '<span class="badge ' + cls + '">' + (labels[st] || labels.NONE) + '</span>' + subtext;
  }

  /* ============================================================
     Main table row
     ============================================================ */
  function renderMemberRow(m){
    var inv = (window._cezInvMap || {})[m.id];
    var d = inv && inv.data;
    var invId = m.invitation_id;
    var hasInv = !!invId;
    var mail = String(m.email||'').toLowerCase();
    var cp = (window._cezCouponByEmail || {})[mail];
    var issuedCp = (window._cezIssuedByMemo || {})[mail];
    var paidConfirmed = (m.paid_payment_count||0) > 0 || (cp && cp.status === 'REDEEMED') || m.payment_status === 'PAID';

    /* ── ① 회원 ── */
    var nameCell = '<div class="u-name" style="overflow:hidden;text-overflow:ellipsis">' + _esc(m.nickname || '(이름 없음)') + '</div>' +
      '<div class="u-mail" style="overflow:hidden;text-overflow:ellipsis">' + _esc(m.email || '') + '</div>';

    /* ── ② 결제 ── */
    var pay = [];
    if(paidConfirmed){
      var det = '';
      if((m.paid_payment_count||0) > 0){
        det = _esc(m.latest_payment_source||'') + (m.latest_payment_amount ? ' · ' + fmtWon(m.latest_payment_amount) : '');
      } else if(cp){
        var c = String(cp.code||'');
        if(c.indexOf('TOSS-') === 0){ var amt=(String(cp.memo||'').match(/([0-9,]+)원/)||[])[1]; det = '토스' + (amt ? ' · ' + amt + '원' : ''); }
        else if(c.indexOf('PAYAPP') === 0){ det = cp.memo || 'PayApp 결제'; }
        else if(c.indexOf('CEZP') === 0){ det = '할인 코드 ' + c + ' 사용'; }
        else { det = '쿠폰 ' + c + ' 사용'; }
      }
      pay.push('<div style="font-size:12px;font-weight:700;color:#1f9d55">결제 완료</div>');
      if(det) pay.push('<div style="font-size:11.5px;color:var(--ds-text-muted);margin-top:6px">' + det + '</div>');
      /* 결제한 회원 전부에 '결제 취소' 노출(공개 여부 무관) — 실행 시 확인창이 공개중 케이스도 안내 */
      pay.push('<div style="margin-top:7px"><button type="button" style="padding:2px 0;font-size:10.5px;color:var(--ds-text-muted);background:none;border:0;text-decoration:underline;cursor:pointer" onclick="cezPaymentCancel(\'' + m.id + '\')">결제 취소</button></div>');
    } else {
      pay.push('<div style="font-size:12px;font-weight:600;color:#8a8a84">미결제</div>');
      if(issuedCp){
        var cpLink=function(label,onclick){ return '<button type="button" style="padding:0;font-size:10.5px;color:var(--ds-text-muted);background:none;border:0;text-decoration:underline;cursor:pointer" onclick="' + onclick + '">' + label + '</button>'; };
        pay.push('<div style="font-size:11.5px;color:var(--ds-text-muted);margin-top:7px">쿠폰 <code>' + _esc(issuedCp.code) + '</code><span style="display:inline-flex;gap:12px;margin-left:10px">' +
          cpLink('복사','navigator.clipboard.writeText(\'' + _esc(issuedCp.code) + '\');_toast&&_toast(\'쿠폰 번호 복사됨\')') +
          cpLink('취소','cezCouponVoid(\'' + _esc(issuedCp.code) + '\')') + '</span></div>');
      }
      /* 쿠폰은 유저별 발급하지 않고 매월 일괄 생성(어드민 쿠폰 패널) — 회원행 발급 버튼 제거 */
    }
    var payCell = pay.join('');

    /* ── ③ 배포 ── */
    var dep = [];
    var isPub = !!m.invitation_published;
    var arch = (typeof cezArchState === 'function') ? cezArchState(d || {}, isPub) : { state: isPub ? 'PUBLISHED' : 'DRAFT' };
    var L = { DRAFT:['제작중','#8a8a84'], PUBLISHED:['공개중','#1f9d55'], ARCHIVE:['보관중','#b8892f'], ADMIN_ARCHIVE:['관리자보관','#e5484d'] }[arch.state] || ['제작중','#8a8a84'];
    if(hasInv){
      var stLine = '<span style="font-size:12px;font-weight:700;color:' + L[1] + '">' + L[0] + '</span>';
      if(arch.state === 'PUBLISHED' && inv && inv.publish_start){
        try{
          var psStr = String(inv.publish_start).slice(0,10);
          var ps = new Date(psStr + 'T00:00:00');
          var days = Math.max(1, Math.floor((Date.now() - ps.getTime()) / 86400000) + 1);
          stLine += ' <span style="font-size:11.5px;font-weight:400;color:var(--ds-text-muted)">' + psStr + ' (' + days + '일째)</span>';
        }catch(e){}
      }
      dep.push('<div>' + stLine + '</div>');
    }
    if(hasInv){
      var allowed = isPub || !!m.effective_publish_permission;
      var pauseLink='';
      if(isPub){
        pauseLink=' <button type="button" style="padding:0;margin-left:10px;font-size:10.5px;color:var(--ds-text-muted);background:none;border:0;text-decoration:underline;cursor:pointer" onclick="cezPauseInv(\'' + invId + '\',true)">공개 중단</button>';
      } else if(inv && inv.slug_locked){
        pauseLink=' <button type="button" style="padding:0;margin-left:10px;font-size:10.5px;color:var(--ds-text-muted);background:none;border:0;text-decoration:underline;cursor:pointer" onclick="cezPauseInv(\'' + invId + '\',false)">공개 재개</button>';
      }
      dep.push('<div style="margin-top:10px;display:flex;align-items:center"><label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ds-text-muted);cursor:pointer">' +
        '<input type="checkbox" ' + (allowed?'checked':'') + ' onchange="cezDeployToggle(\'' + m.id + '\',\'' + invId + '\',' + (isPub?'true':'false') + ',this.checked)" style="width:14px;height:14px;accent-color:#3182f6;margin:0">공개 허용</label>' + pauseLink + '</div>');
    }
    var depCell = dep.join('') || '<span style="color:var(--ds-text-muted)">—</span>';

    /* ── ④ 청첩장 ── */
    var invCell = '<span style="color:var(--ds-text-muted)">청첩장 없음</span>';
    if(hasInv){
      var isPost = (arch.state === 'ARCHIVE' || arch.state === 'ADMIN_ARCHIVE');
      var prev = '';
      try{
        prev = isPost && typeof renderThankYouPreview === 'function' ? renderThankYouPreview(d) : (d && typeof renderInvitation === 'function' ? renderInvitation(d) : '');
      }catch(e){}
      var thumb = prev
        ? '<div class="cez-inv-thumb"' + (m.slug ? ' onclick="window.open(\'/#/i/' + _esc(m.slug) + '\',\'_blank\')"' : '') + ' title="스크롤 미리보기 · 클릭=새 창"><div class="cez-inv-thumb-in">' + prev + '</div></div>'
        : '';
      var meta = [];
      if(m.slug) meta.push('<div style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">/i/<code>' + _esc(m.slug) + '</code> <button type="button" style="padding:0;margin-left:8px;font-size:10.5px;color:var(--ds-text-muted);background:none;border:0;text-decoration:underline;cursor:pointer" onclick="navigator.clipboard.writeText(location.origin+\'/i/\'+\'' + _esc(m.slug) + '\');_toast&&_toast(\'주소 복사됨\')">복사</button></div>');
      var dates = [];
      if(d && d.date) dates.push('<b>예식일</b> ' + _esc(d.date));
      var keepEnd='';
      try{ if(d && d.date){ var _wd=new Date(d.date+'T00:00:00'); if(!isNaN(_wd.getTime())) keepEnd=new Date(_wd.getTime()+90*86400000).toLocaleDateString('sv'); } }catch(e){}
      if(!keepEnd && inv && inv.publish_end) keepEnd=String(inv.publish_end).slice(0,10);
      if(keepEnd) dates.push('<b>소장일</b> ' + _esc(keepEnd) + ' 까지');
      if(dates.length) meta.push('<div style="font-size:11.5px;color:var(--ds-text-2);margin-top:6px;line-height:1.65">' + dates.join('<br>') + '</div>');
      var linkBtn = function(label,onclick){ return '<button type="button" style="padding:2px 0;font-size:10.5px;color:var(--ds-text-muted);background:none;border:0;text-decoration:underline;cursor:pointer" onclick="' + onclick + '">' + label + '</button>'; };
      invCell = '<div style="display:flex;gap:14px;align-items:flex-start">' +
        thumb +
        '<div style="flex:1;min-width:0;padding-top:2px">' + meta.join('') +
          '<div style="margin-top:10px;display:flex;gap:12px">' +
            linkBtn('수정','cezProxyEdit(\'' + m.id + '\')') +
            linkBtn('삭제','cezDeleteInvitation(\'' + invId + '\',\'' + m.id + '\')') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    return '<tr data-mem-id="' + _esc(m.id) + '"' + (m.slug ? ' data-mem-slug="' + _esc(m.slug) + '"' : '') + '>' +
      '<td>' + nameCell + '</td>' +
      '<td>' + payCell + '</td>' +
      '<td>' + depCell + '</td>' +
      '<td>' + invCell + '</td>' +
    '</tr>';
  }

  /* ============================================================
     Drawer Section A · 계정 정보
     ============================================================ */
  function renderSectionAccount(m){
    return '<div class="cez-drawer-section">' +
      '<div class="cez-drawer-section-title">① 계정 정보</div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">사용자 ID</span><span class="cez-drawer-field-value"><code style="font-size:11px">' + _esc(m.id) + '</code></span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">이메일</span><span class="cez-drawer-field-value">' + _esc(m.email || '-') + '</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">닉네임</span><span class="cez-drawer-field-value">' + _esc(m.nickname || '-') + '</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">네이버 ID</span><span class="cez-drawer-field-value">' + _esc(m.naver_user_id || '-') + '</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">가입일</span><span class="cez-drawer-field-value">' + fmtDateTime(m.created_at) + '</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">관리자</span><span class="cez-drawer-field-value">' + (m.is_admin ? '예' : '아니오') + '</span></div>' +
    '</div>';
  }

  /* ============================================================
     Drawer Section B · 결제 (모든 결제 이력)
     ============================================================ */
  function renderSectionPayment(m, paymentList){
    var summary =
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">총 결제 수</span><span class="cez-drawer-field-value">' + (m.total_payment_count||0) + '건 (완료 ' + (m.paid_payment_count||0) + ')</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">현재 상태</span><span class="cez-drawer-field-value">' + _esc(m.payment_status || 'PENDING') + '</span></div>';

    var list = '';
    if(paymentList && paymentList.length){
      list = '<div style="margin-top:10px">' + paymentList.map(function(p){
        var statusCls = p.payment_status === 'PAID' ? 'paid' : (p.payment_status === 'REFUNDED' || p.payment_status === 'CANCELLED' ? 'expired' : 'unpaid');
        return '<div class="cez-drawer-payment-row">' +
          '<div class="head">' +
            '<span style="font-weight:600">' + _esc(p.source_type||'-') + ' · ' + fmtWon(p.amount) + '</span>' +
            '<span class="badge ' + statusCls + '">' + _esc(p.payment_status||'-') + '</span>' +
          '</div>' +
          '<div class="meta">' +
            (p.product_name ? _esc(p.product_name) + ' · ' : '') +
            '<code>' + _esc(p.external_order_id||'-') + '</code>' +
          '</div>' +
          '<div class="meta">결제일: ' + fmtDateTime(p.paid_at) + '</div>' +
        '</div>';
      }).join('') + '</div>';
    } else if(paymentList) {
      list = '<div style="text-align:center;color:var(--ds-text-muted);padding:12px;font-size:12.5px">결제 이력 없음</div>';
    } else {
      list = '<div style="text-align:center;color:var(--ds-text-muted);padding:12px;font-size:12px">불러오는 중…</div>';
    }

    return '<div class="cez-drawer-section">' +
      '<div class="cez-drawer-section-title">② 결제 정보</div>' +
      summary +
      list +
    '</div>';
  }

  /* ============================================================
     Drawer Section C · 발행 권한 관리
     ============================================================ */
  function renderSectionPermission(m){
    var mode = m.entitlement_mode;
    var modeLabels = { AUTO: '자동 승인', FORCE_GRANTED: '수동 승인 (override)', FORCE_BLOCKED: '수동 차단 (override)', NONE: '미부여' };
    var effLabel = m.effective_publish_permission ? '허용' : '차단';
    var effClass = m.effective_publish_permission ? 'paid' : 'expired';

    return '<div class="cez-drawer-section">' +
      '<div class="cez-drawer-section-title">③ 발행 권한 관리</div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">현재 상태</span><span class="cez-drawer-field-value">' + renderPermissionBadge(m) + '</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">최종 허용</span><span class="cez-drawer-field-value"><span class="badge ' + effClass + '">' + effLabel + '</span></span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">권한 소스</span><span class="cez-drawer-field-value">' + modeLabels[mode || 'NONE'] + '</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">마지막 변경</span><span class="cez-drawer-field-value">' + fmtDateTime(m.permission_updated_at) + '</span></div>' +
      '<div class="cez-drawer-field"><span class="cez-drawer-field-label">메모</span><span class="cez-drawer-field-value" style="max-width:280px;text-align:right">' + _esc(m.admin_note || '(없음)') + '</span></div>' +
      '<div class="cez-drawer-actions">' +
        '<button class="grant" onclick="cezActionPrompt(\'' + m.id + '\',\'grant\')">강제 권한 부여</button>' +
        '<button class="revoke" onclick="cezActionPrompt(\'' + m.id + '\',\'revoke\')">강제 권한 취소</button>' +
        '<button class="reset" onclick="cezActionPrompt(\'' + m.id + '\',\'reset\')">자동 상태로 복귀</button>' +
      '</div>' +
    '</div>';
  }

  /* ============================================================
     Drawer Section D · 청첩장 상태 + 강제 공개/종료
     ============================================================ */
  function renderSectionInvitation(m){
    var hasInv = !!m.invitation_id;
    var body = '';
    if(hasInv){
      var invId = m.invitation_id;
      var actions = '';
      if(m.invitation_published){
        actions = '<button class="revoke" onclick="cezToggleInvPublish(\'' + invId + '\',false,\'' + m.id + '\')">공개 종료</button>' +
                  (m.slug ? '<button class="secondary" onclick="window.open(\'/#/i/' + _esc(m.slug) + '\',\'_blank\')">청첩장 보기</button>' : '<button class="secondary" disabled>URL 없음</button>');
      } else {
        actions = '<button class="grant" onclick="cezToggleInvPublish(\'' + invId + '\',true,\'' + m.id + '\')">즉시 공개</button>' +
                  '<button class="secondary" onclick="cezReloadDrawer(\'' + m.id + '\')">상태 새로고침</button>';
      }
      /* 리셋 버튼 3개 */
      actions +=
        '<button class="secondary" onclick="cezResetInvitation(\'' + invId + '\',\'dates\',\'' + m.id + '\')">날짜 초기화</button>' +
        '<button class="secondary" onclick="cezResetInvitation(\'' + invId + '\',\'slug\',\'' + m.id + '\')">URL 초기화</button>' +
        '<button class="reset" onclick="cezResetInvitation(\'' + invId + '\',\'all\',\'' + m.id + '\')">⚠️ 전체 리셋</button>';
      body =
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">상태</span><span class="cez-drawer-field-value">' + renderInvitationBadge(m) + '</span></div>' +
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">slug</span><span class="cez-drawer-field-value"><code>/i/' + _esc(m.slug || '') + '</code></span></div>' +
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">published</span><span class="cez-drawer-field-value">' + (m.invitation_published ? '✓ true' : 'false') + '</span></div>' +
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">공개 시작</span><span class="cez-drawer-field-value">' + (m.invitation_publish_start || '-') + '</span></div>' +
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">공개 종료</span><span class="cez-drawer-field-value">' + (m.invitation_publish_end || '-') + '</span></div>' +
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">신랑 · 신부</span><span class="cez-drawer-field-value">' + _esc(m.groom_ko || '?') + ' · ' + _esc(m.bride_ko || '?') + '</span></div>' +
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">예식일</span><span class="cez-drawer-field-value">' + (m.wedding_date || '-') + '</span></div>' +
        '<div class="cez-drawer-field"><span class="cez-drawer-field-label">마지막 수정</span><span class="cez-drawer-field-value">' + fmtDateTime(m.invitation_updated_at) + '</span></div>' +
        '<div class="cez-drawer-actions">' + actions + '</div>';
    } else {
      body = '<div style="text-align:center;color:var(--ds-text-muted);padding:12px;font-size:12.5px">청첩장 없음 (사용자가 아직 생성 안 함)</div>';
    }
    return '<div class="cez-drawer-section">' +
      '<div class="cez-drawer-section-title">④ 청첩장 상태</div>' +
      body +
    '</div>';
  }

  /* ============================================================
     Drawer Section E · 변경 이력 (타임라인)
     ============================================================ */
  function renderSectionTimeline(auditList){
    var body = '';
    if(!auditList){
      body = '<div class="cez-timeline-empty">불러오는 중…</div>';
    } else {
      /* 운영자에게 의미 있는 액션만 필터링 · payload 로 세부 분기 */
      var meaningful = auditList.filter(function(a){
        return ['GRANT_PERMISSION','SUSPEND_PERMISSION','PAYMENT_SYNC','MANUAL_MATCH','NOTE_UPDATE'].indexOf(a.action_type) >= 0;
      });

      if(!meaningful.length){
        body = '<div class="cez-timeline-empty">활동 기록 없음</div>';
      } else {
        body = '<div class="cez-timeline">' + meaningful.map(function(a){
          var payload = a.payload_json || {};
          var subAction = payload.action || '';   /* admin_toggle_publish / admin_reset_* 등 */

          /* 세부 액션 우선 · 그 다음 action_type 폴백 */
          var actionLabel;
          if(subAction === 'admin_toggle_publish'){
            actionLabel = payload.to_published ? '청첩장 즉시 공개' : '청첩장 공개 종료';
          } else if(subAction === 'admin_reset_dates'){
            actionLabel = '공개 시작/종료일 초기화';
          } else if(subAction === 'admin_reset_slug'){
            actionLabel = 'URL 초기화 · slug 재발급';
          } else if(subAction === 'admin_reset_all'){
            actionLabel = '⚠️ 청첩장 전체 리셋';
          } else if(a.action_type === 'GRANT_PERMISSION' && payload.is_auto){
            actionLabel = '자동 승인 (결제 확인)';
          } else if(a.action_type === 'GRANT_PERMISSION' && payload.is_reset){
            actionLabel = '자동 상태로 복귀';
          } else {
            actionLabel = {
              'GRANT_PERMISSION': '강제 권한 부여',
              'SUSPEND_PERMISSION': '강제 권한 취소',
              'PAYMENT_SYNC': '결제 기록',
              'MANUAL_MATCH': '수동 매칭',
              'NOTE_UPDATE': '메모 변경'
            }[a.action_type] || a.action_type;
          }

          var cls = 'cez-timeline-item';
          if(a.action_type === 'SUSPEND_PERMISSION') cls += ' suspend';
          else if(!a.actor_admin_email || payload.is_auto) cls += ' auto';

          var actor = a.actor_admin_email ? _esc(a.actor_admin_email) : '(시스템 · 자동)';
          var memoText = payload.memo || '';
          var memoHtml = memoText ? '<div class="memo">메모: ' + _esc(memoText) + '</div>' : '';

          return '<div class="' + cls + '">' +
            '<div class="date">' + fmtShort(a.created_at) + '</div>' +
            '<div class="action">' + _esc(actionLabel) + '</div>' +
            '<div class="actor">' + actor + '</div>' +
            memoHtml +
          '</div>';
        }).join('') + '</div>';
      }
    }

    return '<div class="cez-drawer-section">' +
      '<div class="cez-drawer-section-title">⑤ 활동 기록</div>' +
      body +
    '</div>';
  }

  /* ============================================================
     Reset actions (dates / slug / all)
     ============================================================ */
  window.cezResetInvitation = async function(invitationId, kind, uid){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    var META = {
      dates: { title:'공개 시작/종료일 초기화',            rpc:'admin_reset_dates', ok:'✓ 날짜 초기화 완료' },
      slug:  { title:'URL 초기화 (새 랜덤 slug 발급)',    rpc:'admin_reset_slug',  ok:'✓ URL 초기화 완료' },
      all:   { title:'⚠️ 전체 리셋 (published=false · URL 새로 · 날짜 초기화)', rpc:'admin_reset_all',   ok:'✓ 전체 리셋 완료' }
    };
    var meta = META[kind];
    if(!meta) return;

    var memo = prompt(meta.title + '\n\n메모/사유 (선택):', '');
    if(memo === null) return;

    var r = await SB.client.rpc(meta.rpc, { p_invitation_id: invitationId, p_memo: memo || '' });
    if(r.error){ _toast('실패: ' + r.error.message); return; }
    _toast(meta.ok);

    cezReloadMembers();
    if(uid){
      var drawer = document.getElementById('cez-drawer');
      if(drawer && drawer.classList.contains('open') && drawer.dataset.currentUid === uid){
        cezOpenDrawer(uid);
      }
    }
  };

  /* ============================================================
     Drawer full render
     ============================================================ */
  function renderDrawerHeader(m){
    var badges = renderPermissionBadge(m) + ' ' + renderInvitationBadge(m);
    return '<div class="cez-drawer-header">' +
      '<div style="flex:1">' +
        '<div class="cez-drawer-name">' + _esc(m.nickname || '(이름 없음)') + '</div>' +
        '<div class="cez-drawer-sub">' + _esc(m.email || '') + '</div>' +
        '<div class="cez-drawer-badges">' + badges + '</div>' +
      '</div>' +
      '<button class="cez-drawer-close" onclick="cezCloseDrawer()">&times;</button>' +
    '</div>';
  }

  function renderDrawer(m, paymentList, auditList){
    return renderDrawerHeader(m) +
      '<div class="cez-drawer-body">' +
        renderSectionAccount(m) +
        renderSectionPayment(m, paymentList) +
        renderSectionPermission(m) +
        renderSectionInvitation(m) +
        renderSectionTimeline(auditList) +
      '</div>';
  }

  /* ============================================================
     Main data loader (list)
     ============================================================ */
  /* 대리 편집 진입: 회원 청첩장을 editTarget으로 올리고 에디터 오픈 (저장은 상단 '대리 편집 ON' 토글) */
  window.cezProxyEdit = function(uid){
    var inv = (window._cezInvMap || {})[uid];
    if(!inv || !inv.data){ (typeof toast==='function'?toast:alert)('이 회원의 청첩장 데이터를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.'); return; }
    var pid = 'proxy_' + uid;
    var u = {
      id: pid, role: 'user', name: '(대리 편집)', email: '',
      slug: inv.slug || '', slugLocked: !!inv.slug_locked,
      published: !!inv.published, tier: 'PAID',
      data: inv.data, _supabaseRowId: inv.id, _userId: inv.user_id || uid
    };
    if(!Array.isArray(DB.users)) DB.users = [];
    var i = DB.users.findIndex(function(x){ return x.id === pid; });
    if(i >= 0) DB.users[i] = u; else DB.users.push(u);
    if(typeof editId !== 'undefined') editId = pid;
    if(typeof window.V4toggleProxy === 'function' && !(window.V4 && V4.proxyEdit)){ /* 진입 시 안내만 — 토글은 수동 */ }
    location.hash = '#/editor';
    setTimeout(function(){ if(typeof toast==='function') toast('대리 편집 미리보기 — 저장하려면 상단 [대리 편집] 토글을 켜세요'); }, 400);
  };
  /* 배포 허용↔취소 단일 토글: OFF는 공개 중이면 배포 취소까지 수행 */
  window.cezDeployToggle = async function(uid, invId, isPub, on){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    if(!on && isPub){
      /* 공개 취소 — 결제로 얻은 권한은 유지한다 (회원이 다시 공개할 수 있음) */
      if(!confirm('공개를 중단할까요? 하객에게 더 이상 보이지 않습니다.\n(회원의 공개 권한은 유지됩니다)')){ cezReloadMembers(); return; }
      var t = await SB.client.rpc('admin_toggle_publish', { p_invitation_id: invId, p_published: false, p_memo: '어드민 공개 취소' });
      if(t.error){ _toast('공개 취소 실패: ' + t.error.message); }
      else _toast('공개 취소 — 하객에게 더 이상 보이지 않습니다');
      cezReloadMembers(); return;
    }
    var r = await SB.client.rpc('grant_permission', { p_user_id: uid, p_new_status: on ? 'ACTIVE' : 'SUSPENDED', p_memo: '어드민 토글' });
    if(r.error){ _toast('변경 실패: ' + r.error.message); }
    else _toast(on ? '공개 허용' : '공개 권한 해제');
    cezReloadMembers();
  };
  /* 공개 일시 중단/재개 — 중단하면 하객에게 '준비 중' 페이지가 보인다 (권한·데이터는 그대로) */
  window.cezPauseInv = async function(invId, pause){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    if(pause && !confirm('공개를 잠시 중단할까요?\n하객에게는 "청첩장 준비 중" 화면이 보입니다. 언제든 재개할 수 있어요.')) return;
    var r = await SB.client.rpc('admin_toggle_publish', { p_invitation_id: invId, p_published: !pause, p_memo: pause ? '공개 중단(준비중 표시)' : '공개 재개' });
    if(r.error){ _toast('실패: ' + r.error.message); return; }
    _toast(pause ? '공개 중단 — 하객에게 준비 중 화면이 보입니다' : '공개 재개됨');
    cezReloadMembers();
  };
  /* 결제 확인 취소 — 권한 해제 + 사용된 쿠폰 VOID (공개 상태는 공개 토글에서 별도) */
  window.cezPaymentCancel = async function(uid){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    if(!confirm('결제 확인을 취소할까요?\n공개 권한이 해제되고, 사용된 쿠폰/할인코드도 무효화됩니다.\n(공개 중이라면 공개 취소는 공개 열에서 따로 해주세요)')) return;
    var r = await SB.client.rpc('admin_cancel_payment', { p_user_id: uid, p_memo: '어드민 결제 취소' });
    if(r.error){ _toast('취소 실패: ' + r.error.message + (String(r.error.message).indexOf('function')>=0?' — v45_admin_cancel_payment.sql 실행 필요':'')); return; }
    _toast('결제 취소됨');
    cezReloadMembers();
  };
  /* 발급된 쿠폰 취소 (VOID) */
  window.cezCouponVoid = async function(code){
    if(!(window.SB && SB.client)){ _toast('서버 연결이 없습니다'); return; }
    if(!confirm('쿠폰 ' + code + '을(를) 취소할까요? 더 이상 사용할 수 없게 됩니다.')) return;
    var r = await SB.client.rpc('admin_reject_claim', { p_code: code });
    if(r.error){ _toast('취소 실패: ' + r.error.message); return; }
    _toast('쿠폰 취소됨');
    cezReloadMembers();
  };
  /* 쿠폰 티어 정의 — memo 앞부분 "<price>|<라벨>"로 종류 구분(가격은 서버가 이 값으로 검증) */
  /* 코드는 전부 CEZ- 접두로 통일(kind FREE로 발급) — 가격/종류는 memo "<price>|<라벨>"로만 구분 */
  var CEZ_CP_TIERS = [
    { key:'paper', kind:'FREE', price:9900,  label:'종이 구매자', badge:'#E8F4FF', color:'var(--ds-primary-hover)' },
    { key:'event', kind:'FREE', price:19900, label:'이벤트',      badge:'#E8F4FF', color:'var(--ds-primary-hover)' },
    { key:'free',  kind:'FREE', price:0,     label:'무료',        badge:'#e6f6ec', color:'#1f9d55' }
  ];
  function cezCpTierOf(c){
    if(String(c.code||'').indexOf('CEZ')!==0) return null;
    var p=parseInt(String(c.memo||'').split('|')[0],10);
    if(p===9900) return 'paper';
    if(p===19900) return 'event';
    return 'free'; /* 0 또는 가격 미기재(구코드) */
  }
  /* 쿠폰 패널 — 티어별 현재 코드 1개씩 + [이번 달 코드 새로 발급] */
  window.cezCouponPanel = async function(){
    var box=document.getElementById('cez-cp-panel'); if(!box||!(window.SB&&SB.client))return;
    var lr; try{ lr=await SB.client.rpc('admin_list_coupons',{ p_limit:200 }); }catch(e){ box.innerHTML='<div style="font-size:12px;color:#e5484d;padding:6px 0">쿠폰을 불러오지 못했어요.</div>'; return; }
    if(!lr||lr.error){ box.innerHTML='<div style="font-size:12px;color:#e5484d;padding:6px 0">쿠폰 시스템 미설치.</div>'; return; }
    var issued=(lr.data||[]).filter(function(c){ return c.status==='ISSUED' && String(c.code||'').indexOf('CEZ')===0; })
      .sort(function(a,b){ return String(b.issued_at||'').localeCompare(String(a.issued_at||'')); });
    function cur(key){ for(var i=0;i<issued.length;i++){ if(cezCpTierOf(issued[i])===key) return issued[i]; } return null; }
    var rows=CEZ_CP_TIERS.map(function(t){
      var c=cur(t.key);
      var codeCell=c
        ? '<code style="font-weight:700;font-size:13px">'+_esc(c.code)+'</code> <button type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(\''+_esc(c.code)+'\');_toast&&_toast(\'복사됨\')" style="background:none;border:0;color:var(--ds-primary);text-decoration:underline;cursor:pointer;font-size:11px">복사</button>'
        : '<span style="font-size:12px;color:var(--ds-text-muted)">아직 없음 — 아래 버튼으로 발급</span>';
      return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--ds-line)">'
        +'<span style="flex:0 0 auto;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;background:'+t.badge+';color:'+t.color+'">'+t.label+' · '+t.price.toLocaleString()+'원</span>'
        +'<span style="flex:1;min-width:110px">'+codeCell+'</span>'
        +'<button type="button" class="btn btn-line btn-sm" style="flex:0 0 auto;padding:5px 11px;font-size:11.5px" onclick="cezCouponRenewTier(\''+t.key+'\')">새 코드</button></div>';
    }).join('');
    box.innerHTML=rows
      +'<div style="margin-top:8px;min-height:16px"><span id="cez-cp-msg" style="font-size:12px"></span></div>';
  };
  /* 티어 하나만 새 코드 발급 — 해당 티어 기존 코드 무효화 후 1개 발급 */
  window.cezCouponRenewTier = async function(key){
    if(!(window.SB&&SB.client)){ _toast('서버 연결이 없습니다'); return; }
    var t=null; for(var i=0;i<CEZ_CP_TIERS.length;i++){ if(CEZ_CP_TIERS[i].key===key)t=CEZ_CP_TIERS[i]; }
    if(!t)return;
    if(!confirm(t.label+' 새 코드를 발급할까요?\n기존 '+t.label+' 코드는 무효화돼요. (이미 결제한 분들은 영향 없어요)'))return;
    var msg=document.getElementById('cez-cp-msg'); if(msg){ msg.style.color='var(--ds-text-muted)'; msg.textContent=t.label+' 발급 중…'; }
    try{
      var lr=await SB.client.rpc('admin_list_coupons',{ p_limit:300 });
      var olds=(lr.data||[]).filter(function(c){ return c.status==='ISSUED' && String(c.code||'').indexOf('CEZ')===0 && cezCpTierOf(c)===key; });
      for(var i=0;i<olds.length;i++){ try{ await SB.client.rpc('admin_reject_claim',{ p_code:olds[i].code }); }catch(e){} }
    }catch(e){}
    var memo=t.price+'|'+t.label;
    var r=await SB.client.rpc('admin_issue_coupons',{ p_count:1, p_memo:memo, p_kind:t.kind });
    if(r.error && String(r.error.message).indexOf('function')>=0){ r=await SB.client.rpc('admin_issue_coupons',{ p_count:1, p_memo:memo }); }
    if(r.error){ if(msg){ msg.style.color='#e5484d'; msg.textContent='발급 실패: '+r.error.message; } return; }
    var code=(r.data||[])[0]||'';
    try{ await navigator.clipboard.writeText(code); }catch(e){}
    if(msg){ msg.style.color='#1f9d55'; msg.textContent='✓ '+t.label+' 새 코드 '+code+' (복사됨)'; }
    cezCouponPanel();
  };
  window.cezPermCheck = async function(uid, on){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    var r = await SB.client.rpc('grant_permission', { p_user_id: uid, p_new_status: on ? 'ACTIVE' : 'SUSPENDED', p_memo: '어드민 체크박스' });
    if(r.error){ _toast('변경 실패: ' + r.error.message); cezReloadMembers(); return; }
    _toast(on ? '배포 권한 허용' : '배포 권한 해제');
    cezReloadMembers();
  };
  /* ============================================================
     회원 목록 — 서버 사이드 검색/필터/정렬/페이지네이션 (조회 전용 · write 없음)
     · v_admin_members 뷰에서 필요한 컬럼만 · 50명 단위 range · count:exact
     · 검색/필터/정렬은 전부 DB에서 처리(클라 filter() 아님)
     · 썸네일(청첩장 전체 데이터)은 화면에 보이는 행만 지연 로드 → N+1 제거
     ============================================================ */
  var MEM_PAGE_SIZE = 50;
  /* ⚠ 실제 운영 v_admin_members 에 phone 컬럼 없음(anon REST로 검증) → SELECT/검색에서 제외.
     전화번호 검색은 뷰에 phone 추가(뷰 변경)가 필요해 이번 범위(조회 전용) 밖. */
  var MEM_COLS = 'id,nickname,email,created_at,payment_status,paid_payment_count,total_payment_count,latest_payment_source,latest_payment_amount,latest_payment_order_id,latest_payment_product,slug,invitation_id,invitation_published,invitation_updated_at,permission_status,effective_publish_permission,is_publicly_visible';
  window._cezMemState = window._cezMemState || { page:0, total:0 };
  window._cezMembersPage = window._cezMembersPage || [];
  var _cezMemDebounce = null, _cezThumbObserver = null;

  /* PostgREST or() 안전화 — 구분자/특수문자 제거(주입/파싱오류 방지) */
  function _cezSanitizeKw(kw){ return String(kw||'').replace(/[,()*%":\\]/g,' ').replace(/\s+/g,' ').trim(); }
  function _cezReadFilters(){
    var g=function(id){ var e=document.getElementById(id); return e?e.value:''; };
    return { q:_cezSanitizeKw((document.getElementById('cez-mem-search')||{}).value||''),
             pay:g('cez-mem-fpay'), pub:g('cez-mem-fpub'), inv:g('cez-mem-finv'), sort:g('cez-mem-sort')||'new' };
  }
  window.cezMemSearchInput = function(v){
    clearTimeout(_cezMemDebounce);
    _cezMemDebounce = setTimeout(function(){ window._cezMemState.page = 0; cezReloadMembers(); }, 300); /* 300ms debounce */
  };
  window.cezMemFilterChange = function(){ window._cezMemState.page = 0; cezReloadMembers(); };
  window.cezMemGoto = function(delta){
    var s=window._cezMemState, maxP=Math.max(0, Math.ceil(s.total/MEM_PAGE_SIZE)-1);
    s.page = Math.min(maxP, Math.max(0, s.page + delta)); cezReloadMembers();
  };

  window.cezReloadMembers = window.__cezV3ReloadMembers = async function(){
    if(!window.SB || !SB.user) return;
    if(!SB.isAdmin || !SB.isAdmin()){
      var tb = document.getElementById('cez-mem-tbody');
      if(tb) tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--ds-danger)">어드민 권한이 없습니다.</td></tr>';
      return;
    }
    /* 패널 HTML의 인라인 <script>는 innerHTML 삽입이라 실행 안 됨 → 여기서 쿠폰 패널 로드 */
    if(typeof window.cezCouponPanel==='function'){ try{ window.cezCouponPanel(); }catch(e){} }

    var s = window._cezMemState, f = _cezReadFilters();
    var q = SB.client.from('v_admin_members').select(MEM_COLS, { count:'exact' });

    /* ── 필터 (전부 서버) — 조합 가능 ── */
    if(f.pay==='paid')        q = q.or('payment_status.eq.PAID,paid_payment_count.gt.0');
    else if(f.pay==='unpaid') q = q.neq('payment_status','PAID').eq('paid_payment_count',0);
    if(f.pub==='pub')         q = q.eq('is_publicly_visible', true);
    else if(f.pub==='unpub')  q = q.eq('is_publicly_visible', false);
    if(f.inv==='has')         q = q.not('invitation_id','is',null);
    else if(f.inv==='none')   q = q.is('invitation_id', null);

    /* ── 검색 (서버, ilike) — 이름·이메일·slug·주문번호 (phone 컬럼 부재로 전화 제외) ── */
    if(f.q){
      var like = '*' + f.q + '*';
      q = q.or(['nickname.ilike.'+like,'email.ilike.'+like,'slug.ilike.'+like,'latest_payment_order_id.ilike.'+like].join(','));
    }

    /* ── 정렬 ── */
    if(f.sort==='name')      q = q.order('nickname', {ascending:true, nullsFirst:false});
    else if(f.sort==='old')  q = q.order('created_at', {ascending:true});
    else                     q = q.order('created_at', {ascending:false}); /* new(기본): 최신 가입순 */

    /* ── 페이지네이션 (50명) ── */
    q = q.range(s.page*MEM_PAGE_SIZE, s.page*MEM_PAGE_SIZE + MEM_PAGE_SIZE - 1);

    var r = await q;
    if(r.error){ console.error(r.error); _toast('회원 조회 실패: ' + r.error.message); return; }
    var members = r.data || [];
    s.total = (typeof r.count === 'number') ? r.count : members.length;
    window._cezMembersPage = members;

    /* 헤더 카운트 — 각 컬럼 필터값에 따라 달라지는 숫자(검색·필터 바뀔 때마다 갱신) */
    cezLoadMemberStats();

    /* 쿠폰·주문번호 사용 내역 → 이메일 매칭 (결제 표시용) · 패널당 1회만(검색·페이지마다 반복 안 함) */
    if(!window._cezCouponsLoaded){
      window._cezCouponsLoaded = true;
      try{
        var cr = await SB.client.rpc('admin_list_coupons',{p_limit:200});
        var map={}; var issued={};
        (cr.data||[]).forEach(function(c){
          if(c.status==='ISSUED' && c.memo && String(c.code).indexOf('CEZ')===0){
            var mk=String(c.memo).toLowerCase().trim();
            if(mk && !issued[mk]) issued[mk]=c;
            return;
          }
          if(!c.redeemed_email) return;
          var k=String(c.redeemed_email).toLowerCase();
          if(c.status==='PENDING'){ map[k]=c; }               /* 승인 대기 최우선 표시 */
          else if(c.status==='REDEEMED'){ var _cur=map[k]; if(!_cur){ map[k]=c; } else if(_cur.status!=='PENDING' && String(c.code).indexOf('PAYAPP')===0){ map[k]=c; } }
        });
        window._cezCouponByEmail = map;
        window._cezIssuedByMemo = issued;
      }catch(e){ window._cezCouponByEmail = window._cezCouponByEmail||{}; window._cezIssuedByMemo = window._cezIssuedByMemo||{}; window._cezCouponsLoaded=false; }
    }

    /* 렌더 — 청첩장 데이터 없이 즉시(기본 정보). 썸네일은 아래 지연 로드 */
    window._cezInvMap = window._cezInvMap || {};
    var tbody = document.getElementById('cez-mem-tbody');
    if(tbody) tbody.innerHTML = members.length ?
      members.map(renderMemberRow).join('') :
      '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--ds-text-muted)">' + (f.q||f.pay||f.pub||f.inv ? '검색 결과가 없습니다.' : '아직 회원이 없습니다.') + '</td></tr>';

    cezRenderPager();
    cezSetupLazyThumbs();   /* 화면에 보이는 행만 청첩장 데이터 지연 로드 */
  };

  /* 통계 4종 — head:true count 4회(데이터 전송 없음). 페이지네이션과 무관한 전역 수치 */
  window.cezLoadMemberStats = async function(){
    var f = _cezReadFilters();
    var setT = function(id, v){ var e=document.getElementById(id); if(e) e.textContent = (typeof v==='number'? v : '—'); };
    var base = function(){
      var q = SB.client.from('v_admin_members').select('id', { count:'exact', head:true });
      if(f.q){ var like='*'+f.q+'*'; q = q.or(['nickname.ilike.'+like,'email.ilike.'+like,'slug.ilike.'+like,'latest_payment_order_id.ilike.'+like].join(',')); }
      return q;
    };
    try{
      setT('ms-t', (await base()).count);                                          /* 회원: 검색 매칭 전체 */
      var qp = base();
      if(f.pay==='paid')        qp = qp.or('payment_status.eq.PAID,paid_payment_count.gt.0');
      else if(f.pay==='unpaid') qp = qp.neq('payment_status','PAID').eq('paid_payment_count',0);
      setT('ms-paid', (await qp).count);                                           /* 결제: 현재 결제 필터값 */
      var qv = base();
      if(f.pub==='pub')         qv = qv.eq('is_publicly_visible', true);
      else if(f.pub==='unpub')  qv = qv.eq('is_publicly_visible', false);
      setT('ms-pub', (await qv).count);                                            /* 공개: 현재 공개 필터값 */
      var qi = base();
      if(f.inv==='has')         qi = qi.not('invitation_id','is',null);
      else if(f.inv==='none')   qi = qi.is('invitation_id', null);
      setT('ms-inv', (await qi).count);                                            /* 청첩장: 현재 청첩장 필터값 */
    }catch(e){ console.error('[mem facet]', e); }
  };

  /* 페이저 */
  window.cezRenderPager = function(){
    var el = document.getElementById('cez-mem-pager'); if(!el) return;
    var s = window._cezMemState, totalPages = Math.max(1, Math.ceil(s.total/MEM_PAGE_SIZE)), cur = s.page+1;
    var from = s.total ? (s.page*MEM_PAGE_SIZE + 1) : 0, to = Math.min(s.total, (s.page+1)*MEM_PAGE_SIZE);
    el.innerHTML =
      '<button type="button" class="btn btn-secondary btn-sm" ' + (s.page<=0?'disabled':'') + ' onclick="cezMemGoto(-1)">← 이전</button>' +
      '<span style="min-width:180px;text-align:center">' + from + '–' + to + ' / <b>' + s.total + '</b>명 · ' + cur + '/' + totalPages + ' 페이지</span>' +
      '<button type="button" class="btn btn-secondary btn-sm" ' + (cur>=totalPages?'disabled':'') + ' onclick="cezMemGoto(1)">다음 →</button>';
  };

  /* 지연 썸네일 — 화면에 들어오는 행만 getInvitationBySlug(읽기전용 STABLE) 후 그 행만 재렌더 */
  window.cezSetupLazyThumbs = function(){
    var tbody = document.getElementById('cez-mem-tbody'); if(!tbody) return;
    if(_cezThumbObserver){ try{ _cezThumbObserver.disconnect(); }catch(e){} _cezThumbObserver=null; }
    var rows = tbody.querySelectorAll('tr[data-mem-id][data-mem-slug]');
    if(typeof IntersectionObserver === 'undefined'){
      cezLoadRowInv((window._cezMembersPage||[]).filter(function(m){ return m.slug; })); return; /* 폴백: 현재 페이지(≤50) 전부 */
    }
    _cezThumbObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(!en.isIntersecting) return;
        var tr = en.target, id = tr.getAttribute('data-mem-id');
        _cezThumbObserver.unobserve(tr);
        var m = (window._cezMembersPage||[]).find(function(x){ return String(x.id)===String(id); });
        if(m && m.slug && !(window._cezInvMap||{})[m.id]) cezLoadRowInv([m]);
      });
    }, { rootMargin:'250px' });
    Array.prototype.forEach.call(rows, function(tr){ _cezThumbObserver.observe(tr); });
  };
  async function cezLoadRowInv(list){
    window._cezInvMap = window._cezInvMap || {};
    await Promise.all((list||[]).map(function(m){
      if(!m.slug || window._cezInvMap[m.id]) return null;
      return SB.getInvitationBySlug(m.slug).then(function(inv){   /* STABLE = 읽기 전용, DB 변경 없음 */
        if(inv && inv.data){ window._cezInvMap[m.id] = inv; cezRerenderRow(m.id); }
      }).catch(function(){});
    }));
  }
  function cezRerenderRow(id){
    var tbody = document.getElementById('cez-mem-tbody'); if(!tbody) return;
    var tr = tbody.querySelector('tr[data-mem-id="' + (window.CSS&&CSS.escape?CSS.escape(id):id) + '"]');
    var m = (window._cezMembersPage||[]).find(function(x){ return String(x.id)===String(id); });
    if(tr && m){ tr.outerHTML = renderMemberRow(m); }
  }

  /* ============================================================
     Drawer open/close
     ============================================================ */
  window.cezOpenDrawer = async function(uid){
    injectStyles();
    ensureDrawerElements();
    var drawer = document.getElementById('cez-drawer');
    var backdrop = document.getElementById('cez-drawer-backdrop');
    if(!drawer || !backdrop) return;

    /* 1단계: 회원 기본 정보로 즉시 렌더 (payments/audit 는 로딩 중) */
    drawer.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ds-text-muted)">로딩 중…</div>';
    drawer.classList.add('open');
    backdrop.classList.add('open');
    drawer.dataset.currentUid = uid;

    var r = await SB.client.from('v_admin_members').select('*').eq('id', uid).maybeSingle();
    if(r.error || !r.data){
      drawer.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ds-danger)">회원 조회 실패</div>';
      return;
    }
    var m = r.data;

    /* 초기 렌더 (payment/audit null → 로딩 표시) */
    drawer.innerHTML = renderDrawer(m, null, null);

    /* 2단계: 병렬로 payments + audit 로드 후 재렌더 */
    var results = await Promise.all([
      SB.client.from('payments').select('*').eq('matched_user_id', uid).order('created_at', {ascending:false}).limit(20),
      SB.client.from('v_user_audit_trail').select('*').eq('user_id', uid).limit(30)
    ]);
    var paymentList = results[0].data || [];
    var auditList = results[1].data || [];

    /* 드로어가 다른 유저로 이미 바뀌었을 수도 있으니 확인 */
    if(drawer.dataset.currentUid === uid){
      drawer.innerHTML = renderDrawer(m, paymentList, auditList);
    }
  };

  window.cezCloseDrawer = function(){
    var drawer = document.getElementById('cez-drawer');
    var backdrop = document.getElementById('cez-drawer-backdrop');
    if(drawer) drawer.classList.remove('open');
    if(backdrop) backdrop.classList.remove('open');
  };

  window.cezReloadDrawer = function(uid){
    if(uid) cezOpenDrawer(uid);
  };

  function ensureDrawerElements(){
    if(!document.getElementById('cez-drawer-backdrop')){
      var bd = document.createElement('div');
      bd.id = 'cez-drawer-backdrop';
      bd.className = 'cez-drawer-backdrop';
      bd.onclick = window.cezCloseDrawer;
      document.body.appendChild(bd);
    }
    if(!document.getElementById('cez-drawer')){
      var d = document.createElement('div');
      d.id = 'cez-drawer';
      d.className = 'cez-drawer';
      document.body.appendChild(d);
    }
  }

  /* ============================================================
     Actions
     ============================================================ */
  window.cezActionPrompt = async function(uid, action){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    var META = {
      grant:  { title:'강제 권한 부여',  rpc:'grant_permission',       params:function(m){ return { p_user_id: uid, p_new_status: 'ACTIVE', p_memo: m }; }, ok: '✓ 권한이 부여되었습니다' },
      revoke: { title:'⚠️ 강제 권한 취소',  rpc:'grant_permission',       params:function(m){ return { p_user_id: uid, p_new_status: 'SUSPENDED', p_memo: m }; }, ok: '권한이 취소되었습니다' },
      reset:  { title:'자동 상태로 복귀',  rpc:'reset_permission_auto',  params:function(m){ return { p_user_id: uid, p_memo: m }; },                       ok: '자동 상태로 복귀되었습니다' }
    };
    var meta = META[action];
    if(!meta) return;

    var memo = prompt(meta.title + '\n\n메모/사유 (선택):', '');
    if(memo === null) return;

    var r = await SB.client.rpc(meta.rpc, meta.params(memo || ''));
    if(r.error){ _toast('실패: ' + r.error.message); return; }
    _toast(meta.ok);

    cezReloadMembers();
    var drawer = document.getElementById('cez-drawer');
    if(drawer && drawer.classList.contains('open') && drawer.dataset.currentUid === uid){
      cezOpenDrawer(uid);
    }
  };

  /* 공개 시작일/종료일 직접 저장 (admin_set_invitation_dates RPC) */

  /* 청첩장 완전 삭제 (admin_delete_invitation RPC) */
  window.cezDeleteInvitation = async function(invId, uid){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    if(!confirm('이 청첩장을 완전히 삭제합니다. (회원 계정은 유지됩니다)\n작성 내용과 하객 응답(RSVP)이 모두 지워지며 되돌릴 수 없습니다.\n\n계속할까요?')) return;
    var r = await SB.client.rpc('admin_delete_invitation', { p_invitation_id: invId });
    if(r.error){ _toast('삭제 실패: ' + r.error.message); return; }
    _toast('청첩장이 삭제되었습니다');
    cezReloadMembers();
  };

  /* 청첩장 강제 공개/종료 */
  window.cezToggleInvPublish = async function(invitationId, toPublished, uid){
    if(!SB || !SB.isAdmin()){ _toast('어드민 권한이 필요합니다'); return; }
    var actionLabel = toPublished ? '청첩장 재공개' : '⚠️ 청첩장 강제 종료';
    var memo = prompt(actionLabel + '\n\n메모/사유 (선택):', '');
    if(memo === null) return;

    var r = await SB.client.rpc('admin_toggle_publish', {
      p_invitation_id: invitationId,
      p_published: toPublished,
      p_memo: memo || ''
    });
    if(r.error){ _toast('실패: ' + r.error.message); return; }
    _toast(toPublished ? '✓ 재공개되었습니다' : '청첩장이 종료되었습니다');

    cezReloadMembers();
    if(uid){
      var drawer = document.getElementById('cez-drawer');
      if(drawer && drawer.classList.contains('open') && drawer.dataset.currentUid === uid){
        cezOpenDrawer(uid);
      }
    }
  };

  /* ============================================================
     Panel HTML shell — v3 통합 회원 관리 (단일 뷰)
     ============================================================ */
  function cezAdminMembersPanelV3(){
    if(!window.SB || !window.SB.user){
      return '<div style="margin-top:54px;padding:24px 28px;background:var(--ds-cta-secondary);border-radius:var(--r-card);text-align:center">' +
        '<div style="font-size:13px;color:var(--ds-text-2);line-height:1.6">☁️ 회원 관리 패널은 네이버 로그인 후 첫 어드민 부트스트랩 시 표시됩니다.</div>' +
      '</div>';
    }

    /* 패널 새로 열 때 검색/페이지 상태 초기화 (필터 입력은 빈 값으로 렌더되므로 자동 리셋) */
    window._cezMemState = { page:0, total:0 };
    window._cezStatsLoaded = false;
    window._cezCouponsLoaded = false;

    return '<h2 class="section-h" style="margin-top:54px">회원 관리</h2>' +

      /* 쿠폰(공유 코드) — 종류별 현재 코드 1개만. [새 코드]=이전 것 무효화 후 재발급(중복 방지) */
      '<div style="max-width:520px;margin:0 0 16px;padding:12px 14px;background:var(--ds-cta-secondary);border-radius:var(--r-input)">' +
        '<div style="font-size:12.5px;font-weight:700;color:var(--ds-text)">쿠폰 (공유 코드)</div>' +
        '<div style="font-size:11px;color:var(--ds-text-muted);margin:2px 0 4px">하객이 결제창에 입력하면 해당 가격이 적용돼요. 어뷰징 방지를 위해 <b>[새 코드]</b>로 매달 바꿔 주세요.</div>' +
        '<div id="cez-cp-panel"><div style="font-size:12px;color:var(--ds-text-muted);padding:8px 0">불러오는 중…</div></div>' +
      '</div>' +

      /* 검색창 — 회원 목록 바로 위 */
      '<div style="margin:0 0 12px">' +
        '<input id="cez-mem-search" type="search" placeholder="이름·이메일·주소(slug)·주문번호 검색" oninput="cezMemSearchInput(this.value)" autocomplete="off" style="width:100%;padding:10px 12px;font-size:13px;background:var(--ds-cta-secondary);border:1px solid transparent;border-radius:8px;color:var(--ds-text)">' +
      '</div>' +

      /* Members table (단일 뷰) */
      '<div class="tablecard" style="overflow-x:auto">' +
        '<table class="cez-adm-members-table">' +
          '<thead><tr>' +
            '<th style="width:1%;white-space:nowrap;vertical-align:middle">회원 <b id="ms-t" style="color:var(--ds-text)">…</b>' +
              '<select id="cez-mem-sort" onchange="cezMemFilterChange()" style="margin-left:8px;padding:4px 6px;font-size:11px;font-weight:400;background:var(--ds-cta-secondary);border:1px solid transparent;border-radius:6px;color:var(--ds-text);cursor:pointer"><option value="new">최신 가입순</option><option value="old">오래된 가입순</option><option value="name">이름순</option></select></th>' +
            '<th style="width:1%;white-space:nowrap;vertical-align:middle">결제 <b id="ms-paid" style="color:#1f9d55">…</b>' +
              '<select id="cez-mem-fpay" onchange="cezMemFilterChange()" style="margin-left:8px;padding:4px 6px;font-size:11px;font-weight:400;background:var(--ds-cta-secondary);border:1px solid transparent;border-radius:6px;color:var(--ds-text);cursor:pointer"><option value="">전체</option><option value="paid">결제 완료</option><option value="unpaid">미결제</option></select></th>' +
            '<th style="width:1%;white-space:nowrap;vertical-align:middle">공개 <b id="ms-pub" style="color:#1f9d55">…</b>' +
              '<select id="cez-mem-fpub" onchange="cezMemFilterChange()" style="margin-left:8px;padding:4px 6px;font-size:11px;font-weight:400;background:var(--ds-cta-secondary);border:1px solid transparent;border-radius:6px;color:var(--ds-text);cursor:pointer"><option value="">전체</option><option value="pub">공개</option><option value="unpub">비공개</option></select></th>' +
            '<th style="vertical-align:middle">청첩장 <b id="ms-inv" style="color:var(--ds-text)">…</b>' +
              '<select id="cez-mem-finv" onchange="cezMemFilterChange()" style="margin-left:8px;padding:4px 6px;font-size:11px;font-weight:400;background:var(--ds-cta-secondary);border:1px solid transparent;border-radius:6px;color:var(--ds-text);cursor:pointer"><option value="">전체</option><option value="has">있음</option><option value="none">없음</option></select></th>' +
          '</tr></thead>' +
          '<tbody id="cez-mem-tbody">' +
            '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--ds-text-muted)">불러오는 중…</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +

      /* 페이지네이션 */
      '<div id="cez-mem-pager" style="display:flex;justify-content:center;align-items:center;gap:14px;margin:16px 0 8px;font-size:13px;color:var(--ds-text-2)"></div>' +

      '<script>setTimeout(cezReloadMembers,200);setTimeout(cezCouponPanel,260);<\/script>';
  }

  /* ============================================================
     Overrides — 진입점
     ============================================================ */
  pollUntil(function(){ return window.SB && typeof window.cezAdminMembersPanel === 'function'; }, function(){
    log('applying admin console v3 overrides');
    injectStyles();

    /* 기존 '사용자·결제' 섹션 숨김 */

    /* 통합 회원 관리 패널로 교체 */
    window.cezAdminMembersPanel = cezAdminMembersPanelV3;

    /* v2.5 섹션 C 의 pollUntil 이 SB 준비 후 뒤늦게 실행되며 v3 cezReloadMembers 를
       덮어써(옛 버튼식 행·"상세" 버튼 없음) 드로어가 안 열리던 문제 수정.
       이 진입점은 섹션 C 콜백보다 나중에 실행되므로 여기서 v3 버전으로 복원한다. */
    if(window.__cezV3ReloadMembers) window.cezReloadMembers = window.__cezV3ReloadMembers;

    /* 어드민 페이지 현재 열려있으면 즉시 재렌더 */
    if(location.hash === '#/admin' && typeof window.render === 'function'){
      window.render();
    }

    log('✓ Admin Console v3 (드로어 5 섹션 + 타임라인) ready');
  });
})();
/* cez-admin-console-v3-end */
