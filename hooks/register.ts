import type { EngineInterface, Register, TurnUsage } from 'claude-code'

/**
 * metricas-projeto: conta, por projeto,
 *   - tempo do Claude trabalhando (soma da duração de cada turno do loop principal);
 *   - tempo de sessão ativa (turnos + pausas entre eles de até PAUSA_MAX);
 *   - tokens (entrada, saída, cache lido, cache gravado), incluindo subagentes;
 *   - custo em US$ como o /cost soma.
 * Grava em $.store (vale entre sessões) e espelha em ~/.claude/metricas-projetos/.
 */

type Contagem = {
  segundosClaude: number
  segundosSessao: number
  turnos: number
  entrada: number
  saida: number
  cacheLido: number
  cacheGravado: number
  usd: number
}

type Projeto = Contagem & {
  nome: string
  primeiroUso: string
  ultimoUso: string
  sessoes: string[]
  dias: Record<string, Contagem>
}

type Livro = { versao: 1; projetos: Record<string, Projeto> }

const CHAVE = 'livro-v1'
const PAUSA_MAX_MS = 15 * 60 * 1000
const PASTA = '.claude/metricas-projetos'

const zero = (): Contagem => ({
  segundosClaude: 0,
  segundosSessao: 0,
  turnos: 0,
  entrada: 0,
  saida: 0,
  cacheLido: 0,
  cacheGravado: 0,
  usd: 0,
})

const somar = (a: Contagem, b: Partial<Contagem>): Contagem => ({
  segundosClaude: a.segundosClaude + (b.segundosClaude ?? 0),
  segundosSessao: a.segundosSessao + (b.segundosSessao ?? 0),
  turnos: a.turnos + (b.turnos ?? 0),
  entrada: a.entrada + (b.entrada ?? 0),
  saida: a.saida + (b.saida ?? 0),
  cacheLido: a.cacheLido + (b.cacheLido ?? 0),
  cacheGravado: a.cacheGravado + (b.cacheGravado ?? 0),
  usd: a.usd + (b.usd ?? 0),
})

const tokensDe = (u: TurnUsage | undefined): Partial<Contagem> =>
  u
    ? {
        entrada: u.input_tokens,
        saida: u.output_tokens,
        cacheLido: u.cache_read_input_tokens,
        cacheGravado: u.cache_creation_input_tokens,
      }
    : {}

export const totalTokens = (c: Contagem) => c.entrada + c.saida + c.cacheLido + c.cacheGravado

export const duracao = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
}

export const compacto = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

/** Dia no fuso de São Paulo (UTC-3, sem horário de verão desde 2019). */
const diaSP = (ms: number) => new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10)

/** "git@github.com:dono/repo.git" ou "https://.../dono/repo" → "dono/repo". */
export const nomeDoRemoto = (url: string) => {
  const m = url.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/:]+)$/)
  return m ? m[1] : null
}

async function lerLivro($: EngineInterface): Promise<Livro> {
  const v = (await $.store.get(CHAVE)) as Livro | undefined
  return v && v.versao === 1 ? v : { versao: 1, projetos: {} }
}

export const relatorio = (livro: Livro, hoje: string) => {
  const lista = Object.values(livro.projetos).sort((a, b) => b.segundosSessao - a.segundosSessao)
  if (lista.length === 0) return 'Nenhuma métrica registrada ainda.'
  const linhas = [
    '| Projeto | Sessão ativa | Claude trabalhando | Turnos | Tokens (entrada/saída/cache) | Custo | Hoje |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const p of lista) {
    const d = p.dias[hoje]
    linhas.push(
      `| ${p.nome} | ${duracao(p.segundosSessao)} | ${duracao(p.segundosClaude)} | ${p.turnos} | ` +
        `${compacto(totalTokens(p))} (${compacto(p.entrada)}/${compacto(p.saida)}/${compacto(p.cacheLido + p.cacheGravado)}) | ` +
        `US$ ${p.usd.toFixed(2)} | ${d ? `${duracao(d.segundosSessao)}, ${compacto(totalTokens(d))}` : '—'} |`,
    )
  }
  return linhas.join('\n')
}

// Estado do processo (recomeça num reload; o livro fica no $.store).
const est = {
  projeto: null as { chave: string; nome: string } | null,
  sessaoId: '',
  fimUltimoTurno: 0,
  ultimoUsd: null as number | null,
  fila: Promise.resolve() as Promise<unknown>,
}

async function descobrirProjeto($: EngineInterface) {
  if (est.projeto) return est.projeto
  const repo = await $.session.repo().catch(() => null)
  const raiz = repo?.root ?? (await $.session.root())
  const nome =
    (repo?.remote && nomeDoRemoto(repo.remote)) || raiz.split('/').filter(Boolean).pop() || raiz
  est.projeto = { chave: nome.toLowerCase(), nome }
  return est.projeto
}

async function espelharEmArquivo($: EngineInterface, livro: Livro, agora: number) {
  const home = await $.env.get('HOME')
  if (!home) return
  const pasta = `${home}/${PASTA}`
  const md =
    `# Métricas por projeto (Claude Code)\n\nAtualizado em ${new Date(agora).toISOString()} (UTC).\n\n` +
    relatorio(livro, diaSP(agora)) +
    '\n\n- **Sessão ativa**: turnos do Claude + pausas entre eles de até 15 min.\n' +
    '- **Claude trabalhando**: só o tempo em que o Claude estava executando turnos.\n' +
    '- Tokens incluem subagentes. Custo como o `/cost` soma.\n'
  await $.fs.write(`${pasta}/livro.json`, JSON.stringify(livro, null, 2))
  await $.fs.write(`${pasta}/RELATORIO.md`, md)
}

/** Lança uma soma no livro, em fila para não perder escrita concorrente. */
function lancar($: EngineInterface, delta: Partial<Contagem>) {
  const tarefa = est.fila.then(async () => {
    const p = await descobrirProjeto($)
    const agora = await $.clock.now()
    const hoje = diaSP(agora)
    const livro = await lerLivro($)
    const atual: Projeto = livro.projetos[p.chave] ?? {
      ...zero(),
      nome: p.nome,
      primeiroUso: new Date(agora).toISOString(),
      ultimoUso: '',
      sessoes: [],
      dias: {},
    }
    const novo: Projeto = {
      ...atual,
      ...somar(atual, delta),
      ultimoUso: new Date(agora).toISOString(),
      sessoes: est.sessaoId && !atual.sessoes.includes(est.sessaoId) ? [...atual.sessoes, est.sessaoId].slice(-500) : atual.sessoes,
      dias: { ...atual.dias, [hoje]: somar(atual.dias[hoje] ?? zero(), delta) },
    }
    livro.projetos[p.chave] = novo
    await $.store.set(CHAVE, livro)
    $.ui.status(`⏱ ${p.nome}: ${duracao(novo.segundosSessao)} · ${compacto(totalTokens(novo))} tokens`)
    await espelharEmArquivo($, livro, agora).catch(() => undefined)
  })
  est.fila = tarefa.catch(() => undefined)
  return tarefa
}

/** Diferença de custo desde a última leitura (o custo da sessão é acumulado). */
async function deltaUsd($: EngineInterface) {
  const usd = (await $.session.usage().catch(() => null))?.cost?.usd
  if (usd === undefined) return 0
  const d = est.ultimoUsd === null ? 0 : Math.max(0, usd - est.ultimoUsd)
  est.ultimoUsd = usd
  return d
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    est.sessaoId = await $.session.id().catch(() => '')
    await $.command.register({
      name: 'metricas',
      description: 'Mostra tempo e tokens gastos por projeto (use "/metricas zerar" para apagar)',
    })
    // Custo que a sessão já tinha antes do mod carregar também é deste projeto.
    const usd = (await $.session.usage().catch(() => null))?.cost?.usd
    const jaContado = ((await $.store.get(`usd-sessao:${est.sessaoId}`)) as number | undefined) ?? 0
    if (usd !== undefined) {
      est.ultimoUsd = usd
      if (usd > jaContado) await lancar($, { usd: usd - jaContado })
      await $.store.set(`usd-sessao:${est.sessaoId}`, usd)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const delta: Partial<Contagem> = tokensDe(e.usage)

    if (e.agentId === undefined) {
      const agora = await $.clock.now()
      const turno = Math.max(0, e.durationMs) / 1000
      const inicio = agora - e.durationMs
      const pausa = est.fimUltimoTurno > 0 ? Math.max(0, inicio - est.fimUltimoTurno) : Infinity
      delta.turnos = 1
      delta.segundosClaude = turno
      delta.segundosSessao = turno + (pausa <= PAUSA_MAX_MS ? pausa / 1000 : 0)
      est.fimUltimoTurno = agora
      delta.usd = await deltaUsd($)
      if (est.sessaoId && est.ultimoUsd !== null) await $.store.set(`usd-sessao:${est.sessaoId}`, est.ultimoUsd)
    }

    await lancar($, delta).catch(() => undefined)
    return r
  })

  on('command.run', { command: 'metricas' }, async ($, e) => {
    await est.fila
    if ((e.args ?? '').trim() === 'zerar') {
      await $.store.delete(CHAVE)
      return { text: 'Métricas apagadas.' }
    }
    const livro = await lerLivro($)
    const home = await $.env.get('HOME')
    return {
      text: `${relatorio(livro, diaSP(await $.clock.now()))}\n\nRegistro: ${home}/${PASTA}/RELATORIO.md e livro.json`,
    }
  })
}
