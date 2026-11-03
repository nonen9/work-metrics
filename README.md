# metricas-projeto

Mod do Claude Code que mede o trabalho em cada projeto e mostra tudo num dashboard ao lado do chat.

## O que mede

Por projeto (nome `dono/repo` do remoto git, ou o nome da pasta), dia a dia:

- **Sessão ativa**: duração dos turnos do Claude mais as pausas entre eles de até 15 minutos.
- **Claude trabalhando**: só o tempo em que o Claude estava executando turnos.
- **Tokens**: entrada, saída, cache lido e cache gravado, incluindo subagentes.
- **Custo** em US$, como o `/cost` soma.

## Dashboard

O painel abre sozinho na barra lateral quando a sessão começa e se atualiza em tempo real:
enquanto o Claude trabalha, o turno em andamento entra na conta (a cada 15 s) e o título mostra
**● ao vivo**. Se você fechar o painel, `/metricas` abre de novo. Ele tem:

- filtro de período: Hoje, 7 dias, 30 dias, Tudo;
- cartões com sessão ativa, tempo do Claude, tokens e custo do período;
- gráfico de horas por dia nos últimos 14 dias;
- ranking dos projetos com barra de tempo, tokens e custo.

A barra de status mostra o dia do projeto atual: `⏱ dono/repo hoje: 1h12 · 340k tokens`.
`/metricas zerar` apaga tudo.

## Privacidade

Os números ficam só na máquina de quem usa: no armazenamento do mod e espelhados em
`~/.claude/metricas-projetos/livro.json`. O mod não envia nada para lugar nenhum, e este repositório
contém apenas o código.

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

## Licença

MIT. Veja [LICENSE](LICENSE).
