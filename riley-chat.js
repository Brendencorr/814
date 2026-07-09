/**
 * riley-chat.js
 * Manages Riley AI conversations - saves every turn to riley_conversations in Supabase.
 * Include this before riley-dashboard.html's closing </body> tag.
 *
 * Tables used:
 *   riley_conversations (id, user_id, session_id, role, content, created_at)
 *
 * Usage:
 *   RileyChat.init(supabaseClient, userId);
 *   const sessions = await RileyChat.getSessions();
 *   const messages = await RileyChat.loadSession(sessionId);
 *   await RileyChat.send(sessionId, userText, onTokenCallback);
 */

window.RileyChat = (function () {

  // ── Config ──────────────────────────────────────────────────────────────
  // Update this to your deployed Netlify function URL for Riley
  const RILEY_FUNCTION_URL =
    'https://jade-zabaione-30e1f0.netlify.app/.netlify/functions/riley-chat';

  let _db     = null;
  let _userId = null;

  // ── init ────────────────────────────────────────────────────────────────
  function init(supabaseClient, userId) {
    _db     = supabaseClient;
    _userId = userId;
  }

  // ── newSessionId ─────────────────────────────────────────────────────────
  function newSessionId() {
    return crypto.randomUUID();
  }

  // ── getSessions ──────────────────────────────────────────────────────────
  // Returns array of { session_id, preview, created_at } sorted newest first.
  async function getSessions() {
    const { data, error } = await _db
      .from('riley_conversations')
      .select('session_id, role, content, created_at')
      .eq('user_id', _userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return [];

    // Group by session_id; use earliest user message as preview
    const map = {};
    for (const row of data) {
      if (!map[row.session_id]) {
        map[row.session_id] = {
          session_id: row.session_id,
          preview: '',
          created_at: row.created_at
        };
      }
      // Keep the earliest timestamp as session start
      if (new Date(row.created_at) < new Date(map[row.session_id].created_at)) {
        map[row.session_id].created_at = row.created_at;
      }
      // Use first user message as preview text
      if (row.role === 'user' && !map[row.session_id].preview) {
        map[row.session_id].preview = row.content;
      }
    }

    return Object.values(map).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  }

  // ── loadSession ──────────────────────────────────────────────────────────
  // Returns array of { role, content, created_at } in chronological order.
  async function loadSession(sessionId) {
    const { data, error } = await _db
      .from('riley_conversations')
      .select('role, content, created_at')
      .eq('user_id', _userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // ── _saveMessage ─────────────────────────────────────────────────────────
  async function _saveMessage(sessionId, role, content) {
    const { error } = await _db
      .from('riley_conversations')
      .insert({
        user_id:    _userId,
        session_id: sessionId,
        role,
        content
      });
    if (error) console.error('[RileyChat] Save error:', error.message);
  }

  // ── send ─────────────────────────────────────────────────────────────────
  // Saves the user turn, calls the Netlify function, saves the assistant turn.
  // onToken(chunk) is called progressively if the function streams, or once
  // with the full reply if it returns JSON.
  // Returns the full assistant reply string.
  async function send(sessionId, userText, onToken) {
    if (!_db || !_userId) throw new Error('RileyChat not initialised - call init() first');

    // 1. Persist user message immediately
    await _saveMessage(sessionId, 'user', userText);

    let fullReply = '';

    try {
      const res = await fetch(RILEY_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:    userText,
          session_id: sessionId,
          user_id:    _userId
        })
      });

      if (!res.ok) throw new Error(`Riley function returned HTTP ${res.status}`);

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        // ── Streaming response ──
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Strip SSE "data: " prefixes if present
          const text = chunk.replace(/^data:\s*/gm, '').replace(/\[DONE\]/g, '').trim();
          if (text) {
            fullReply += text;
            if (onToken) onToken(text);
          }
        }
      } else {
        // ── JSON response ──
        const data = await res.json();
        fullReply  = data.reply || data.content || data.message || JSON.stringify(data);
        if (onToken) onToken(fullReply);
      }

    } catch (err) {
      fullReply = 'Sorry, I had trouble connecting. Please try again.';
      if (onToken) onToken(fullReply);
      console.error('[RileyChat] Fetch error:', err.message);
    }

    // 2. Persist assistant reply
    if (fullReply) {
      await _saveMessage(sessionId, 'assistant', fullReply);
    }

    return fullReply;
  }

  // ── Public API ───────────────────────────────────────────────────────────
  return { init, newSessionId, getSessions, loadSession, send };

})();
