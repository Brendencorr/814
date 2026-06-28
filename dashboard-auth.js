// ============================================================
// dashboard-auth.js
// Shared auth + Supabase client for all dashboard pages.
// Every dashboard HTML file loads this first via:
//   <script src="/dashboard-auth.js"></script>
// ============================================================

// ─── CONFIG (loaded from site-config.js async boot) ─────────
// site-config.js sets window.SITE_CONFIG = { supabaseUrl, supabaseAnonKey }
// before this file runs. We wait for it via initDashboard().

let supabase = null;
let currentUser = null;

// ─── BOOT ────────────────────────────────────────────────────
// Call this at the top of every dashboard page's <script> block.
// Usage:
//   const { user, client } = await initDashboard();
//
// Redirects to riley.eight14.us if not authenticated.

async function initDashboard() {
  try {
  // 1. Wait for site config
  const config = await getSiteConfig();

  // 2. Init Supabase client
  supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  // 3. Get current session
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) {
    // Not logged in — send to login
    window.location.href = 'https://riley.eight14.us';
    return null;
  }

  currentUser = session.user;

  // 4. Ensure user_profile row exists (upsert on first login)
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
    console.error('[dashboard-auth] initDashboard error:', err.message);
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
// Pulls env vars from the site-config Netlify function.
// Caches in sessionStorage so we don't hit the function on every page.

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
    // Public keys — safe to embed as fallback
    return {
      supabaseUrl:     'https://tglljvjixlolaguycvbb.supabase.co',
      supabaseAnonKey: 'sb_publishable_VZFFDQYMJ9yuFbDvLKim4g_k1LhfTJ8'
    };
  }
}

// ─── HELPERS ─────────────────────────────────────────────────

// Format a date string as "June 28" or "Today" / "Yesterday"
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

// Format a timestamp as "3:14 PM"
function formatTime(tsStr) {
  if (!tsStr) return '';
  return new Date(tsStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Calculate sobriety streak from a start_date string
function calcSobrietyDays(startDateStr) {
  if (!startDateStr) return 0;
  const start = new Date(startDateStr);
  const now = new Date();
  const diff = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// Render the sidebar nav with the current page highlighted
function renderSidebar(activePage, user) {
  const nav = [
    { id: 'dashboard',      label: 'Home',           icon: '🏠', href: '/dashboard.html' },
    { id: 'brief',          label: 'Today\'s Brief',  icon: '🌅', href: '/brief.html' },
    { id: 'conversations',  label: 'Conversations',  icon: '💬', href: '/conversations.html' },
    { id: 'tracker',        label: 'Daily Tracker',  icon: '✅', href: '/tracker.html' },
    { id: 'programs',       label: 'Programs',       icon: '🎯', href: '/programs.html' },
  ];

  const initials = (user?.user_metadata?.full_name || user?.email || 'U')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const avatarUrl = user?.user_metadata?.avatar_url;

  return `
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-mark">Riley<span>.</span></div>
        <div class="sidebar-logo-sub">The 8:14 Project</div>
      </div>

      <nav class="sidebar-nav">
        <div class="sidebar-section-label">Dashboard</div>
        ${nav.slice(0,2).map(item => `
          <a href="${item.href}" class="sidebar-nav-item ${activePage === item.id ? 'active' : ''}">
            <span class="nav-icon">${item.icon}</span> ${item.label}
          </a>`).join('')}

        <div class="sidebar-section-label">My Journey</div>
        ${nav.slice(2).map(item => `
          <a href="${item.href}" class="sidebar-nav-item ${activePage === item.id ? 'active' : ''}">
            <span class="nav-icon">${item.icon}</span> ${item.label}
          </a>`).join('')}

        <div class="sidebar-section-label">Chat</div>
        <a href="https://riley.eight14.us" class="sidebar-nav-item" target="_self">
          <span class="nav-icon">🤖</span> Talk to Riley
        </a>
      </nav>

      <div class="sidebar-spacer"></div>

      <div class="sidebar-user">
        <div class="user-avatar">
          ${avatarUrl
            ? `<img src="${avatarUrl}" alt="${initials}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
            : initials}
        </div>
        <div class="user-info">
          <div class="user-name">${user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Member'}</div>
          <div class="user-plan">Life Coach · Active</div>
        </div>
        <button class="sign-out-btn" onclick="signOut()" title="Sign out">↪</button>
      </div>
    </aside>
  `;
}

// ─── SHARED CSS VARIABLES (injected into every page) ─────────
// Each page has its own full <style> block, but these root vars
// are shared here so changing the palette is one edit.

const DASHBOARD_CSS_VARS = `
  :root {
    --ink:          #0f0e0d;
    --parchment:    #f5f0e8;
    --warm-white:   #faf8f4;
    --gold:         #c9a84c;
    --gold-dim:     rgba(201,168,76,0.15);
    --mist:         #e8e4dc;
    --smoke:        #8a8578;
    --green:        #4a7c59;
    --red:          #8b3a3a;
    --blue:         #2a4a6e;
    --sidebar-w:    240px;
  }
`;

// Inject CSS vars as the very first style tag on the page
(function injectVars() {
  const style = document.createElement('style');
  style.textContent = DASHBOARD_CSS_VARS;
  document.head.prepend(style);
})();
