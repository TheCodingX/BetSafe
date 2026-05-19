/* BetSafe — Auth layer (Supabase real + fallback local)
 * ============================================================================
 * Si BSSupabase está configurado, todas las operaciones (login, signup, logout,
 * current, isVip) van contra Supabase. Si no está configurado, fallback al
 * sistema local hardcoded de demo (admin/admin y vip/vip).
 *
 * API surface idéntica al original — el resto del código no necesita cambios.
 * ============================================================================
 */
(function (global) {
  'use strict';

  // Cuentas demo locales (fallback cuando Supabase no está configurado)
  const ACCOUNTS = [
    { user: 'admin', pass: 'admin', tier: 'standard', name: 'Demo Standard', email: 'demo@betsafe.ar' },
    { user: 'vip',   pass: 'vip',   tier: 'vip',      name: 'Demo VIP',      email: 'vip@betsafe.ar' }
  ];

  function supabaseAvailable() {
    return Boolean(global.BSSupabase && global.BSSupabase.isConfigured());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOGIN — soporta tanto email+pass (Supabase) como user+pass (demo local)
  // ─────────────────────────────────────────────────────────────────────────
  async function login(userOrEmail, pass) {
    const id = String(userOrEmail || '').trim();
    const isEmail = id.includes('@');

    // Caso 1: Supabase configurado + viene email → auth real
    if (supabaseAvailable() && isEmail) {
      const r = await BSSupabase.signIn({ email: id, password: pass });
      if (!r.ok) {
        return { ok: false, error: r.error?.message || 'Credenciales inválidas' };
      }
      // Cachear datos en BSStore para compatibilidad con código existente
      const profile = await BSSupabase.getProfile();
      const session = {
        user: id,
        email: id,
        tier: profile?.tier || 'standard',
        name: profile?.name || id.split('@')[0],
        since: Date.now(),
        source: 'supabase'
      };
      BSStore.set(BSStore.KEYS.session, session);
      return { ok: true, session };
    }

    // Caso 2: cuenta demo local (admin/admin, vip/vip)
    const acc = ACCOUNTS.find(a =>
      a.user.toLowerCase() === id.toLowerCase() && a.pass === pass
    );
    if (!acc) {
      const msg = supabaseAvailable()
        ? 'Credenciales inválidas. Usá tu email o probá demo: admin/admin · vip/vip'
        : 'Credenciales inválidas. Probá admin/admin o vip/vip';
      return { ok: false, error: msg };
    }
    const session = {
      user: acc.user, tier: acc.tier, name: acc.name, email: acc.email,
      since: Date.now(), source: 'local'
    };
    BSStore.set(BSStore.KEYS.session, session);
    return { ok: true, session };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SIGNUP — solo disponible con Supabase configurado
  // ─────────────────────────────────────────────────────────────────────────
  async function signUp({ email, password, name }) {
    if (!supabaseAvailable()) {
      return { ok: false, error: 'Sign-up no disponible en modo demo. Configurá Supabase en Settings.' };
    }
    const r = await BSSupabase.signUp({ email, password, name });
    if (!r.ok) return { ok: false, error: r.error?.message || 'No se pudo registrar' };
    const session = {
      user: email, email, tier: 'standard',
      name: name || email.split('@')[0],
      since: Date.now(), source: 'supabase'
    };
    BSStore.set(BSStore.KEYS.session, session);
    return { ok: true, session };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────────────────────────────────
  async function logout() {
    if (supabaseAvailable()) await BSSupabase.signOut().catch(() => {});
    BSStore.del(BSStore.KEYS.session);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION STATE
  // ─────────────────────────────────────────────────────────────────────────
  function current() {
    // Si hay sesión Supabase activa, refrescamos la cache local con sus datos
    if (supabaseAvailable() && BSSupabase.isAuthed()) {
      const cached = BSStore.get(BSStore.KEYS.session);
      if (cached && cached.source === 'supabase') return cached;
      // Inicializa cache si Supabase tiene sesión pero no hay cache local
      const sess = BSSupabase.getSession();
      if (sess?.user) {
        const synthetic = {
          user: sess.user.email,
          email: sess.user.email,
          tier: 'standard',
          name: sess.user.user_metadata?.name || sess.user.email.split('@')[0],
          since: Date.now(),
          source: 'supabase'
        };
        BSStore.set(BSStore.KEYS.session, synthetic);
        // Lazy refresh del tier desde profiles
        BSSupabase.getProfile().then(p => {
          if (p?.tier) {
            synthetic.tier = p.tier;
            BSStore.set(BSStore.KEYS.session, synthetic);
          }
        });
        return synthetic;
      }
    }
    return BSStore.get(BSStore.KEYS.session);
  }

  function isAuthed() {
    if (supabaseAvailable() && BSSupabase.isAuthed()) return true;
    return !!BSStore.get(BSStore.KEYS.session);
  }

  function isVip() {
    const s = current();
    return s && s.tier === 'vip';
  }

  function requireAuth(redirect = 'login.html') {
    if (!isAuthed()) { location.href = redirect; return false; }
    return true;
  }

  async function upgradeToVip() {
    // Si está en Supabase, actualizar la fila en profiles
    if (supabaseAvailable() && BSSupabase.isAuthed()) {
      const r = await BSSupabase.upgradeToVip();
      if (r.ok) {
        const s = BSStore.get(BSStore.KEYS.session);
        if (s) { s.tier = 'vip'; BSStore.set(BSStore.KEYS.session, s); }
        return true;
      }
      return false;
    }
    // Fallback local
    const s = BSStore.get(BSStore.KEYS.session);
    if (!s) return false;
    s.tier = 'vip';
    BSStore.set(BSStore.KEYS.session, s);
    return true;
  }

  // Sincronizar sesión cuando Supabase emite cambios (login/logout en otro tab)
  global.addEventListener('bs:auth-change', (e) => {
    const { event, session } = e.detail || {};
    if (event === 'SIGNED_OUT') {
      BSStore.del(BSStore.KEYS.session);
    } else if (event === 'SIGNED_IN' && session?.user) {
      // current() reconstruirá la cache en el próximo acceso
      current();
    }
  });

  global.BSAuth = {
    login, logout, current, isAuthed, isVip, requireAuth, upgradeToVip,
    signUp,
    ACCOUNTS,
    // Flags
    isSupabaseEnabled: () => supabaseAvailable()
  };
})(window);
