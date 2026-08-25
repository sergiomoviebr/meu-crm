# Claudex — loop de planejamento com revisão adversarial

Implementação local do fluxo "Claudex" (`skill auxiliar/claudex_conteudo_completo.md`):
Claude Code escreve um `PLAN.md`, a Codex CLI critica como revisor adversarial,
Claude Code revisa, e o ciclo repete por N rodadas antes de liberar a execução.

Vive inteiramente em `.claude/` (não versionado — o repositório já ignora
`.claude/` por completo) e `.claudex/` na raiz do projeto (estado efêmero,
também ignorado). `PLAN.md` **é** versionável — é o entregável real.

## Uso

```
/claudex plan <descrição do que construir>
/claudex plan -5 <descrição>          # 5 rodadas em vez do padrão (3)
/claudex plan construir X usando @scope.md e @architecture.md
/claudex review @PLAN.md              # auditoria pontual, sem loop, não edita o plano
/claudex cancel                       # interrompe o loop atual
/claudex restart                      # reinicia do zero com o mesmo tópico
/claudex rollback                     # apaga todo o estado (.claudex/)
```

Depois de `/claudex plan`, não é preciso fazer mais nada manualmente: o hook
de `Stop` (`.claude/hooks/claudex-stop.mjs`) intercepta o fim de cada turno
do Claude e devolve a instrução exata do próximo passo (rodar o runner, ler
os achados, revisar o `PLAN.md`) até completar as rodadas configuradas.
As personas alternam automaticamente: **Engenheiro sênior** → **Segurança**
→ **Ops/SRE**, ciclando se `max_rounds` > 3.

## Pré-requisito: Codex CLI

O runner (`.claude/hooks/claudex-runner.mjs`) chama `codex exec` para gerar
a crítica de cada rodada. **A Codex CLI não está instalada nesta máquina.**
Sem ela, o loop não trava — o runner grava um aviso em
`.claudex/findings-round-N.md` dizendo que nenhuma revisão real aconteceu,
e o Claude segue o loop normalmente (rodadas "vazias"). Para ter revisão
adversarial de verdade:

1. Instale a Codex CLI: https://github.com/openai/codex
2. Autentique: `codex login`
3. Rode `/claudex plan ...` novamente.

Se uma versão mais nova da Codex CLI renomear alguma flag de `codex exec`,
o erro bruto aparece no próprio arquivo de achados da rodada — ajuste as
flags em `claudex-runner.mjs` (comando `execSync('codex exec --full-auto
--sandbox-mode read-only ...')`) conforme necessário.

## Por que o hook nunca deveria atrapalhar o trabalho normal

O hook de `Stop` roda em **todo** fim de turno de **toda** sessão neste
repositório. A primeira coisa que ele faz é checar se `.claudex/state.json`
existe; se não existir, ele sai imediatamente (exit 0, sem saída) — ou seja,
fora de um `/claudex plan` ativo, ele é invisível. Além disso:

- **Fail-open**: qualquer erro inesperado zera o estado e libera o turno —
  nunca trava alguém num loop quebrado.
- **Loop abandonado**: se ninguém tocar no estado por 15 minutos, o hook
  marca o loop como encerrado sozinho.
- **Duas sessões, um projeto**: se outra sessão já "dona" do loop (mesmo
  `session_id`) ainda está ativa (não expirou os 15 min), uma segunda sessão
  não interfere.

## Diferenças em relação ao documento original

- Estado em **JSON** (`state.json`), não YAML — evita adicionar uma
  dependência (`js-yaml`) só para isto; o formato é irrelevante para o
  funcionamento do loop.
- "Lockfile + PID liveness" virou "session_id + expiração de 15 min": mais
  simples e portátil (a máquina é Windows; checar vivacidade de PID de
  forma confiável exigiria chamar `tasklist`), com a mesma garantia prática
  (duas sessões não brigam pelo mesmo loop).
- `/claudex review` não abre um loop — roda o runner uma vez, mostra os
  achados e não edita nada automaticamente, como descrito na seção 26 do
  documento original.
