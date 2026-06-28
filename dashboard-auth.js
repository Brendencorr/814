// ============================================================
// dashboard-auth.js
// Shared auth + Supabase client for all dashboard pages.
// Every dashboard HTML file loads this first via:
//   <script src="/dashboard-auth.js"></script>
// ============================================================

// ─── FALLBACK CONFIG ─────────────────────────────────────────
const FALLBACK_CONFIG = {
  supabaseUrl: 'https://tglljvjixlolaguycvbb.supabase.co',
  supabaseAnonKey: 'sb_publishable_VZFFDQYMJ9yuFbDvLKim4g_k1LhfTJ8'
};

let supabase = null;
let currentUser = null;

// ─── BOOT ────────────────────────────────────────────────────
// Call this at the top of every dashboard page's <script> block.
// Returns { user, client } or null on failure.
// Redirects to riley.eight14.us if not authenticated.

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
    await supabase
      .from('user_profiles')
      .upsert({
        id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.user_metadata?.full_name || '',
        avatar_url: currentUser.user_metadata?.avatar_url || '',
        updated_at: new Date().toISOString()
      }, { onConflict: 'id', ignoreDuplicates: false });

    return { user: currentUser, client: supabase };
  } catch (err) {
    console.error('initDashboard error:', err);
    return null;
  }
}

// ─── SIGN OUT ────────────────────────────────────────────────
async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  window.location.href = 'https://riley.eight14.us';
}

// ─── SITE CONFIG LOADER ───────────────────────────────────────
async function getSiteConfig() {
  const cached = sessionStorage.getItem('siteConfig');
  if (cached) return JSON.parse(cached);

  try {
    const res = await fetch('/.netlify/functions/site-config');
    if (!res.ok) throw new Error('site-config returned ' + res.status);
    const config = await res.json();
    sessionStorage.setItem('siteConfig', JSON.stringify(config));
    return config;
  } catch (err) {
    console.warn('site-config fetch failed, using fallback:', err);
    return FALLBACK_CONFIG;
  }
}

// ─── HELPERS ─────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function formatTime(tsStr) {
  if (!tsStr) return '';
  return new Date(tsStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function calcSobrietyDays(startDateStr) {
  if (!startDateStr) return 0;
  const start = new Date(startDateStr);
  const now = new Date();
  return Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
}

// ─── SIDEBAR RENDERER ────────────────────────────────────────
// Injects inner HTML into <aside class="sidebar" id="sidebar-mount"></aside>

function renderSidebar(activePage, user) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;

  const sections = [
    {
      label: 'Today',
      items: [
        { id: 'dashboard', label: 'Morning Brief',   icon: '🌅', href: '/dashboard.html' },
        { id: 'chat',      label: 'Chat with Riley', icon: '💬', href: 'https://riley.eight14.us' },
        { id: 'checkin',   label: 'Daily Check-In',  icon: '✅', href: '/tracker.html' },
      ]
    },
    {
      label: 'History',
      items: [
        { id: 'conversations', label: 'Conversations', icon: '📁', href: '/conversations.html' },
        { id: 'progress',      label: 'Progress',      icon: '📊', href: '/progress.html' },
        { id: 'workouts',      label: 'Workouts',      icon: '🏋️', href: '/workouts.html' },
        { id: 'nutrition',     label: 'Nutrition',     icon: '🍳', href: '/nutrition.html' },
      ]
    },
    {
      label: 'Programs',
      items: [
        { id: 'programs', label: 'Enrollments', icon: '🎯', href: '/programs.html' },
        { id: 'roadmap',  label: 'Roadmap',     icon: '🗺️', href: '/roadmap.html' },
      ]
    },
    {
      label: 'Life Data',
      items: [
        { id: 'sleep',    label: 'Sleep',           icon: '😴', href: '/sleep.html' },
        { id: 'finance',  label: 'Financial Goals', icon: '💰', href: '/finance.html' },
        { id: 'calendar', label: 'Calendar',        icon: '📅', href: '/calendar.html' },
      ]
    },
  ];

  const initials = (user?.user_metadata?.full_name || user?.email || 'U')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const avatarUrl = user?.user_metadata?.avatar_url;
  const fullName  = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Member';

  mount.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-mark">Riley<span>.</span></div>
      <div class="sidebar-logo-sub">The 8:14 Project</div>
    </div>

    ${sections.map(s => `
      <div class="sidebar-section-label">${s.label}</div>
      ${s.items.map(item => `
        <a href="${item.href}" class="sidebar-nav-item ${activePage === item.id ? 'active' : ''}">
          <span class="nav-icon">${item.icon}</span> ${item.label}
        </a>`).join('')}
    `).join('')}

    <div class="sidebar-spacer"></div>

    <div class="sidebar-user">
      <div class="user-avatar">
        ${avatarUrl
          ? `<img src="${avatarUrl}" alt="${initials}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : initials}
      </div>
      <div class="user-info">
        <div class="user-name">${fullName}</div>
        <div class="user-plan">Life Coach · Active</div>
      </div>
      <button class="sign-out-btn" onclick="signOut()" title="Sign out">↪</button>
    </div>
  `;
}

// ─── CSS VARS (injected into every page) ─────────────────────
const DASHBOARD_CSS_VARS = `
  :root {
    --ink:              #0f0e0d;
    --parchment:        #f5f0e8;
    --warm-white:       #faf8f4;
    --gold:             #c9a84c;
    --gold-light:       #e8d5a3;
    --gold-dim:         rgba(201,168,76,0.15);
    --riley-blue:       #2a4a6e;
    --riley-blue-light: #4a7ab0;
    --mist:             #e8e4dc;
    --smoke:            #8a8578;
    --green:            #4a7c59;
    --red:              #8b3a3a;
    --sidebar-w:        240px;
  }
`;

(function injectVars() {
  const style = document.createElement('style');
  style.textContent = DASHBOARD_CSS_VARS;
  document.head.prepend(style);
})();
