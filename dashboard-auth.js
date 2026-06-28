// ============================================================
// dashboard-auth.js
// Shared auth + Supabase client for all dashboard pages.
// Every dashboard HTML file loads this first via:
//   <script src="/dashboard-auth.js"></script>
// ============================================================

let supabase = null;
let currentUser = null;

// ── BOOT ─────────────────────────────────────────────────────
async function initDashboard() {
  try {
    const config = await getSiteConfig();
    supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      window.location.href = 'https://riley.eight14.us';
      return null;
    }

    currentUser = session.user;

    // Upsert profile row on first login
    await supabase.from('user_profiles').upsert({
      id:         currentUser.id,
      email:      currentUser.email,
      full_name:  currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || '',
      avatar_url: currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || '',
      updated_at: new Date().toISOString()
    }, { onConflict: 'id', ignoreDuplicates: false });

    return { user: currentUser, client: supabase };
  } catch (err) {
    console.error('[dashboard-auth] initDashboard error:', err.message);
    return null;
  }
}

// ── SIGN OUT ─────────────────────────────────────────────────
async function signOut() {
  if (supabase) await supabase.auth.signOut();
  window.location.href = 'https://riley.eight14.us';
}

// ── SITE CONFIG ───────────────────────────────────────────────
async function getSiteConfig() {
  const cached = sessionStorage.getItem('siteConfig');
  if (cached) return JSON.parse(cached);

  try {
    const res = await fetch('/.netlify/functions/site-config');
    if (!res.ok) throw new Error('site-config returned ' + res.status);
    const config = await res.json();
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Incomplete config');
    sessionStorage.setItem('siteConfig', JSON.stringify(config));
    return config;
  } catch (e) {
    console.warn('[dashboard-auth] site-config failed, using fallback:', e.message);
    return {
      supabaseUrl:     'https://tglljvjixlolaguycvbb.supabase.co',
      supabaseAnonKey: 'sb_publishable_VZFFDQYMJ9yuFbDvLKim4g_k1LhfTJ8'
    };
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const yest  = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString())  return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function calcSobrietyDays(startDateStr) {
  if (!startDateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(startDateStr)) / 86400000));
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── SIDEBAR RENDERER ──────────────────────────────────────────
function renderSidebar(activePage, user) {
  const firstName = (user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Member').split(' ')[0];
  const fullName  = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Member';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  const initials  = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'BC';

  const nav = (id, label, icon, href) => {
    const active = activePage === id ? 'active' : '';
    return `<a href="${href}" class="sidebar-nav-item ${active}">${icon} ${label}</a>`;
  };

  return `
    <div class="sidebar-logo">
      <div class="sidebar-logo-mark">Riley<span>.</span></div>
      <div class="sidebar-logo-sub">The 8:14 Project</div>
    </div>

    <div class="sidebar-section-label">Today</div>
    ${nav('dashboard',      '🌅 Morning Brief',  '', '/dashboard')}
    ${nav('chat',           '💬 Chat with Riley', '', 'https://riley.eight14.us')}
    ${nav('tracker',        '✅ Daily Check-In',  '', '/tracker')}

    <div class="sidebar-section-label">History</div>
    ${nav('conversations',  '📁 Conversations',   '', '/conversations')}
    ${nav('progress',       '📊 Progress',         '', '/tracker')}
    ${nav('fitness',        '🏋️ Workouts',         '', '/tracker')}
    ${nav('nutrition',      '🍳 Nutrition',         '', '/tracker')}

    <div class="sidebar-section-label">Programs</div>
    ${nav('programs',       '🎯 Enrollments',      '', '/programs')}
    ${nav('roadmap',        '🗺️ Roadmap',           '', '/programs')}

    <div class="sidebar-section-label">Life Data</div>
    ${nav('sleep',          '😴 Sleep',             '', '/tracker')}
    ${nav('goals',          '💰 Financial Goals',   '', '/tracker')}
    ${nav('calendar',       '📅 Calendar',           '', '/brief')}

    <div class="sidebar-spacer"></div>

    <div class="sidebar-user">
      <div class="user-avatar">
        ${avatarUrl
          ? `<img src="${escHtml(avatarUrl)}" alt="${escHtml(initials)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : escHtml(initials)}
      </div>
      <div class="user-info">
        <div class="user-name">${escHtml(fullName)}</div>
        <div class="user-plan">Life Coach · Active</div>
      </div>
      <button class="sign-out-btn" onclick="signOut()" title="Sign out">↪</button>
    </div>
  `;
}

// ── CSS VARS (injected immediately so no flash) ───────────────
(function() {
  const s = document.createElement('style');
  s.textContent = `
    :root {
      --ink:        #0f0e0d;
      --parchment:  #f5f0e8;
      --warm-white: #faf8f4;
      --gold:       #c9a84c;
      --gold-dim:   rgba(201,168,76,0.15);
      --mist:       #e8e4dc;
      --smoke:      #8a8578;
      --green:      #4a7c59;
      --red:        #8b3a3a;
      --blue:       #2a4a6e;
      --sidebar-w:  240px;
    }
  `;
  document.head.prepend(s);
})();
