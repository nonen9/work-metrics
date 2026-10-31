# metricas-projeto

Mod do Claude Code que mede o trabalho em cada projeto e guarda um registro persistente.

O que conta, por projeto (nome `dono/repo` do remoto git, ou o nome da pasta):

- **Sessão ativa**: duração dos turnos do Claude mais as pausas entre eles de até 15 minutos.
- **Claude trabalhando**: só o tempo em que o Claude estava executando turnos.
- **Tokens**: entrada, saída, cache lido e cache gravado, incluindo subagentes.
- **Custo** em US$, como o `/cost` soma.
- Tudo também quebrado por dia (fuso de São Paulo).

Onde fica: no armazenamento do mod (`$.store`, vale entre sessões) e espelhado em
`~/.claude/metricas-projetos/livro.json` e `~/.claude/metricas-projetos/RELATORIO.md`.

Comandos: `/metricas` mostra a tabela; `/metricas zerar` apaga tudo.

## Instalação

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install metricas-projeto --marketplace nonen9/work-metrics
```

Responda `y` para adicionar o marketplace e escolha o escopo (`user` para valer em todos os projetos).

Para atualizar depois: `claude plugin update metricas-projeto` e `/reload-plugins`.

## Desenvolvimento

```
claude plugin validate .
claude plugin test .
```
