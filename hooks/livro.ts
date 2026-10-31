// Regras puras do livro de métricas: somas, períodos e formatação. Sem `$`.
import type { Contagem, Livro, Periodo, Projeto } from '../types'

export const zero = (): Contagem => ({
  segundosClaude: 0,
  segundosSessao: 0,
  turnos: 0,
  entrada: 0,
  saida: 0,
  cacheLido: 0,
  cacheGravado: 0,
  usd: 0,
})

export const somar = (a: Contagem, b: Partial<Contagem>): Contagem => ({
  segundosClaude: a.segundosClaude + (b.segundosClaude ?? 0),
  segundosSessao: a.segundosSessao + (b.segundosSessao ?? 0),
  turnos: a.turnos + (b.turnos ?? 0),
  entrada: a.entrada + (b.entrada ?? 0),
  saida: a.saida + (b.saida ?? 0),
  cacheLido: a.cacheLido + (b.cacheLido ?? 0),
  cacheGravado: a.cacheGravado + (b.cacheGravado ?? 0),
  usd: a.usd + (b.usd ?? 0),
})

export const livroVazio = (): Livro => ({ versao: 1, projetos: {} })

export const totalTokens = (c: Contagem) => c.entrada + c.saida + c.cacheLido + c.cacheGravado

export const duracao = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
}

export const compacto = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${Math.round(n / 1e3)}k`
        : String(Math.round(n))

export const dinheiro = (usd: number) => `US$ ${usd.toFixed(2)}`

/** Dia no fuso de São Paulo (UTC-3, sem horário de verão desde 2019). */
export const diaSP = (ms: number) => new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10)

/** "git@github.com:dono/repo.git" ou "https://.../dono/repo" → "dono/repo". */
export const nomeDoRemoto = (url: string) => {
  const m = url.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/:]+)$/)
  return m ? m[1] : null
}

/** Os dias (AAAA-MM-DD, São Paulo) que terminam em `agora`, do mais antigo ao de hoje. */
export const ultimosDias = (agora: number, n: number) =>
  Array.from({ length: n }, (_, i) => diaSP(agora - (n - 1 - i) * 86_400_000))

const diasDoPeriodo = (periodo: Periodo): number | null =>
  periodo === 'hoje' ? 1 : periodo === '7d' ? 7 : periodo === '30d' ? 30 : null

/** Soma de um projeto dentro do período. */
export const doPeriodo = (p: Projeto, periodo: Periodo, agora: number): Contagem => {
  const n = diasDoPeriodo(periodo)
  if (n === null) return Object.values(p.dias).reduce(somar, zero())
  return ultimosDias(agora, n).reduce((acc, d) => somar(acc, p.dias[d] ?? {}), zero())
}

export type Linha = { chave: string; nome: string; c: Contagem }

/** Projetos com movimento no período, do que tomou mais tempo ao que tomou menos. */
export const linhasDoPeriodo = (livro: Livro, periodo: Periodo, agora: number): Linha[] =>
  Object.entries(livro.projetos)
    .map(([chave, p]) => ({ chave, nome: p.nome, c: doPeriodo(p, periodo, agora) }))
    .filter(l => l.c.turnos > 0 || totalTokens(l.c) > 0 || l.c.usd > 0)
    .sort((a, b) => b.c.segundosSessao - a.c.segundosSessao || totalTokens(b.c) - totalTokens(a.c))

/** Total de todos os projetos por dia, para o gráfico. */
export const porDia = (livro: Livro, dias: string[]) =>
  dias.map(d => ({
    dia: d,
    c: Object.values(livro.projetos).reduce((acc, p) => somar(acc, p.dias[d] ?? {}), zero()),
  }))

export const barra = (valor: number, maximo: number, largura: number) => {
  const n = maximo > 0 ? Math.round((valor / maximo) * largura) : 0
  return '█'.repeat(n) + '░'.repeat(Math.max(0, largura - n))
}

const BLOCOS = ' ▁▂▃▄▅▆▇█'
export const faixa = (valores: number[]) => {
  const max = Math.max(0, ...valores)
  return valores.map(v => (max > 0 ? BLOCOS[Math.round((v / max) * 8)] : BLOCOS[0])).join('')
}

/** Gráfico de colunas em SVG (horas de sessão ativa por dia). */
export const svgPorDia = (pontos: { dia: string; horas: number }[], largura: number) => {
  const altura = 140
  const base = altura - 22
  const topo = 14
  const max = Math.max(0.5, ...pontos.map(p => p.horas))
  const passo = largura / pontos.length
  const coluna = Math.max(4, passo * 0.62)
  const barras = pontos
    .map((p, i) => {
      const h = ((base - topo) * p.horas) / max
      const x = i * passo + (passo - coluna) / 2
      const rotulo = i % Math.ceil(pontos.length / 7) === 0 || i === pontos.length - 1
      return (
        `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${coluna.toFixed(1)}" height="${Math.max(h, p.horas > 0 ? 1 : 0).toFixed(1)}" rx="2" fill="#5b7cfa"><title>${p.dia}: ${p.horas.toFixed(1)} h</title></rect>` +
        (rotulo
          ? `<text x="${(x + coluna / 2).toFixed(1)}" y="${altura - 6}" font-size="10" text-anchor="middle" fill="#8a8f98">${p.dia.slice(8)}/${p.dia.slice(5, 7)}</text>`
          : '')
      )
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" font-family="system-ui, sans-serif">` +
    `<line x1="0" y1="${base}" x2="${largura}" y2="${base}" stroke="#8a8f98" stroke-opacity="0.4"/>` +
    `<text x="0" y="10" font-size="10" fill="#8a8f98">máx. ${max.toFixed(1)} h</text>` +
    barras +
    `</svg>`
  )
}
