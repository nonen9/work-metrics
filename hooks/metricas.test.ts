import { expect, mock, test } from 'claude-code/testing'

test('soma tempo, tokens e custo no projeto do repositório', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 31, 15) })
  mock.store(on)
  mock.env(on, { HOME: '/home/teste' })
  let usd = 1.5
  const escritos: Record<string, string> = {}
  on('session.repo', () => ({
    value: { root: '/w/caroletta', remote: 'git@github.com:nonen9/caroletta.git', internal: false, name: null },
  }))
  on('session.root', () => ({ value: '/w/caroletta' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as any, rateLimits: [], cost: { usd } } }))
  on('command.register', () => ({ value: { command: 'metricas' } }))
  on('fs.write', (_, e) => {
    escritos[e.path] = e.text
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/w/caroletta', surface: 'desktop', isInteractive: true })

  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, model: 'm' }
  await clock.advance(120_000)
  usd = 2
  await $.turn.complete({ turnId: 't1', durationMs: 120_000, isAborted: false, reason: 'answer', answer: 'ok', usage })
  // pausa de 5 min (conta na sessão), depois turno de 60 s
  await clock.advance(300_000)
  await clock.advance(60_000)
  await $.turn.complete({ turnId: 't2', durationMs: 60_000, isAborted: false, reason: 'answer', answer: 'ok', usage })
  // turno de subagente: só tokens
  await $.turn.complete({ turnId: 't3', agentId: 'a1', durationMs: 5_000, isAborted: false, reason: 'answer', answer: 'ok', usage })

  const livro = JSON.parse(escritos['/home/teste/.claude/metricas-projetos/livro.json'] ?? '{}')
  const p = livro.projetos['nonen9/caroletta']
  expect(p.turnos).toBe(2)
  expect(Math.round(p.segundosClaude)).toBe(180)
  expect(Math.round(p.segundosSessao)).toBe(480)
  expect(p.saida).toBe(150)
  expect(p.cacheLido).toBe(3000)
  expect(Math.round(p.usd * 100)).toBe(200)
  expect(escritos['/home/teste/.claude/metricas-projetos/RELATORIO.md']).toContain('nonen9/caroletta')

  const r = await $.command.run({ command: 'metricas', args: '' } as any)
  expect(r.text).toContain('8min')
})
