import { expect, mock, test } from 'claude-code/testing'

const PAINEL = {
  plugin: 'metricas-projeto',
  component: 'Pane',
  requestId: 'metricas',
  props: {
    title: 'Métricas',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const uso = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 200,
  model: 'm',
}

test('soma tempo, tokens e custo e mostra no dashboard', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 31, 15) })
  mock.store(on)
  mock.env(on, { HOME: '/home/teste' })
  let usd = 1.5
  const escritos: Record<string, string> = {}
  on('session.repo', () => ({
    value: { root: '/w/projeto', remote: 'git@github.com:exemplo/projeto.git', internal: false, name: null },
  }))
  on('session.root', () => ({ value: '/w/projeto' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as any, rateLimits: [], cost: { usd } } }))
  on('command.register', () => ({ value: { command: 'metricas' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.write', (_, e) => {
    escritos[e.path] = e.text
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/w/projeto', surface: 'desktop', isInteractive: true })

  await clock.advance(120_000)
  usd = 2
  await $.turn.complete({ turnId: 't1', durationMs: 120_000, isAborted: false, reason: 'answer', answer: 'ok', usage: uso })
  await clock.advance(300_000) // pausa de 5 min: conta na sessão ativa
  await clock.advance(60_000)
  await $.turn.complete({ turnId: 't2', durationMs: 60_000, isAborted: false, reason: 'answer', answer: 'ok', usage: uso })
  // turno de subagente: só tokens
  await $.turn.complete({ turnId: 't3', agentId: 'a1', durationMs: 5_000, isAborted: false, reason: 'answer', answer: 'ok', usage: uso })

  const livro = JSON.parse(escritos['/home/teste/.claude/metricas-projetos/livro.json'] ?? '{}')
  const p = livro.projetos['exemplo/projeto']
  expect(p.turnos).toBe(2)
  expect(Math.round(p.segundosClaude)).toBe(180)
  expect(Math.round(p.segundosSessao)).toBe(480)
  expect(p.saida).toBe(150)
  expect(p.cacheLido).toBe(3000)
  expect(Math.round(p.usd * 100)).toBe(200)

  const r = await $.command.run({ command: 'metricas', args: '' } as any)
  expect(r.text).toContain('Dashboard aberto')

  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PAINEL, surface })
    expect((await ui.find({ type: 'Text', text: /exemplo\/projeto/ }))?.text).toBe('exemplo/projeto')
    expect((await ui.find({ type: 'Text', text: /^8min$/ }))?.text).toBe('8min')
    await ui.press({ key: 'periodo-hoje' })
    expect((await ui.find({ type: 'Text', text: /US\$ 2\.00/ }))?.text).toBe('US$ 2.00')
    await ui.unmount()
  }
})

test('sem dados, o dashboard diz que não há nada', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 31, 15) })
  const ui = await $.ui.mount({ ...PAINEL, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Nada registrado/ }))?.text).toBe('Nada registrado neste período ainda.')
  await ui.unmount()
})

test('abre o painel sozinho e conta o turno em andamento ao vivo', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 31, 15) })
  mock.store(on)
  mock.env(on, { HOME: '/home/teste' })
  const abertos: string[] = []
  on('session.repo', () => ({
    value: { root: '/w/projeto', remote: 'git@github.com:exemplo/projeto.git', internal: false, name: null },
  }))
  on('session.root', () => ({ value: '/w/projeto' }))
  on('session.id', () => ({ value: 'sess-2' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as any, rateLimits: [], cost: { usd: 0 } } }))
  on('command.register', () => ({ value: { command: 'metricas' } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    abertos.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd: '/w/projeto', surface: 'desktop', isInteractive: true })
  expect(abertos).toEqual(['metricas'])

  await $.turn.start({ turnId: 't1', text: 'oi' })
  await clock.advance(5 * 60_000)

  const ui = await $.ui.mount({ ...PAINEL, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ao vivo/ }))?.text).toBe('● ao vivo')
  expect((await ui.find({ type: 'Text', text: /^5min$/ }))?.text).toBe('5min')
  await ui.unmount()
})
