import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Contagem, Livro, Periodo, Projeto } from '../types'
import {
  barra,
  compacto,
  diaSP,
  dinheiro,
  duracao,
  faixa,
  linhasDoPeriodo,
  livroVazio,
  nomeDoRemoto,
  porDia,
  somar,
  svgPorDia,
  totalTokens,
  ultimosDias,
  zero,
} from './livro'

/**
 * metricas-projeto: conta, por projeto, o tempo de sessão ativa, o tempo do
 * Claude trabalhando, os tokens (com subagentes) e o custo, dia a dia, e mostra
 * tudo num dashboard (/metricas). Os dados ficam só na máquina de quem usa:
 * no $.store do mod e espelhados em ~/.claude/metricas-projetos/livro.json.
 */

const CHAVE = 'livro-v1'
const PAINEL = 'metricas'
const PAUSA_MAX_MS = 15 * 60 * 1000
const PASTA = '.claude/metricas-projetos'
const DIAS_GRAFICO = 14

const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: 'tudo', rotulo: 'Tudo' },
]

const livroAtual = atom({ plugin: 'metricas-projeto', key: 'livro' } as const, null, {
  shape: 'livro-1',
})
const periodo = atom({ plugin: 'metricas-projeto', key: 'periodo' } as const, '7d')

// Estado do processo (recomeça num reload; o livro fica no $.store).
const est = {
  projeto: null as { chave: string; nome: string } | null,
  sessaoId: '',
  fimUltimoTurno: 0,
  ultimoUsd: null as number | null,
  fila: Promise.resolve() as Promise<unknown>,
}

const tokensDe = (u: TurnUsage | undefined): Partial<Contagem> =>
  u
    ? {
        entrada: u.input_tokens,
        saida: u.output_tokens,
        cacheLido: u.cache_read_input_tokens,
        cacheGravado: u.cache_creation_input_tokens,
      }
    : {}

async function lerLivro($: EngineInterface): Promise<Livro> {
  const v = (await $.store.get(CHAVE)) as Livro | undefined
  return v && v.versao === 1 ? v : livroVazio()
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

async function espelharEmArquivo($: EngineInterface, livro: Livro) {
  const home = await $.env.get('HOME')
  if (home) await $.fs.write(`${home}/${PASTA}/livro.json`, JSON.stringify(livro, null, 2))
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
    const sessoes =
      est.sessaoId && !atual.sessoes.includes(est.sessaoId)
        ? [...atual.sessoes, est.sessaoId].slice(-500)
        : atual.sessoes
    const novo: Projeto = {
      ...atual,
      ...somar(atual, delta),
      ultimoUso: new Date(agora).toISOString(),
      sessoes,
      dias: { ...atual.dias, [hoje]: somar(atual.dias[hoje] ?? zero(), delta) },
    }
    livro.projetos[p.chave] = novo
    await $.store.set(CHAVE, livro)
    await update($, livroAtual, () => livro)
    const dia = novo.dias[hoje] ?? zero()
    $.ui.status(`⏱ ${p.nome} hoje: ${duracao(dia.segundosSessao)} · ${compacto(totalTokens(dia))} tokens`)
    await espelharEmArquivo($, livro).catch(() => undefined)
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
      description: 'Abre o dashboard de tempo e tokens por projeto ("/metricas zerar" apaga tudo)',
    })
    const livro = await lerLivro($)
    await update($, livroAtual, () => livro)
    // Custo que a sessão já tinha antes do mod carregar também é deste projeto.
    const usd = (await $.session.usage().catch(() => null))?.cost?.usd
    const chaveUsd = `usd-sessao:${est.sessaoId}`
    const jaContado = ((await $.store.get(chaveUsd)) as number | undefined) ?? 0
    if (usd !== undefined) {
      est.ultimoUsd = usd
      if (usd > jaContado) await lancar($, { usd: usd - jaContado })
      await $.store.set(chaveUsd, usd)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const delta: Partial<Contagem> = tokensDe(e.usage)

    if (e.agentId === undefined) {
      const agora = await $.clock.now()
      const inicio = agora - e.durationMs
      const pausa = est.fimUltimoTurno > 0 ? Math.max(0, inicio - est.fimUltimoTurno) : Infinity
      const turno = Math.max(0, e.durationMs) / 1000
      delta.turnos = 1
      delta.segundosClaude = turno
      delta.segundosSessao = turno + (pausa <= PAUSA_MAX_MS ? pausa / 1000 : 0)
      est.fimUltimoTurno = agora
      delta.usd = await deltaUsd($)
      if (est.sessaoId && est.ultimoUsd !== null) {
        await $.store.set(`usd-sessao:${est.sessaoId}`, est.ultimoUsd)
      }
    }

    await lancar($, delta).catch(() => undefined)
    return r
  })

  on('command.run', { command: 'metricas' }, async ($, e) => {
    await est.fila
    if ((e.args ?? '').trim() === 'zerar') {
      await $.store.delete(CHAVE)
      await update($, livroAtual, () => livroVazio())
      return { text: 'Métricas apagadas.' }
    }
    const { isPlaced } = await $.ui.open({ id: PAINEL, title: 'Métricas' })
    const livro = await lerLivro($)
    const agora = await $.clock.now()
    const hoje = linhasDoPeriodo(livro, 'hoje', agora).reduce((a, l) => somar(a, l.c), zero())
    const resumo = `Hoje: ${duracao(hoje.segundosSessao)} de sessão ativa, ${compacto(totalTokens(hoje))} tokens, ${dinheiro(hoje.usd)}.`
    return { text: isPlaced ? `Dashboard aberto. ${resumo}` : resumo }
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const livro = (await read($, livroAtual)) ?? livroVazio()
    const sel = await read($, periodo)
    const agora = await $.clock.now()
    const colunas = e.props.bodyColumns
    const estreito = colunas < 64

    const linhas = linhasDoPeriodo(livro, sel, agora)
    const total = linhas.reduce((a, l) => somar(a, l.c), zero())
    const maxTempo = Math.max(0, ...linhas.map(l => l.c.segundosSessao))
    const dias = porDia(livro, ultimosDias(agora, DIAS_GRAFICO))
    const horas = dias.map(d => ({ dia: d.dia, horas: d.c.segundosSessao / 3600 }))

    const cartao = (rotulo: string, valor: string, detalhe: string) => (
      <Box flexDirection="column" borderStyle="round" paddingX={1} minWidth={estreito ? 0 : 16} flexGrow={1}>
        <Text dimColor size="caption">
          {rotulo}
        </Text>
        <Text bold size="heading" tabular>
          {valor}
        </Text>
        <Text dimColor size="caption">
          {detalhe}
        </Text>
      </Box>
    )

    const svg = 'Svg' in els ? els.Svg : null
    const largBarra = Math.max(6, Math.min(24, colunas - 46))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection={estreito ? 'column' : 'row'} justifyContent="space-between" gap={1}>
          <Text bold size="title">
            Métricas de trabalho
          </Text>
          <Box flexDirection="row" gap={1}>
            {PERIODOS.map(p => (
              <Button
                key={`periodo-${p.id}`}
                label={p.rotulo}
                variant={p.id === sel ? 'primary' : 'secondary'}
                onPress={() => update($, periodo, () => p.id)}
              />
            ))}
          </Box>
        </Box>

        <Box flexDirection={estreito ? 'column' : 'row'} gap={1}>
          {cartao('Sessão ativa', duracao(total.segundosSessao), `${total.turnos} turnos`)}
          {cartao('Claude trabalhando', duracao(total.segundosClaude), 'executando turnos')}
          {cartao(
            'Tokens',
            compacto(totalTokens(total)),
            `saída ${compacto(total.saida)} · cache ${compacto(total.cacheLido + total.cacheGravado)}`,
          )}
          {cartao('Custo', dinheiro(total.usd), `${linhas.length} projeto(s)`)}
        </Box>

        <Box flexDirection="column">
          <Text bold>Sessão ativa por dia · últimos {DIAS_GRAFICO} dias</Text>
          {svg ? (
            h(svg, {
              source: svgPorDia(horas, Math.max(240, Math.min(720, colunas * 8))),
              alt: `Horas de sessão ativa por dia: ${horas.map(p => `${p.dia} ${p.horas.toFixed(1)} h`).join(', ')}`,
            })
          ) : (
            <Box flexDirection="column">
              <Text color="claude">{faixa(horas.map(p => p.horas))}</Text>
              <Text dimColor size="caption">
                {horas[0]?.dia.slice(5)} → hoje · máx. {Math.max(0, ...horas.map(p => p.horas)).toFixed(1)} h
              </Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Por projeto</Text>
          {linhas.length === 0 && <Text dimColor>Nada registrado neste período ainda.</Text>}
          {linhas.map(l =>
            estreito ? (
              <Box key={`proj-${l.chave}`} flexDirection="column" marginTop={1}>
                <Text bold wrap="truncate-end">
                  {l.nome}
                </Text>
                <Text tabular>
                  {duracao(l.c.segundosSessao)} · {compacto(totalTokens(l.c))} tokens · {dinheiro(l.c.usd)}
                </Text>
                <Text color="claude">{barra(l.c.segundosSessao, maxTempo, largBarra)}</Text>
              </Box>
            ) : (
              <Box key={`proj-${l.chave}`} flexDirection="row" gap={1}>
                <Box width={22}>
                  <Text wrap="truncate-end">{l.nome}</Text>
                </Box>
                <Text color="claude">{barra(l.c.segundosSessao, maxTempo, largBarra)}</Text>
                <Box width={7}>
                  <Text tabular>{duracao(l.c.segundosSessao)}</Text>
                </Box>
                <Box width={7}>
                  <Text tabular dimColor>
                    {compacto(totalTokens(l.c))}
                  </Text>
                </Box>
                <Text tabular dimColor>
                  {dinheiro(l.c.usd)}
                </Text>
              </Box>
            ),
          )}
        </Box>

        <Text dimColor size="caption">
          Sessão ativa = turnos + pausas de até 15 min. Os dados ficam só nesta máquina (~/{PASTA}/livro.json).
        </Text>
      </Box>
    )
  })
}
