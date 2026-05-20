/* BetSafe — Onboarding flow (welcome, tour, setup, first pick) */
(function (global) {
  'use strict';

  function start() {
    const html = `
      <div class="stack-lg">
        <div class="text-center">
          <span class="badge badge-brand">Bienvenida</span>
          <h2 class="h2 mt-2">Bienvenido a BetSafe</h2>
          <p class="muted">Configurá tu cuenta en 3 pasos. Podés saltar y completar después.</p>
        </div>
        <div class="ob-stepper" role="progressbar" aria-valuemin="1" aria-valuemax="3" aria-valuenow="1">
          <div class="ob-rail">
            <div class="ob-rail-fill" style="--p:0%"></div>
          </div>
          <ol class="ob-steps">
            <li class="ob-step is-active" data-i="0">
              <span class="ob-step-circle">
                <svg class="ob-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="6" width="18" height="13" rx="2"/>
                  <path d="M3 10h18"/><path d="M7 15h4"/>
                </svg>
                <span class="ob-step-num">1</span>
                <svg class="ob-step-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-11"/></svg>
              </span>
              <span class="ob-step-label">Banca</span>
            </li>
            <li class="ob-step" data-i="1">
              <span class="ob-step-circle">
                <svg class="ob-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M3 12h18"/>
                </svg>
                <span class="ob-step-num">2</span>
                <svg class="ob-step-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-11"/></svg>
              </span>
              <span class="ob-step-label">Deportes</span>
            </li>
            <li class="ob-step" data-i="2">
              <span class="ob-step-circle">
                <svg class="ob-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z"/>
                </svg>
                <span class="ob-step-num">3</span>
                <svg class="ob-step-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-11"/></svg>
              </span>
              <span class="ob-step-label">Riesgo</span>
            </li>
          </ol>
        </div>
        <div id="obStep"></div>
        <div class="row between">
          <button class="btn btn-ghost" id="obSkip">Saltar</button>
          <div class="cluster">
            <button class="btn btn-outline" id="obBack" disabled>Atrás</button>
            <button class="btn btn-primary mag" id="obNext">Siguiente</button>
          </div>
        </div>
      </div>
    `;
    const { close, modal } = BSUI.openModal(html, { large: true });
    let step = 0;
    const data = {
      bankroll: 100000,
      sports: ['soccer', 'basketball'],
      // Always use ALL 12 Argentine legal books — user no longer picks
      books: (BSData.BOOKS_AR || []).map(b => b.key),
      risk: 'eq',
      notifications: false
    };
    const stepEls = modal.querySelectorAll('.ob-step');
    const railFill = modal.querySelector('.ob-rail-fill');
    const stepperRoot = modal.querySelector('.ob-stepper');
    const obBack = modal.querySelector('#obBack');
    const obNext = modal.querySelector('#obNext');
    const obSkip = modal.querySelector('#obSkip');
    const stepHost = modal.querySelector('#obStep');

    function renderStep() {
      stepEls.forEach((s, i) => {
        s.classList.toggle('is-active', i === step);
        s.classList.toggle('is-done',   i <  step);
      });
      // Progress bar fill (0%, 50%, 100%)
      const pct = step === 0 ? 0 : step === 1 ? 50 : 100;
      if (railFill) railFill.style.setProperty('--p', pct + '%');
      stepperRoot?.setAttribute('aria-valuenow', String(step + 1));
      obBack.disabled = step === 0;
      obNext.textContent = step === 2 ? 'Generar mi primer pick' : 'Siguiente';
      stepHost.innerHTML = stepHtml(step, data);
      bindStep(stepHost, data, step);
    }

    // Click step circles to jump (only to completed/current — no skipping forward)
    stepEls.forEach((el) => el.addEventListener('click', () => {
      const i = Number(el.dataset.i);
      if (i <= step) { step = i; renderStep(); }
    }));
    function next() {
      if (step < 2) { step++; renderStep(); }
      else { finish(); }
    }
    function back() { if (step > 0) { step--; renderStep(); } }
    function finish() {
      BSStore.set(BSStore.KEYS.onboarding, { done: true, ...data });
      BSStore.set(BSStore.KEYS.bankroll, { current: data.bankroll, initial: data.bankroll, history: [{ at: Date.now(), value: data.bankroll }] });
      BSUI.toast({ title: 'Tu setup está listo', message: 'Generamos tu primer pick.', type: 'success' });
      close();
      setTimeout(() => { BSDash.go('ai'); }, 250);
    }

    obNext.addEventListener('click', next);
    obBack.addEventListener('click', back);
    obSkip.addEventListener('click', () => { BSStore.set(BSStore.KEYS.onboarding, { done: true, skipped: true }); close(); });

    renderStep();
  }

  function stepHtml(step, d) {
    if (step === 0) return `
      <div class="stack">
        <h3 class="h4">¿Cuál es tu banca actual?</h3>
        <p class="muted tiny">La usamos para calcular Kelly, drawdown y stake recomendado.</p>
        <div class="input-group" style="max-width:280px">
          <span class="icon">$</span>
          <input id="ob-bankroll" type="number" class="input" value="${d.bankroll}" min="0" step="1000" />
        </div>
      </div>`;
    if (step === 1) return `
      <div class="stack">
        <h3 class="h4">Tus deportes favoritos</h3>
        <p class="muted tiny">Filtramos picks y comparador a estos. Vamos a comparar siempre las casas argentinas legales en cada partido.</p>
        <div class="mt-2">
          <strong class="tiny">Deportes</strong>
          <div class="cluster mt-2" id="ob-sports">${BSData.SPORTS.slice(0,8).map(s =>
            `<label class="check"><input type="checkbox" value="${s.key}" ${d.sports.includes(s.key)?'checked':''}><span class="box"></span><span>${s.name}</span></label>`).join('')}</div>
        </div>
        <div class="card card-tinted mt-3" style="font-size:.85rem">
          <strong>Comparamos las 6 casas legales AR principales en tiempo real.</strong>
          <span class="muted"> Bplay, Betano, BetWarrior, Bet365 AR, Codere, Betsson — sin que tengas que elegir.</span>
        </div>
      </div>`;
    return `
      <div class="stack">
        <h3 class="h4">Apetito de riesgo</h3>
        <p class="muted tiny">Esto filtra cuotas en el comparador.</p>
        <div class="risk-cards" role="radiogroup" aria-label="Apetito de riesgo">
          ${[
            { v: 'low',  label: 'Conservador', desc: 'Cuotas 1.10–1.40',  caption: 'Pocas pérdidas, profit lento, drawdown bajo' },
            { v: 'mid',  label: 'Equilibrado', desc: 'Cuotas 1.40–2.30',  caption: 'Balance entre frecuencia y upside' },
            { v: 'high', label: 'Agresivo',    desc: 'Cuotas 2.30–5.00',  caption: 'Más varianza, mayor potencial de profit' }
          ].map((o, i) => `
            <button type="button" class="risk-card${d.risk===o.v?' is-selected':''}" role="radio" aria-checked="${d.risk===o.v}" data-risk="${o.v}" tabindex="${d.risk===o.v?0:-1}">
              <span class="risk-card-head">
                <span class="risk-card-icon">
                  ${o.v==='low'  ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/></svg>' : ''}
                  ${o.v==='mid'  ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>' : ''}
                  ${o.v==='high' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>' : ''}
                </span>
                <span class="risk-card-tick">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-11"/></svg>
                </span>
              </span>
              <strong class="risk-card-label">${o.label}</strong>
              <span class="risk-card-desc">${o.desc}</span>
              <span class="risk-card-caption">${o.caption}</span>
            </button>`).join('')}
        </div>
        <label class="check mt-3"><input type="checkbox" id="ob-notif" ${d.notifications?'checked':''}><span class="box"></span><span>Activar notificaciones in-app</span></label>
        <div class="card card-tinted mt-3" style="font-size:.85rem">
          <strong>Verificación de edad +18.</strong> Tu sesión se marca como verificada al continuar. Si necesitás ayuda: <a href="responsable.html" class="text-brand">juego responsable</a>.
        </div>
      </div>`;
  }

  function bindStep(root, d, step) {
    if (step === 0) {
      root.querySelector('#ob-bankroll')?.addEventListener('input', e => d.bankroll = Number(e.target.value || 0));
    } else if (step === 1) {
      root.querySelectorAll('#ob-sports input').forEach(i => i.addEventListener('change', () => {
        d.sports = Array.from(root.querySelectorAll('#ob-sports input:checked')).map(x => x.value);
      }));
      // Books are auto-set to all 12 AR books — no UI to bind
    } else if (step === 2) {
      const cards = root.querySelectorAll('.risk-card');
      function setActive(value) {
        d.risk = value;
        cards.forEach(c => {
          const sel = c.dataset.risk === value;
          c.classList.toggle('is-selected', sel);
          c.setAttribute('aria-checked', sel ? 'true' : 'false');
          c.tabIndex = sel ? 0 : -1;
        });
      }
      cards.forEach(c => {
        c.addEventListener('click', () => setActive(c.dataset.risk));
        c.addEventListener('keydown', e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const arr = Array.from(cards); const i = arr.findIndex(x => x.classList.contains('is-selected'));
            const nxt = arr[(i + 1) % arr.length]; setActive(nxt.dataset.risk); nxt.focus();
          }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const arr = Array.from(cards); const i = arr.findIndex(x => x.classList.contains('is-selected'));
            const prev = arr[(i - 1 + arr.length) % arr.length]; setActive(prev.dataset.risk); prev.focus();
          }
        });
      });
      root.querySelector('#ob-notif')?.addEventListener('change', e => d.notifications = e.target.checked);
    }
  }

  global.BSOnboarding = { start };
})(window);
