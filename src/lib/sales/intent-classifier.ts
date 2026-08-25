export const SALES_INTENTS = [
  'PRECISA_VENDER_MAIS','SATISFEITO','TEM_INTERESSE','SEM_INTERESSE','PEDIU_EXPLICACAO',
  'PERGUNTOU_PRECO','JA_TEM_AGENCIA','JA_TEM_GESTOR','FAZ_INTERNAMENTE',
  'TEVE_EXPERIENCIA_RUIM','SEM_ORCAMENTO','FALAR_DEPOIS','OCUPADO','DESCONFIADO',
  'PEDIU_PORTFOLIO','PEDIU_RESULTADOS','PEDIU_REUNIAO','RESPOSTA_AMBIGUA','HUMANO_NECESSARIO',
] as const;
export type SalesIntent = (typeof SALES_INTENTS)[number];
export type LeadTemperature = 'cold' | 'warm' | 'hot' | 'very_hot';

export interface QualificationResult {
  intent: SalesIntent;
  confidence: number;
  scoreDelta: number;
  temperature: LeadTemperature;
  pain: string | null;
  suggestedReply: string;
  nextAction: string;
  humanHandoff: boolean;
  matchedSignals: string[];
}

const rules: Array<{ intent: SalesIntent; signals: RegExp[]; score: number; pain?: string; reply: string; next: string; handoff?: boolean }> = [
  { intent:'HUMANO_NECESSARIO', signals:[/advogad|jur[ií]dic|processo|contrato|desconto|falar com (uma )?pessoa|atendente humano|irritad|reclama[cç][aã]o/i], score:20, reply:'Entendi. Vou direcionar isso para uma pessoa do time acompanhar com o cuidado necessário.', next:'Assumir atendimento humano', handoff:true },
  { intent:'PEDIU_REUNIAO', signals:[/marcar|agendar|reuni[aã]o|conversar por (call|v[ií]deo)|qual hor[aá]rio/i], score:30, reply:'Faz sentido. Podemos marcar uma conversa de cerca de 30 minutos para entender melhor o processo de vocês. Qual período costuma funcionar melhor?', next:'Agendar reunião' },
  { intent:'SEM_INTERESSE', signals:[/n[aã]o tenho interesse|n[aã]o quero|pode parar|n[aã]o me chama|remov[ae] meu contato/i], score:-40, reply:'Tranquilo, sem problema. Obrigado por me responder 🙌', next:'Encerrar abordagem comercial' },
  { intent:'PERGUNTOU_PRECO', signals:[/quanto custa|qual (o )?valor|pre[cç]o|investimento|mensalidade|or[cç]amento/i], score:15, reply:'Tenho formatos diferentes porque depende bastante do que precisa ser estruturado. Antes de te passar algo que talvez nem faça sentido, posso te fazer duas perguntas rápidas para entender o cenário?', next:'Confirmar permissão para qualificar' },
  { intent:'JA_TEM_AGENCIA', signals:[/j[aá] (tenho|temos|trabalho com).{0,20}ag[eê]ncia|nossa ag[eê]ncia/i], score:5, reply:'Perfeito. A ideia não seria presumir que vocês precisam trocar de agência. O que eu gosto de entender é se aquisição, atendimento e comercial estão trabalhando juntos. Hoje vocês acompanham bem quantos leads entram, avançam e viram venda?', next:'Diagnosticar integração entre aquisição e vendas' },
  { intent:'JA_TEM_GESTOR', signals:[/j[aá] (tenho|temos).{0,20}gestor|gestor de tr[aá]fego/i], score:5, reply:'Tranquilo, inclusive não necessariamente seria uma substituição. Minha análise olha bastante para atendimento, follow-up, CRM, conversão e processo comercial. Essa parte hoje está bem estruturada por aí?', next:'Diagnosticar processo comercial' },
  { intent:'TEVE_EXPERIENCIA_RUIM', signals:[/n[aã]o funcionou|perdi dinheiro|experi[eê]ncia ruim|me decepcionei|tr[aá]fego n[aã]o funciona/i], score:15, pain:'Experiência anterior negativa', reply:'Entendo. Vale separar gerar oportunidade de transformar essa oportunidade em venda. Onde você sentiu que o processo mais falhou: qualidade dos leads, atendimento, acompanhamento ou fechamento?', next:'Identificar onde a experiência falhou' },
  { intent:'SEM_ORCAMENTO', signals:[/sem (dinheiro|or[cç]amento|verba)|n[aã]o cabe no or[cç]amento/i], score:-5, reply:'Entendi. Talvez o timing realmente não seja agora. Isso é algo que você imagina reavaliar mais para frente ou hoje não está entre as prioridades?', next:'Classificar timing' },
  { intent:'FALAR_DEPOIS', signals:[/semana que vem|m[eê]s que vem|depois do dia|me chama (depois|sexta|amanh[aã])|mais pra frente/i], score:5, reply:'Sem problema. Posso deixar combinado de retomar nesse período.', next:'Criar follow-up na data mencionada' },
  { intent:'OCUPADO', signals:[/sem tempo|ocupad|correria|agora n[aã]o posso/i], score:0, reply:'Tranquilo. Posso te chamar em outro momento. Qual período costuma ser mais tranquilo para você?', next:'Definir horário de follow-up' },
  { intent:'PEDIU_RESULTADOS', signals:[/resultado|case|cliente que voc[eê] (atende|atendeu)|funcionou para/i], score:10, reply:'Tenho alguns contextos que consigo mostrar, mas resultado sem contexto pode enganar. Se você me disser onde está o maior desafio, consigo trazer algo mais próximo da realidade do negócio.', next:'Identificar dor antes de apresentar case' },
  { intent:'PEDIU_PORTFOLIO', signals:[/portf[oó]lio|instagram|site|material|apresenta[cç][aã]o/i], score:8, reply:'Claro. Para eu não te enviar algo genérico: faria mais diferença gerar mais oportunidades ou melhorar a conversão das que já chegam?', next:'Selecionar material conforme a dor' },
  { intent:'PEDIU_EXPLICACAO', signals:[/como funciona|o que voc[eê] (faz|vende)|me explica|do que se trata/i], score:10, reply:'Eu olho a estrutura comercial como um todo: aquisição, atendimento, follow-up, CRM e conversão, para encontrar onde o negócio está deixando oportunidades pelo caminho. Hoje o maior desafio está em gerar oportunidades ou converter melhor as que já chegam?', next:'Identificar gargalo principal' },
  { intent:'PRECISA_VENDER_MAIS', signals:[/precisamos? (vender|de clientes)|aumentar (as )?vendas|mais clientes|est[aá] parado|poucas oportunidades|falta(m)? leads?/i], score:20, pain:'Necessidade de aumentar vendas', reply:'Entendi. E hoje o que mais pesa para vocês: gerar novas oportunidades ou transformar melhor em venda as pessoas que já chegam?', next:'Separar aquisição de conversão' },
  { intent:'SATISFEITO', signals:[/est[aá] tudo (bom|bem|[oó]timo)|estamos satisfeitos|n[aã]o precisamos|indo muito bem/i], score:0, reply:'Excelente. Então não faria sentido mexer por mexer. Hoje vocês conseguem acompanhar com clareza de onde vêm as oportunidades e qual percentual realmente vira cliente?', next:'Validar mensuração sem pressionar' },
  { intent:'TEM_INTERESSE', signals:[/quero entender|tenho interesse|pode explicar|estou procurando|faz sentido|vamos conversar/i], score:15, reply:'Ótimo. Para eu entender por onde começar: hoje o desafio está mais em gerar oportunidades ou converter melhor as que já chegam?', next:'Iniciar diagnóstico' },
];

export function classifySalesIntent(text: string, currentScore = 0): QualificationResult {
  const normalized = text.normalize('NFKC').trim();
  let best: (typeof rules)[number] | null = null; let hits: string[] = [];
  for (const rule of rules) {
    const matched = rule.signals.filter((signal) => signal.test(normalized));
    if (matched.length > hits.length) { best = rule; hits = matched.map(String); }
  }
  if (!best || !normalized) return { intent:'RESPOSTA_AMBIGUA', confidence:0.25, scoreDelta:0, temperature:temperature(currentScore), pain:null, suggestedReply:'Obrigado por responder. Hoje vocês estão mais focados em gerar novas oportunidades ou melhorar a conversão das que já chegam?', nextAction:'Fazer uma pergunta de diagnóstico', humanHandoff:false, matchedSignals:[] };
  const score = Math.max(0, currentScore + best.score);
  return { intent:best.intent, confidence:Math.min(0.95, 0.62 + hits.length * 0.12), scoreDelta:best.score, temperature:temperature(score), pain:best.pain ?? null, suggestedReply:best.reply, nextAction:best.next, humanHandoff:!!best.handoff, matchedSignals:hits };
}

function temperature(score: number): LeadTemperature { return score >= 60 ? 'very_hot' : score >= 35 ? 'hot' : score >= 15 ? 'warm' : 'cold'; }
