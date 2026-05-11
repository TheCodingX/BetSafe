/* BetSafe — localStorage persistence layer + simple event bus */
(function (global) {
  'use strict';

  const KEYS = {
    session: 'betsafe.session',
    theme: 'bs:theme',
    slip: 'bs:slip',
    favorites: 'bs:favorites',
    watchlist: 'bs:watchlist',
    watchlists: 'bs:watchlists',
    recent: 'bs:recent',
    pinned: 'bs:pinned_bets',
    linehist: 'bs:linehist',
    elo: 'bs:elo',
    vipAlerts: 'bs:vip:alerts',
    arbHistory: 'bs:arb:history',
    filters: 'bs:filters',
    promos: 'bs:promos',
    accounts: 'bs:accounts',
    apiKey: 'bs:api_key',
    courseProgress: 'bs:course_progress',
    token: 'bs:token',
    onboarding: 'bs:onboarding',
    age: 'bs:age_verified',
    cookies: 'bs:cookie_consent',
    bankroll: 'bs:bankroll',
    history: 'bs:history',
    notifications: 'bs:notifications',
    settings: 'bs:settings'
  };

  function get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); emit('change:' + key, value); return true; }
    catch { return false; }
  }
  function del(key) { try { localStorage.removeItem(key); emit('change:' + key, null); } catch {} }

  // Event bus
  const _listeners = {};
  function on(evt, fn) { (_listeners[evt] ||= []).push(fn); return () => off(evt, fn); }
  function off(evt, fn) { if (_listeners[evt]) _listeners[evt] = _listeners[evt].filter(f => f !== fn); }
  function emit(evt, payload) { (_listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); (_listeners['*'] || []).forEach(fn => fn(evt, payload)); }

  // ─────────────────────────────────────────────────────────────────────────
  // CLOUD SYNC — Supabase-aware persistencia para entidades importantes
  // (bankroll, slip, history). Cae a localStorage si Supabase no está activo.
  // ─────────────────────────────────────────────────────────────────────────
  function cloudOK() {
    return global.BSSupabase && global.BSSupabase.isConfigured() && global.BSSupabase.isAuthed();
  }

  const cloud = {
    async getBankroll() {
      if (cloudOK()) {
        const r = await global.BSSupabase.getBankroll();
        if (r) { set(KEYS.bankroll, r); return r; }
      }
      return get(KEYS.bankroll);
    },
    async setBankroll(bk) {
      set(KEYS.bankroll, bk);
      if (cloudOK()) await global.BSSupabase.updateBankroll(bk.current).catch(() => {});
      return bk;
    },
    async getSlip() {
      if (cloudOK()) {
        const r = await global.BSSupabase.getSlip();
        if (r) { set(KEYS.slip, r); return r; }
      }
      return get(KEYS.slip);
    },
    async saveSlip(slip) {
      set(KEYS.slip, slip);
      if (cloudOK()) await global.BSSupabase.saveSlip(slip).catch(() => {});
      return slip;
    },
    async listHistory(opts = {}) {
      if (cloudOK()) {
        const r = await global.BSSupabase.listHistory(opts);
        if (r && r.length) { set(KEYS.history, r); return r; }
      }
      return get(KEYS.history) || [];
    },
    async addBet(bet) {
      const hist = get(KEYS.history) || [];
      hist.unshift({ ...bet, id: bet.id || ('b' + Date.now()) });
      set(KEYS.history, hist);
      if (cloudOK()) await global.BSSupabase.addBet(bet).catch(() => {});
      return bet;
    },
    async updateBetResult(id, result, profit) {
      const hist = get(KEYS.history) || [];
      const idx = hist.findIndex(h => h.id === id);
      if (idx >= 0) { hist[idx].result = result; hist[idx].profit = profit; set(KEYS.history, hist); }
      if (cloudOK()) await global.BSSupabase.updateBetResult(id, result, profit).catch(() => {});
    },
    /** Subscribe a cambios del slip (multi-device) — devuelve unsubscribe. */
    subscribeSlip(cb) {
      if (cloudOK()) return global.BSSupabase.subscribeSlip(cb);
      return () => {};
    }
  };

  global.BSStore = { KEYS, get, set, del, on, off, emit, cloud };
})(window);
