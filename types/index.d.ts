export type Contagem = {
  segundosClaude: number
  segundosSessao: number
  turnos: number
  entrada: number
  saida: number
  cacheLido: number
  cacheGravado: number
  usd: number
}

export type Projeto = Contagem & {
  nome: string
  primeiroUso: string
  ultimoUso: string
  sessoes: string[]
  dias: Record<string, Contagem>
}

export type Livro = { versao: 1; projetos: Record<string, Projeto> }

export type Periodo = 'hoje' | '7d' | '30d' | 'tudo'

/** O que o painel precisa para contar o turno em andamento. */
export type AoVivo = { turnoDesde: number | null; pausaAntes: number; agora: number }

declare module 'claude-code' {
  interface PluginState {
    'metricas-projeto': { livro: Shaped<Livro | null>; periodo: Periodo; aoVivo: AoVivo }
  }
}
