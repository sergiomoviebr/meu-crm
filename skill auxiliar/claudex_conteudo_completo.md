# Claudex: planejamento inteligente com Claude Code + Codex

## 1. A ideia central

O **Claudex** é um fluxo criado para melhorar planos antes da execução. Em vez de pedir para o Claude Code criar um plano e já começar a desenvolver, o Claudex coloca esse plano em um ciclo de revisão com o Codex.

O Claude Code cria o plano. O Codex critica. O Claude Code revisa. O ciclo se repete. Quando o plano está bom, ele é travado e só então a execução começa.

O objetivo é evitar construir em cima de planos fracos, vagos ou incompletos.

---

## 2. O problema que o Claudex resolve

Muita gente quer começar direto a construir. Isso parece mais rápido no início, mas costuma gerar retrabalho depois.

Quando o plano inicial é ruim, aparecem problemas como:

- requisitos mal definidos;
- decisões técnicas frágeis;
- riscos de segurança ignorados;
- falta de rollback;
- ausência de observabilidade;
- bugs de arquitetura;
- lacunas no escopo;
- retrabalho constante durante a implementação.

A proposta é simples: **gastar mais tempo planejando para gastar menos tempo corrigindo**.

---

## 3. Como o loop do Claudex funciona

### 1. Rascunho

O Claude Code escreve um plano inicial em um arquivo chamado `PLAN.md`. Esse plano contém a ideia da funcionalidade, a abordagem técnica, etapas de implementação, riscos e critérios de conclusão.

### 2. Avaliação crítica

O Codex entra como revisor adversarial. Ele lê o plano e procura falhas, como um engenheiro experiente tentando encontrar problemas antes que eles virem bugs reais.

### 3. Revisão

O Claude Code lê os achados do Codex e atualiza o `PLAN.md`. Ele corrige ambiguidades, adiciona etapas, melhora a arquitetura, ajusta riscos e fortalece a estratégia.

### 4. Repetição

O ciclo pode rodar várias vezes. Por padrão, geralmente são usadas **3 rodadas**. Duas ou três rodadas costumam capturar a maior parte dos problemas importantes sem gastar tokens demais.

### 5. Plano travado

Quando o número máximo de rodadas é atingido, o plano é considerado pronto. A partir daí, ele pode ser executado.

---

## 4. Por que usar Claude Code e Codex juntos

O Claude Code é bom em gerar planos, organizar tarefas e propor implementação. O Codex entra como uma segunda mente técnica, mais crítica, revisando o plano por outro ângulo.

Essa combinação cria uma dinâmica útil:

- Claude propõe;
- Codex questiona;
- Claude melhora;
- Codex revisa de novo;
- o plano evolui.

É como ter um desenvolvedor criando o plano e outro engenheiro sênior revisando antes da execução.

---

## 5. O papel do Claude Code

No Claudex, o Claude Code é responsável por:

- criar o plano inicial;
- estruturar o `PLAN.md`;
- ler os achados do Codex;
- revisar o plano;
- integrar melhorias;
- encerrar cada turno;
- executar o plano final quando ele estiver pronto.

Ele é o agente que escreve e atualiza o plano.

---

## 6. O papel do Codex

O Codex é o revisor crítico. Ele procura problemas que o Claude Code pode ter deixado passar.

Ele analisa pontos como:

- design ruim;
- premissas quebradas;
- escopo ambíguo;
- riscos de autenticação;
- condições de corrida;
- perda de dados;
- rollback mal planejado;
- versionamento;
- observabilidade;
- falhas operacionais.

A função dele não é fazer o trabalho pelo Claude, mas melhorar o plano antes da implementação.

---

## 7. Por que o Codex não precisa escrever código

O Codex pode ser usado apenas para gerar **insights**. Isso torna o processo mais barato e eficiente.

Em vez de pedir para o Codex implementar tudo, ele só revisa o plano e aponta problemas. Depois, o Claude Code usa esses achados para melhorar o `PLAN.md`.

Esse modelo é útil porque muitos erros aparecem antes do código existir. Se você corrige o plano cedo, evita corrigir a implementação tarde.

---

## 8. O comando principal: `/claudex plan`

O comando mais importante é:

```text
/claudex plan
```

Ele inicia o fluxo de planejamento. Você descreve o que quer construir, e o Claude Code cria o plano inicial.

Exemplo:

```text
/claudex plan adicionar expiração para links curtos
```

Ou:

```text
/claudex plan criar uma página de tracking de sessões usando @scope.md e @architecture.md
```

Nesse segundo caso, o Claude pode ler arquivos de escopo e arquitetura antes de criar o plano. Isso melhora a qualidade do planejamento porque o modelo começa com mais contexto.

---

## 9. Número de rodadas

O Claudex permite definir quantas rodadas de revisão serão feitas.

Exemplos:

```text
/claudex plan -3 criar um app de tarefas
```

```text
/claudex plan -5 criar um sistema de autenticação
```

Na prática:

- **1 rodada**: revisão rápida;
- **2 rodadas**: bom equilíbrio para tarefas médias;
- **3 rodadas**: padrão recomendado;
- **5 rodadas**: útil para sistemas mais complexos;
- **10 rodadas**: geralmente exagerado e caro em tokens.

O ideal é não aumentar rodadas sem necessidade.

---

## 10. Outros comandos

### `/review`

Serve para auditar o plano atual. O Codex revisa e gera comentários, mas não altera automaticamente o plano.

### `/cancel`

Funciona como um freio de emergência. Serve para interromper o fluxo caso o prompt inicial tenha sido ruim, o plano esteja indo na direção errada ou não valha gastar mais tokens.

### `/restart`

Serve para reiniciar o ciclo.

### `/rollback`

É uma limpeza mais pesada. Remove arquivos temporários, estado anterior e resíduos de uma execução cancelada.

---

## 11. O Stop Hook

O **Stop Hook** é uma das peças mais importantes do Claudex. Ele funciona como um porteiro no final de cada turno do Claude.

Quando o Claude termina uma etapa, o Stop Hook verifica o estado atual e decide:

- se o Claude pode encerrar;
- ou se precisa continuar o ciclo.

### Permitir

Quando está tudo certo, o Claude sai limpo.

```text
Claude concluiu o plano. Pode encerrar.
```

### Bloquear

Quando ainda há algo a fazer, o hook bloqueia o encerramento e manda executar a próxima etapa.

```text
Execute runner.sh, leia findings-round-1.md e revise o PLAN.md.
```

Na prática, o Stop Hook impede que o processo termine antes da hora.

---

## 12. Por que o Stop Hook é necessário

Sem um Stop Hook, o fluxo poderia ficar imprevisível.

O Claude poderia:

- parar cedo demais;
- rodar rodadas demais;
- esquecer em qual fase está;
- ignorar achados;
- encerrar sem revisar;
- entrar em loop desnecessário.

O Stop Hook cria um controle rígido e garante que cada etapa aconteça na ordem correta.

---

## 13. O arquivo de estado YAML

O Claudex usa um arquivo de estado, geralmente em YAML, para acompanhar o progresso do loop. Esse arquivo funciona como uma memória simples do processo.

Exemplo:

```yaml
mode: plan
phase: reviewing
round: 2
max_rounds: 3
topic: "add expiry to short links"
decision_signal: none
```

### `mode`

Indica o modo atual.

```yaml
mode: plan
```

### `phase`

Indica a fase atual do ciclo.

```yaml
phase: drafting
phase: reviewing
phase: summarizing
phase: done
```

### `round`

Mostra a rodada atual.

```yaml
round: 2
```

### `max_rounds`

Define o limite de rodadas.

```yaml
max_rounds: 3
```

### `topic`

Guarda o assunto principal do plano.

```yaml
topic: "adicionar expiração para links curtos"
```

### `decision_signal`

Pode guardar sinais internos de decisão.

```yaml
decision_signal: none
```

---

## 14. O Runner Script

O **Runner Script** é o script que executa a revisão com o Codex. Ele faz a ponte entre o prompt, o Claude, o Codex e os arquivos de achados.

Fluxo:

1. O Stop Hook prepara um prompt.
2. O Claude executa o `runner.sh`.
3. O runner envia o plano para o Codex revisar.
4. O Codex gera achados.
5. Os achados são salvos em arquivos Markdown.
6. O Claude lê os achados.
7. O Claude atualiza o `PLAN.md`.

---

## 15. O prompt do Runner

O prompt enviado ao Codex pode dizer algo como:

```text
Faça uma revisão adversarial do PLAN.md.
Rodada 2.
Persona: segurança.
Procure lacunas de autenticação, condições de corrida e perda de dados.
Classifique os achados por severidade.
```

Esse prompt orienta o Codex sobre o tipo de revisão desejada.

---

## 16. Os arquivos de achados

Cada rodada gera um arquivo com críticas e recomendações.

Exemplos:

```text
findings-round-1.md
findings-round-2.md
findings-round-3.md
```

Esses arquivos podem conter:

```markdown
## Alto
- Problema crítico de autenticação
- Risco de perda de dados

## Médio
- Ambiguidade no fluxo de expiração
- Falta de métrica de observabilidade

## Baixo
- Melhorar nomes de variáveis
- Detalhar critérios de aceite
```

O Claude lê esses achados e usa para melhorar o plano.

---

## 17. Um ciclo completo passo a passo

### Passo 1 — Claude conclui o turno

Claude cria ou atualiza o `PLAN.md`.

### Passo 2 — Stop Hook dispara

O Stop Hook entra em ação. Ele verifica o arquivo de estado e confirma se o `PLAN.md` existe.

### Passo 3 — Hook atualiza o estado

O hook muda a fase.

```text
drafting -> reviewing
```

Ele também pode escrever ou preparar o `runner.sh`.

### Passo 4 — Hook bloqueia com instruções

O hook retorna `BLOCK`, ou seja, o Claude não pode encerrar ainda.

```text
Execute runner.sh, leia findings-round-1.md e decida o que revisar.
```

### Passo 5 — Claude executa o runner

Claude executa o runner. O Codex revisa o plano. Os achados são escritos em um arquivo.

### Passo 6 — Claude revisa o plano

Claude lê os achados, atualiza o `PLAN.md` e encerra o turno. Depois, o ciclo volta ao passo 2 para a próxima rodada.

---

## 18. As três personas de revisão

### Rodada 1 — Engenheiro sênior

Foco:

- falhas de design;
- arquitetura fraca;
- premissas quebradas;
- requisitos vagos;
- especificações ambíguas;
- decisões sem justificativa;
- dependências mal explicadas.

Pergunta principal:

> Esse plano faz sentido tecnicamente?

### Rodada 2 — Segurança

Foco:

- lacunas de autenticação;
- problemas de autorização;
- condições de corrida;
- perda de dados;
- vazamento de informação;
- validação insuficiente;
- estados inconsistentes;
- abuso de permissões.

Pergunta principal:

> Esse plano pode falhar de forma perigosa?

### Rodada 3 — Ops / SRE

Foco:

- falta de rollback;
- ausência de observabilidade;
- logs insuficientes;
- métricas ausentes;
- desalinhamento de versão;
- migrações arriscadas;
- deploy perigoso;
- falhas de recuperação.

Pergunta principal:

> Esse plano aguenta produção?

---

## 19. A fase de sumarização

Um problema comum em loops automáticos é o encerramento silencioso. Se o processo termina sem explicar nada, o usuário fica se perguntando se funcionou, se terminou, o que foi corrigido e se o plano está pronto.

Por isso, o Claudex adiciona uma fase de sumarização.

Essa fase mostra:

- que o plano foi concluído;
- quantas rodadas foram feitas;
- quantos achados foram encontrados;
- quantos achados foram integrados;
- se ainda há pendências;
- quanto tempo o processo levou;
- se o plano está pronto para execução.

---

## 20. Sem sumarização vs com sumarização

### Sem sumarização

O loop termina em silêncio. O usuário não sabe se deu certo. Isso gera insegurança.

### Com sumarização

O sistema mostra algo como:

```text
Plano concluído.
Rodada 1: 2 achados altos, 4 médios.
Rodada 2: 2 achados altos, 2 médios.
Total: 5 achados críticos tratados.
Plano pronto para execução.
```

Isso dá clareza e confiança.

---

## 21. As seis camadas de segurança

O Claudex também inclui camadas de segurança para evitar falhas no próprio loop.

### 1. Armadilha de erro / fail-open

Se algo quebrar, o usuário não deve ficar preso. O sistema deve falhar de forma segura.

### 2. Escritas atômicas

Arquivos de estado não devem ser lidos enquanto estão pela metade. A escrita pode acontecer em um arquivo temporário e depois ser renomeada.

```text
estado.tmp -> estado.yaml
```

### 3. Transições de fase CAS

CAS significa algo como “compare and swap”. A ideia é só mudar de fase se o estado atual for exatamente o esperado.

```text
Se phase = drafting, então mude para reviewing.
```

### 4. Lockfile + PID liveness

Um lockfile impede que múltiplas execuções mexam no mesmo ciclo ao mesmo tempo. A verificação de PID confirma se o processo associado ao lock ainda está vivo.

### 5. Varredor de loops estagnados

Se um loop antigo ficou abandonado, ele não deve bloquear novos ciclos para sempre. Um varredor limpa loops parados depois de um tempo, por exemplo 15 minutos.

### 6. Validação de CWD

CWD significa “current working directory”, ou diretório atual. Essa validação garante que o hook está rodando no projeto certo.

---

## 22. Falhas prevenidas

Essas camadas de segurança evitam problemas como:

- usuário preso em hook quebrado;
- arquivo de estado lido pela metade;
- dois caminhos tentando avançar o mesmo loop;
- loop morto mantendo lock fantasma;
- loop abandonado bloqueando novos ciclos;
- hook disparando no projeto errado;
- processo encerrando sem resumo;
- revisão incompleta sendo tratada como concluída.

O princípio é:

> o usuário nunca deve ficar preso.

---

## 23. O que muda no plano final

Um plano feito apenas pelo Claude pode ser útil, mas muitas vezes fica superficial.

Depois de passar pelo Claudex, o plano tende a ficar mais forte. Ele passa a incluir:

- etapas mais detalhadas;
- riscos mais claros;
- critérios de aceite melhores;
- plano de rollback;
- logs e métricas;
- validações;
- decisões justificadas;
- tratamento de erros;
- ordem de implementação mais segura;
- pontos de atenção antes da execução.

O resultado não é garantia de perfeição, mas aumenta muito a chance de executar com menos retrabalho.

---

## 24. Exemplo prático

Imagine que você quer criar uma página especial que rastreia comportamento dos usuários.

Ela precisa registrar:

- cliques;
- tempo de permanência;
- sessões;
- eventos importantes;
- comportamento dentro da página.

Sem Claudex, o Claude poderia criar um plano básico:

```text
Criar página.
Adicionar tracking.
Salvar eventos.
Mostrar dashboard.
```

Isso é muito genérico.

Com Claudex, o Codex poderia questionar:

- onde os eventos serão salvos?
- como evitar perda de dados?
- como lidar com usuários anônimos?
- como evitar rastreamento duplicado?
- existe consentimento?
- como garantir performance?
- como reprocessar eventos?
- como fazer rollback?
- quais métricas indicam sucesso?
- como validar a coleta?

Depois disso, o Claude revisaria o plano para incluir essas preocupações. O plano final seria muito mais confiável.

---

## 25. Uso com arquivos de escopo e arquitetura

Uma forma poderosa de usar o Claudex é passar arquivos existentes.

```text
/claudex plan construir a página Pulse usando @scope.md e @architecture.md
```

Isso força o Claude a ler os arquivos antes de planejar. Assim, o plano não nasce só do prompt. Ele nasce a partir de documentos reais.

---

## 26. Uso para revisar planos existentes

O Claudex não serve apenas para criar planos novos. Você também pode usar para revisar algo que já existe.

```text
/claudex review @PLAN.md
```

Nesse caso, o Codex pode apenas auditar e comentar. Isso é útil quando você já tem um plano, mas quer uma segunda opinião técnica.

---

## 27. Quando usar o Claudex

O Claudex é especialmente útil quando:

- o projeto é complexo;
- há risco de segurança;
- há risco de dados;
- a feature afeta produção;
- há várias dependências;
- o escopo está vago;
- o plano precisa ser muito bem pensado;
- você quer reduzir retrabalho;
- precisa documentar melhor antes de executar.

---

## 28. Quando talvez não valha a pena

Nem tudo precisa de Claudex. Para tarefas muito pequenas, pode ser exagero.

Exemplos:

- mudar um texto;
- corrigir um typo;
- ajustar uma cor;
- renomear uma variável;
- criar um arquivo simples;
- fazer uma alteração óbvia.

O Claudex brilha mais em tarefas com incerteza, risco ou complexidade.

---

## 29. Aplicações além de código

Embora o Claudex tenha sido pensado para desenvolvimento, a lógica pode ser usada em outros tipos de trabalho:

- apresentações;
- documentos estratégicos;
- planilhas;
- propostas comerciais;
- roteiros;
- planos de produto;
- especificações técnicas;
- arquitetura de sistemas;
- documentação;
- processos internos.

A ideia é sempre a mesma:

1. criar um plano;
2. revisar criticamente;
3. melhorar;
4. repetir;
5. executar.

---

## 30. Comparação entre os conteúdos vistos

### Conteúdo visual/técnico

Explicava melhor a arquitetura interna:

- o loop do Claudex;
- o Stop Hook;
- o arquivo de estado;
- o Runner Script;
- as três personas;
- a sumarização;
- as seis camadas de segurança.

### Conteúdo narrativo/prático

Explicava melhor:

- por que o Claudex existe;
- como usar;
- quais comandos existem;
- como definir rodadas;
- como usar arquivos de escopo;
- como revisar planos existentes;
- como comparar plano com Claudex vs plano só com Claude;
- como aplicar em projetos reais.

O conteúdo técnico é melhor para entender **como funciona por dentro**. O conteúdo prático é melhor para entender **por que usar e como aplicar**.

---

## 31. Mensagem principal

> Não construa em cima de um plano fraco.

Antes de executar, coloque o plano sob pressão. Faça perguntas difíceis. Procure falhas. Revise. Melhore. Só depois execute.

---

## 32. Versão curta para redes sociais

Claudex é um comando que coloca Claude Code e Codex para planejarem juntos.

Claude cria o plano. Codex critica. Claude revisa. O ciclo repete até o plano ficar forte.

Em vez de usar IA só para escrever código, você usa IA para melhorar o planejamento antes da execução.

Resultado: menos retrabalho, menos decisões frágeis e planos muito mais robustos.

---

## 33. Versão estilo post explicativo

Construir rápido é bom. Construir em cima de um plano ruim é caro.

O Claudex resolve isso criando um loop entre Claude Code e Codex.

Funciona assim:

1. Claude escreve o `PLAN.md`.
2. Codex revisa como um engenheiro adversarial.
3. Claude corrige o plano.
4. O ciclo repete por algumas rodadas.
5. O plano é travado.
6. A execução começa.

Cada rodada pode ter uma persona:

- engenheiro sênior;
- segurança;
- Ops/SRE.

Assim, o plano é revisado por diferentes ângulos antes de virar código.

---

## 34. Versão estilo apresentação

### Slide 1 — O problema

Todo mundo quer construir rápido. Mas planos fracos geram retrabalho.

### Slide 2 — A solução

Claudex combina Claude Code + Codex para revisar planos antes da execução.

### Slide 3 — O loop

Claude cria. Codex critica. Claude revisa. Repete até o plano ficar pronto.

### Slide 4 — As rodadas

Rodada 1: engenharia sênior. Rodada 2: segurança. Rodada 3: Ops/SRE.

### Slide 5 — O Stop Hook

O hook controla o fim de cada turno. Ele decide se o Claude pode sair ou se precisa continuar.

### Slide 6 — O estado

Um arquivo YAML guarda fase, rodada, limite e tópico.

### Slide 7 — O Runner Script

O runner envia o plano para o Codex e salva os achados.

### Slide 8 — Segurança

Camadas de segurança evitam loops quebrados, arquivos incompletos e execução no projeto errado.

### Slide 9 — Resultado

Planos mais detalhados, robustos e seguros.

### Slide 10 — Conclusão

Planejar melhor reduz retrabalho. Claudex transforma revisão em parte do fluxo.

---

## 35. Explicação simples para iniciantes

Pense no Claudex como uma equipe pequena.

O Claude é quem escreve o plano.

O Codex é quem olha o plano e diz:

> “Isso aqui pode dar problema.”

Depois, o Claude corrige. Esse vai e volta acontece algumas vezes. No final, você tem um plano muito melhor do que teria se tivesse aceitado a primeira resposta.

---

## 36. Analogia fácil

O Claudex é como revisar uma planta antes de construir uma casa.

Você não chama os pedreiros imediatamente depois do primeiro desenho.

Antes, um engenheiro olha a estrutura. Um especialista de segurança vê os riscos. Um responsável pela operação pensa na manutenção.

Só depois a construção começa.

Com software é igual. O Claudex tenta revisar a planta antes da obra.

---

## 37. Conclusão final

O Claudex é uma forma de transformar IA em um processo de planejamento mais sério.

Ele não serve apenas para gerar respostas rápidas. Ele cria um sistema de crítica, revisão, melhoria e controle.

A maior força dele está em usar modelos diferentes com papéis diferentes:

- Claude para planejar e integrar;
- Codex para criticar e encontrar falhas;
- Stop Hook para controlar o ciclo;
- YAML para guardar o estado;
- Runner Script para executar as revisões;
- sumarização para dar clareza ao final;
- camadas de segurança para evitar travamentos.

No fim, o Claudex não é só um comando. É uma filosofia de trabalho:

> Antes de pedir para a IA construir, peça para ela provar que o plano aguenta ser construído.
