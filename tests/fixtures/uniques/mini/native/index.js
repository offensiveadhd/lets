/**
 * mini — the native view of the test fixture (docs/NATIVE.md). The smallest
 * view that exercises every part of the contract: init, render, commands,
 * actions, a snapshot reply, export (Send to Claude), restore (mini.load),
 * and the mistakes the host must catch.
 */
lets.native({
  init(ctx) {
    return { pings: 0, note: '', items: [], intent: ctx.args && ctx.args.intent ? String(ctx.args.intent) : '', resumed: null };
  },

  render(state, ui, ctx) {
    return ui.col({ gap: 1 },
      ui.text({ bold: true }, 'mini ', ui.text({ dimColor: true }, `v${ctx.version} · native ${ctx.native} · ${ctx.viewport.cols}x${ctx.viewport.rows}`)),
      state.intent ? ui.text({ italic: true }, `intent: ${state.intent}`) : null,
      state.resumed ? ui.text({ color: 'success' }, `resumed session ${state.resumed}`) : null,
      ui.row({ gap: 1 }, ui.button({ key: 'ping', label: `ping (${state.pings})` }), ui.button({ key: 'boom', label: 'boom', dimColor: true }), ui.button({ key: 'kid' }, ui.text({}, 'from a child'))),
      ui.input({ key: 'note', label: 'note', value: state.note, placeholder: 'type a note' }),
      ui.select({ key: 'kind', label: 'kind', options: [{ value: 'a' }, { value: 'b', label: 'Bee' }], value: state.kind || 'a' }),
      ui.col({}, state.items.map((it, i) => ui.text({}, `${i + 1}. ${it}`))),
      ui.svg({ source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><circle cx="5" cy="5" r="${Math.min(4, state.pings)}" fill="url(#g)"/></svg>`, alt: `${state.pings} pings`, width: 40, height: 40 }),
      ui.markdown('**bold** and `code`'),
      ui.code({ source: JSON.stringify({ pings: state.pings }), language: 'json' }),
      ui.link({ href: 'https://example.com', label: 'example' }),
      { t: 'Bogus', p: { alt: 'an unknown element' } },
    );
  },

  on: {
    'mini.load'(state, data, ctx) {
      state.items = Array.isArray(data.items) ? data.items.map(String) : [];
      state.note = typeof data.note === 'string' ? data.note : state.note;
      if (data.session && data.session.resumed) state.resumed = data.session.id;
      ctx.emit('mini.ping', { loaded: state.items.length });
    },
    'mini.snapshot'(state, data, ctx) { ctx.reply('mini.snapshot', { note: state.note, items: state.items, pings: state.pings }); },
    'mini.add'(state, data) { state.items.push(String(data.item || 'item')); },
    'mini.toast'(state, data, ctx) { ctx.toast(String(data.text || 'hi'), data.level); },
    'mini.spin'() { for (;;) { /* a handler that never returns: the host stops it */ } },
    'mini.huge'(state) { state.blob = 'x'.repeat(1100000); },
    'mini.log'() { console.log('a log line', { ok: true }); console.warn('careful'); },
    'mini.replace'(state, data) { return { pings: 100, note: 'replaced', items: [], intent: '', resumed: null }; },
    'mini.fail'() { throw new Error('nope'); },
    async 'mini.async'(state) { state.pings = 42; },                                       // refused: handlers are synchronous
    'mini.halfway'(state) { state.items.push('halfway'); throw new Error('halfway'); },    // rolled back
    'mini.flood'(state, data, ctx) { for (let i = 0; i < 5000; i++) ctx.emit('mini.ping', { i }); },   // the queue is bounded
    'mini.big'(state, data, ctx) { ctx.emit('mini.ping', { blob: 'x'.repeat(300000) }); },
    'mini.bigexport'(state) { state.bigExport = true; },
    'mini.partial'(state, data, ctx) { ctx.emit('lip.error', { code: 'partial', message: 'skipped 2' }); },
    'mini.echo'(state, data, ctx) { ctx.chat(String(data.text)); },
    'mini.later'(state, data, ctx) { ctx.after(data.ms); },
    'mini.changed'(state, data, ctx) { ctx.emit('mini.changed', { n: data.n }); },
  },

  action(state, act, ctx) {
    if (act.key === 'ping' && act.kind === 'press') { state.pings++; ctx.emit('mini.ping', { n: state.pings }); }
    else if (act.key === 'note' && act.kind === 'submit') state.note = act.value;
    else if (act.key === 'kind' && act.kind === 'select') state.kind = act.value;
    else if (act.key === 'boom') throw new Error('boom pressed');
    else if (act.key === 'kid') ctx.emit('mini.ping', { kid: true });
    else ctx.emit('entity.secret', { name: 'forbidden' });   // not one of mini's domains: dropped by the host
  },

  export(state) { return state.bigExport ? { blob: 'x'.repeat(1100000) } : { note: state.note, items: state.items, pings: state.pings }; },

  destroy(state, ctx) { ctx.emit('mini.ping', { bye: true }); },
});
