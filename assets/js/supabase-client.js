/* BetSafe — Supabase client (auth + persistencia + real-time)
 * ============================================================================
 * Lazy-loads @supabase/supabase-js desde CDN si hay config presente.
 *
 * Config: window.__BS_CONFIG.supabaseUrl + supabaseAnonKey,
 * o localStorage 'bs:cfg:supabaseUrl' / 'bs:cfg:supabaseAnonKey'.
 *
 * Si Supabase no está configurado, todos los métodos hacen graceful fallback
 * a localStorage (mismo comportamiento que tenía la app antes).
 *
 * Schema (ver SUPABASE_SCHEMA.sql):
 *   - profiles      (id, name, tier 'standard|vip', created_at)
 *   - bankroll      (user_id, current, initial, updated_at)
 *   - bet_history   (id, user_id, sport, event, stake, odd, result 'W|L|P|V', profit, at)
 *   - slips         (user_id, legs jsonb, stake, updated_at)
 *   - saved_picks   (id, user_id, pick jsonb, created_at)
 * ============================================================================
 */
(function (global) {
  'use strict';

  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/+esm';

  let client = null;          // SupabaseClient (cuando esté inicializado)
  let loadPromise = null;     // memoiza la promesa de carga del SDK
  let currentSession = null;  // cache de la sesión activa

  function cfg(name) {
    try {
      if (global.__BS_CONFIG && global.__BS_CONFIG[name]) return global.__BS_CONFIG[name];
      const ls = localStorage.getItem('bs:cfg:' + name);
      if (ls) return ls;
    } catch {}
    return null;
  }

  function isConfigured() {
    return Boolean(cfg('supabaseUrl') && cfg('supabaseAnonKey'));
  }

  /** Carga el SDK desde CDN y crea el cliente. Idempotente. */
  async function ensureClient() {
    if (client) return client;
    if (!isConfigured()) return null;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const { createClient } = await import(SUPABASE_CDN);
      client = createClient(cfg('supabaseUrl'), cfg('supabaseAnonKey'), {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage: localStorage,
          storageKey: 'bs:supabase:auth'
        }
      });
      // Cachear sesión inicial
      const { data: { session } } = await client.auth.getSession();
      currentSession = session;
      // Suscribirse a cambios de auth
      client.auth.onAuthStateChange((event, sess) => {
        currentSession = sess;
        emit('auth-change', { event, session: sess });
      });
      return client;
    })();
    return loadPromise;
  }

  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent('bs:' + name, { detail })); } catch {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH
  // ─────────────────────────────────────────────────────────────────────────
  async function signUp({ email, password, name }) {
    const c = await ensureClient();
    if (!c) return { ok: false, reason: 'not-configured' };
    const { data, error } = await c.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
    if (error) return { ok: false, error };
    // Crear fila en profiles
    if (data.user) {
      await c.from('profiles').insert({
        id: data.user.id,
        name: name || email.split('@')[0],
        tier: 'standard'
      }).single();
      await c.from('bankroll').insert({
        user_id: data.user.id,
        current: 100000,
        initial: 100000
      }).single();
    }
    return { ok: true, user: data.user, session: data.session };
  }

  async function signIn({ email, password }) {
    const c = await ensureClient();
    if (!c) return { ok: false, reason: 'not-configured' };
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error };
    return { ok: true, user: data.user, session: data.session };
  }

  async function signOut() {
    const c = await ensureClient();
    if (!c) return { ok: false, reason: 'not-configured' };
    const { error } = await c.auth.signOut();
    return { ok: !error, error };
  }

  function getSession() { return currentSession; }
  function isAuthed() { return Boolean(currentSession?.user); }
  function getUserId() { return currentSession?.user?.id || null; }

  async function getProfile() {
    const c = await ensureClient();
    if (!c || !getUserId()) return null;
    const { data, error } = await c.from('profiles').select('*').eq('id', getUserId()).single();
    if (error) return null;
    return data;
  }

  async function upgradeToVip() {
    const c = await ensureClient();
    if (!c || !getUserId()) return { ok: false };
    const { error } = await c.from('profiles').update({ tier: 'vip' }).eq('id', getUserId());
    return { ok: !error, error };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BANKROLL
  // ─────────────────────────────────────────────────────────────────────────
  async function getBankroll() {
    const c = await ensureClient();
    if (!c || !getUserId()) return null;
    const { data, error } = await c.from('bankroll').select('*').eq('user_id', getUserId()).single();
    if (error) return null;
    return data;
  }
  async function updateBankroll(current) {
    const c = await ensureClient();
    if (!c || !getUserId()) return { ok: false };
    const { error } = await c.from('bankroll')
      .update({ current, updated_at: new Date().toISOString() })
      .eq('user_id', getUserId());
    return { ok: !error, error };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BET HISTORY
  // ─────────────────────────────────────────────────────────────────────────
  async function listHistory({ limit = 200, since = null } = {}) {
    const c = await ensureClient();
    if (!c || !getUserId()) return [];
    let q = c.from('bet_history').select('*').eq('user_id', getUserId()).order('at', { ascending: false }).limit(limit);
    if (since) q = q.gte('at', new Date(since).toISOString());
    const { data, error } = await q;
    if (error) { console.warn('[supabase] history failed:', error); return []; }
    return data || [];
  }
  async function addBet(bet) {
    const c = await ensureClient();
    if (!c || !getUserId()) return { ok: false };
    const row = {
      user_id: getUserId(),
      sport: bet.sport || null,
      league: bet.league || null,
      event: bet.event || null,
      stake: bet.stake,
      odd: bet.odd,
      result: bet.result || 'P',
      profit: bet.profit || 0,
      at: bet.at ? new Date(bet.at).toISOString() : new Date().toISOString(),
      meta: bet.meta || {}
    };
    const { data, error } = await c.from('bet_history').insert(row).select().single();
    return { ok: !error, data, error };
  }
  async function updateBetResult(id, result, profit) {
    const c = await ensureClient();
    if (!c) return { ok: false };
    const { error } = await c.from('bet_history').update({ result, profit }).eq('id', id);
    return { ok: !error, error };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIPS (sincronizado entre devices)
  // ─────────────────────────────────────────────────────────────────────────
  async function getSlip() {
    const c = await ensureClient();
    if (!c || !getUserId()) return null;
    const { data, error } = await c.from('slips').select('*').eq('user_id', getUserId()).single();
    if (error) return null;
    return data;
  }
  async function saveSlip(slip) {
    const c = await ensureClient();
    if (!c || !getUserId()) return { ok: false };
    const row = {
      user_id: getUserId(),
      legs: slip.legs || [],
      stake: slip.stake || 1000,
      updated_at: new Date().toISOString()
    };
    // Upsert (insert si no existe, update si existe)
    const { error } = await c.from('slips').upsert(row, { onConflict: 'user_id' });
    return { ok: !error, error };
  }

  /** Subscribe a cambios del slip (multi-device sync). Devuelve unsubscribe. */
  function subscribeSlip(callback) {
    let channel = null;
    ensureClient().then(c => {
      if (!c || !getUserId()) return;
      channel = c.channel('slip:' + getUserId())
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'slips', filter: `user_id=eq.${getUserId()}` },
          (payload) => callback(payload.new || payload.old))
        .subscribe();
    });
    return () => { if (channel) channel.unsubscribe(); };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SAVED PICKS
  // ─────────────────────────────────────────────────────────────────────────
  async function savePick(pick) {
    const c = await ensureClient();
    if (!c || !getUserId()) return { ok: false };
    const { data, error } = await c.from('saved_picks').insert({
      user_id: getUserId(),
      pick
    }).select().single();
    return { ok: !error, data, error };
  }
  async function listSavedPicks({ limit = 50 } = {}) {
    const c = await ensureClient();
    if (!c || !getUserId()) return [];
    const { data, error } = await c.from('saved_picks')
      .select('*').eq('user_id', getUserId())
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  }
  async function deleteSavedPick(id) {
    const c = await ensureClient();
    if (!c) return { ok: false };
    const { error } = await c.from('saved_picks').delete().eq('id', id);
    return { ok: !error, error };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────────────────────────────────
  global.BSSupabase = {
    isConfigured,
    ensureClient,
    // Auth
    signUp, signIn, signOut, getSession, isAuthed, getUserId, getProfile, upgradeToVip,
    // Bankroll
    getBankroll, updateBankroll,
    // History
    listHistory, addBet, updateBetResult,
    // Slips
    getSlip, saveSlip, subscribeSlip,
    // Saved picks
    savePick, listSavedPicks, deleteSavedPick
  };

  // Auto-init si está configurado (no bloquea, corre en background)
  if (isConfigured()) {
    ensureClient().catch(e => console.warn('[supabase] init failed:', e?.message));
  }
})(window);
