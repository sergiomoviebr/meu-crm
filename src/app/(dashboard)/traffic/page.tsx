'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Camera,
  ChevronDown,
  DollarSign,
  Eye,
  Loader2,
  Megaphone,
  Save,
  Sparkles,
  Target,
  Users2,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { createClient } from '@/lib/supabase/client';
import {
  aggregateMetrics,
  pctChange,
  type MetricPoint,
} from '@/lib/traffic/signals';
import { useCan } from '@/hooks/use-can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/dashboard/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AdAccount, Contact, TrafficRecommendation } from '@/types';

type Mode = 'client' | 'manager';
type Platform = 'all' | 'meta' | 'google';
type DashboardSection = 'overview' | 'performance' | 'diagnosis' | 'actions';
type ChartMetric = 'spend' | 'leads' | 'cpl';
type AccountWithContact = AdAccount & {
  contact: Pick<Contact, 'id' | 'name' | 'phone'> | null;
};
type Daily = MetricPoint & { entity_id: string };
const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const number = new Intl.NumberFormat('pt-BR');
function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}
function daysInclusive(from: string, to: string) {
  return Math.max(
    1,
    Math.round(
      (new Date(`${to}T12:00:00`).getTime() -
        new Date(`${from}T12:00:00`).getTime()) /
        86_400_000
    ) + 1
  );
}
function previousWindow(from: string, to: string) {
  const days = daysInclusive(from, to);
  const end = new Date(`${from}T12:00:00`);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return { from: iso(start), to: iso(end) };
}
function aggregateByDay(rows: Daily[]) {
  const map = new Map<string, MetricPoint>();
  for (const row of rows) {
    const point = map.get(row.date) ?? {
      date: row.date,
      impressions: 0,
      reach: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      conversions: 0,
      revenue: 0,
      visits: 0,
    };
    for (const key of [
      'impressions',
      'reach',
      'clicks',
      'spend',
      'leads',
      'conversions',
      'revenue',
      'visits',
    ] as const)
      point[key] += Number(row[key] ?? 0);
    map.set(row.date, point);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export default function TrafficDashboardPage() {
  const canManage = useCan('manage-traffic');
  const today = iso(new Date());
  const initialFrom = new Date();
  initialFrom.setDate(initialFrom.getDate() - 29);
  const [accounts, setAccounts] = useState<AccountWithContact[]>([]);
  const [contactId, setContactId] = useState('');
  const [platform, setPlatform] = useState<Platform>('all');
  const [from, setFrom] = useState(iso(initialFrom));
  const [to, setTo] = useState(today);
  const [mode, setMode] = useState<Mode>('client');
  const [presentation, setPresentation] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [section, setSection] = useState<DashboardSection>('overview');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('spend');
  const [rows, setRows] = useState<Daily[]>([]);
  const [priorRows, setPriorRows] = useState<Daily[]>([]);
  const [recommendations, setRecommendations] = useState<
    TrafficRecommendation[]
  >([]);
  const [analysis, setAnalysis] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    createClient()
      .from('ad_accounts')
      .select('*, contact:contacts(id, name, phone)')
      .order('name')
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        const found = (data ?? []) as AccountWithContact[];
        setAccounts(found);
        if (found[0]?.contact_id)
          setContactId((old) => old || found[0].contact_id);
        if (!found.length) setLoading(false);
      });
  }, []);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    const supabase = createClient();
    const selected = accounts.filter(
      (a) =>
        a.contact_id === contactId &&
        (platform === 'all' || a.platform === platform)
    );
    const ids = selected.map((a) => a.id);
    const prior = previousWindow(from, to);
    if (!ids.length) {
      setRows([]);
      setPriorRows([]);
      setRecommendations([]);
      setLoading(false);
      return;
    }
    const fields =
      'entity_id,date,impressions,reach,clicks,spend,leads,conversions,revenue,visits';
    const [metrics, previous, recs, report] = await Promise.all([
      supabase
        .from('traffic_metrics_daily')
        .select(fields)
        .eq('entity_type', 'ad_account')
        .in('entity_id', ids)
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('traffic_metrics_daily')
        .select(fields)
        .eq('entity_type', 'ad_account')
        .in('entity_id', ids)
        .gte('date', prior.from)
        .lte('date', prior.to),
      supabase
        .from('traffic_recommendations')
        .select('*')
        .eq('contact_id', contactId)
        .not('status', 'in', '(done,dismissed)')
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('traffic_report_periods')
        .select('manager_analysis,next_steps')
        .eq('contact_id', contactId)
        .eq('period_start', from)
        .eq('period_end', to)
        .eq('platform', platform)
        .maybeSingle(),
    ]);
    const error = metrics.error ?? previous.error ?? recs.error ?? report.error;
    if (error) toast.error(error.message);
    setRows((metrics.data ?? []) as unknown as Daily[]);
    setPriorRows((previous.data ?? []) as unknown as Daily[]);
    setRecommendations((recs.data ?? []) as TrafficRecommendation[]);
    setAnalysis(report.data?.manager_analysis ?? '');
    setNextSteps(report.data?.next_steps ?? '');
    setLoading(false);
  }, [accounts, contactId, from, platform, to]);
  // The selected data slice is external Supabase state; refresh it whenever
  // its query inputs change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    document.documentElement.classList.toggle(
      'traffic-presentation',
      presentation
    );
    return () =>
      document.documentElement.classList.remove('traffic-presentation');
  }, [presentation]);

  const current = useMemo(() => aggregateMetrics(rows), [rows]);
  const previous = useMemo(() => aggregateMetrics(priorRows), [priorRows]);
  const daily = useMemo(() => aggregateByDay(rows), [rows]);
  const priorDaily = useMemo(() => aggregateByDay(priorRows), [priorRows]);
  const chartData = useMemo(
    () =>
      daily.map((point, index) => ({
        ...point,
        cpl: point.leads > 0 ? point.spend / point.leads : null,
        previous:
          chartMetric === 'cpl'
            ? priorDaily[index]?.leads > 0
              ? priorDaily[index].spend / priorDaily[index].leads
              : null
            : (priorDaily[index]?.[chartMetric] ?? null),
      })),
    [chartMetric, daily, priorDaily]
  );
  const client = accounts.find((a) => a.contact_id === contactId)?.contact;
  const latestSync = accounts
    .filter((a) => a.contact_id === contactId)
    .map((a) => a.updated_at)
    .sort()
    .at(-1);
  const activeRecs = recommendations.filter(
    (r) => !['done', 'dismissed'].includes(r.status)
  );
  const health = activeRecs.some((r) => r.priority === 'critical')
    ? 'critical'
    : activeRecs.some((r) => ['high', 'medium'].includes(r.priority))
      ? 'attention'
      : rows.length
        ? 'healthy'
        : 'unknown';
  const mainInsight =
    activeRecs[0]?.diagnosis ||
    (() => {
      const change = pctChange(previous.cpl, current.cpl);
      if (change != null && change < 0)
        return `O custo por lead caiu ${Math.abs(change).toFixed(1)}% em relação ao período anterior.`;
      if (change != null && change > 0)
        return `O custo por lead aumentou ${change.toFixed(1)}% e merece acompanhamento.`;
      return 'O período ainda não possui comparação suficiente para explicar a tendência.';
    })();

  async function saveReport() {
    const account = accounts.find((a) => a.contact_id === contactId);
    if (!account) return;
    setSaving(true);
    const { error } = await createClient()
      .from('traffic_report_periods')
      .upsert(
        {
          account_id: account.account_id,
          contact_id: contactId,
          period_start: from,
          period_end: to,
          platform,
          manager_analysis: analysis.trim(),
          next_steps: nextSteps.trim(),
        },
        { onConflict: 'account_id,contact_id,period_start,period_end,platform' }
      );
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success('Análise do período salva');
  }
  function setPreset(days: number) {
    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    setFrom(iso(start));
    setTo(today);
  }
  function setCalendarMonth(offset: number) {
    const base = new Date();
    const start = new Date(base.getFullYear(), base.getMonth() + offset, 1, 12);
    const end =
      offset === 0
        ? new Date()
        : new Date(base.getFullYear(), base.getMonth(), 0, 12);
    setFrom(iso(start));
    setTo(iso(end));
  }

  const cards = [
    {
      label: 'Investimento',
      short: 'Investimento',
      value: current.spend > 0 ? money.format(current.spend) : null,
      prior: previous.spend,
      now: current.spend,
      lowerBetter: false,
      icon: DollarSign,
      series: daily.map((point) => point.spend),
      help: 'Valor investido em anúncios no período.',
    },
    {
      label: 'Leads',
      short: 'Leads',
      value: current.leads > 0 ? number.format(current.leads) : null,
      prior: previous.leads,
      now: current.leads,
      lowerBetter: false,
      icon: Users2,
      series: daily.map((point) => point.leads),
      help: 'Oportunidades registradas pelas plataformas.',
    },
    {
      label: 'Custo por Lead (CPL)',
      short: 'CPL',
      value: current.cpl != null ? money.format(current.cpl) : null,
      prior: previous.cpl,
      now: current.cpl,
      lowerBetter: true,
      icon: Target,
      series: daily.map((point) =>
        point.leads > 0 ? point.spend / point.leads : 0
      ),
      help: 'Custo médio para gerar um lead.',
    },
    {
      label: 'Conversões',
      short: 'Conversões',
      value:
        current.conversions > 0 ? number.format(current.conversions) : null,
      prior: previous.conversions,
      now: current.conversions,
      lowerBetter: false,
      icon: Activity,
      series: daily.map((point) => point.conversions),
      help: 'Conversões atribuídas pela plataforma.',
    },
    {
      label: 'Custo por Conversão (CPA)',
      short: 'CPA',
      value: current.cpa != null ? money.format(current.cpa) : null,
      prior: previous.cpa,
      now: current.cpa,
      lowerBetter: true,
      icon: BarChart3,
      series: daily.map((point) =>
        point.conversions > 0 ? point.spend / point.conversions : 0
      ),
      help: 'Investimento médio por conversão atribuída.',
    },
    {
      label: 'Retorno sobre anúncios (ROAS)',
      short: 'ROAS',
      value:
        current.roas != null && current.revenue > 0
          ? `${current.roas.toFixed(2)}x`
          : null,
      prior: previous.roas,
      now: current.roas,
      lowerBetter: false,
      icon: Sparkles,
      series: daily.map((point) =>
        point.spend > 0 ? point.revenue / point.spend : 0
      ),
      help: 'Receita atribuída para cada R$ 1 investido. Não equivale ao ROI.',
    },
  ].filter((card) => card.value !== null);

  return (
    <div
      id="traffic-report"
      className={`space-y-6 ${presentation ? 'bg-background mx-auto max-w-[1440px] p-4 sm:p-8' : ''}`}
    >
      <style jsx global>{`
        .traffic-presentation aside,
        .traffic-presentation header {
          display: none !important;
        }
        .traffic-presentation main {
          padding: 0 !important;
          overflow: auto !important;
        }
        @media print {
          aside,
          header,
          .traffic-controls,
          .no-print {
            display: none !important;
          }
          main {
            padding: 0 !important;
            overflow: visible !important;
          }
          body {
            background: white !important;
          }
          #traffic-report {
            color: #111 !important;
            max-width: none !important;
            padding: 24px !important;
          }
        }
      `}</style>
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-primary mb-2 flex items-center gap-2 text-xs font-semibold tracking-[.18em] uppercase">
            <Activity className="size-4" /> Central de performance
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Performance de Tráfego
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {client?.name || 'Selecione um cliente'} ·{' '}
            {from.split('-').reverse().join('/')} —{' '}
            {to.split('-').reverse().join('/')}
          </p>
          {latestSync && (
            <p className="text-muted-foreground mt-1 text-xs">
              Dados atualizados em{' '}
              {new Date(latestSync).toLocaleString('pt-BR')}
            </p>
          )}
        </div>
        <div className="traffic-controls flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setMode(mode === 'client' ? 'manager' : 'client')}
          >
            <Eye /> Modo {mode === 'client' ? 'Cliente' : 'Gestor'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setPresentation(!presentation)}
          >
            {presentation ? <X /> : <Camera />}{' '}
            {presentation ? 'Sair' : 'Apresentação'}
          </Button>
          <Button onClick={() => window.print()}>
            <Camera /> Imprimir / PDF
          </Button>
        </div>
      </div>
      <Card className="traffic-controls border-primary/10 bg-background/90 sticky top-2 z-20 shadow-sm backdrop-blur-xl">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto] lg:items-end">
          <Filter label="Cliente">
            <Select
              value={contactId}
              onValueChange={(v) => setContactId(v ?? '')}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {[
                  ...new Map(
                    accounts.map((a) => [a.contact_id, a.contact])
                  ).entries(),
                ].map(([id, c]) => (
                  <SelectItem key={id} value={id}>
                    {c?.name || c?.phone || 'Sem nome'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Plataforma">
            <Select
              value={platform}
              onValueChange={(v) => setPlatform((v ?? 'all') as Platform)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="meta">Meta Ads</SelectItem>
                <SelectItem value="google">Google Ads</SelectItem>
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="De">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Filter>
          <Filter label="Até">
            <Input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </Filter>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPreset(1)}>
              Hoje
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(7)}>
              7d
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreset(14)}>
              14d
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(30)}>
              30d
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCalendarMonth(0)}
            >
              Mês
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCalendarMonth(-1)}
            >
              Anterior
            </Button>
          </div>
        </CardContent>
      </Card>
      {loading ? (
        <div className="space-y-5" aria-label="Carregando performance">
          <Skeleton className="h-56 w-full rounded-3xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="h-44 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      ) : !rows.length ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="text-muted-foreground mx-auto mb-4 size-10" />
            <h2 className="font-semibold">
              Sem dados confiáveis neste recorte
            </h2>
            <p className="text-muted-foreground mx-auto mt-2 max-w-lg text-sm">
              Conecte uma conta, sincronize a plataforma ou importe métricas. O
              painel não cria números fictícios.
            </p>
            <Link href="/traffic/metrics">
              <Button className="mt-5">Importar métricas</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="relative overflow-hidden rounded-3xl bg-[linear-gradient(135deg,hsl(var(--primary))_0%,#5b21b6_58%,#312e81_100%)] p-6 text-white shadow-[0_24px_70px_-35px_rgba(124,58,237,.75)] sm:p-9">
            <div className="absolute -top-20 -right-20 size-72 rounded-full bg-white/10 blur-3xl" />
            <div className="relative grid gap-8 lg:grid-cols-[1.25fr_.75fr] lg:items-center">
              <div>
                <p className="text-sm font-medium text-white/70">
                  Visão executiva · {daysInclusive(from, to)} dias
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">
                  {client?.name || 'Performance do cliente'}
                </h2>
                <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3">
                  <HeroValue
                    label="Investimento total"
                    value={money.format(current.spend)}
                  />
                  <HeroValue
                    label="Oportunidades"
                    value={number.format(current.leads)}
                  />
                  <HeroValue
                    label="Eficiência"
                    value={
                      current.cpl != null
                        ? money.format(current.cpl) + ' / lead'
                        : 'Sem base'
                    }
                  />
                </div>
                <div className="mt-7 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm backdrop-blur">
                  <span
                    className={`size-2.5 rounded-full ${health === 'healthy' ? 'bg-emerald-300' : health === 'attention' ? 'bg-amber-300' : 'bg-red-300'}`}
                  />
                  Performance{' '}
                  {health === 'healthy'
                    ? 'saudável'
                    : health === 'attention'
                      ? 'em atenção'
                      : 'crítica'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-md sm:p-6">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="size-4 text-violet-200" /> Principal
                  insight
                </div>
                <p className="text-lg leading-relaxed text-white/95">
                  {mainInsight}
                </p>
                <div className="mt-5 border-t border-white/15 pt-4">
                  <p className="text-xs font-semibold tracking-wider text-white/60 uppercase">
                    Minha recomendação
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-white/90">
                    {nextSteps ||
                      activeRecs[0]?.recommended_action ||
                      'Registre o próximo passo para transformar a leitura em ação.'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <nav
            className="no-print bg-muted/60 flex gap-1 overflow-x-auto rounded-xl p-1"
            aria-label="Seções do dashboard"
          >
            {(
              [
                ['overview', 'Visão geral'],
                ['performance', 'Performance'],
                ['diagnosis', 'Diagnóstico'],
                ['actions', 'Plano de ação'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSection(value)}
                className={`focus-visible:ring-ring min-h-10 flex-1 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:outline-none ${section === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                aria-current={section === value ? 'page' : undefined}
              >
                {label}
              </button>
            ))}
          </nav>

          {section === 'overview' && (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <MetricCard
                  key={card.short}
                  {...card}
                  clientMode={mode === 'client'}
                />
              ))}
            </section>
          )}
          {section === 'performance' && (
            <section>
              <Card>
                <CardContent className="pt-6">
                  <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <h2 className="font-semibold">Evolução do período</h2>
                    <p className="text-muted-foreground text-sm">
                      Investimento e leads por dia
                    </p>
                    <div className="no-print bg-muted flex rounded-lg p-1 sm:ml-auto">
                      {(
                        [
                          ['spend', 'Investimento'],
                          ['leads', 'Leads'],
                          ['cpl', 'CPL'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setChartMetric(value)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${chartMetric === value ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v) =>
                            v.slice(5).split('-').reverse().join('/')
                          }
                          fontSize={11}
                        />
                        <YAxis
                          fontSize={11}
                          tickFormatter={(value) =>
                            chartMetric === 'leads'
                              ? number.format(value)
                              : `R$${Number(value).toFixed(0)}`
                          }
                        />
                        <Tooltip
                          formatter={(value, name) => [
                            chartMetric === 'leads'
                              ? number.format(Number(value))
                              : money.format(Number(value)),
                            name,
                          ]}
                          labelFormatter={(v) =>
                            String(v).split('-').reverse().join('/')
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey={chartMetric}
                          name="Período atual"
                          stroke="hsl(var(--primary))"
                          strokeWidth={3}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="previous"
                          name="Período anterior"
                          stroke="hsl(var(--muted-foreground))"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
          {section === 'diagnosis' && (
            <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
              <Card className="bg-muted/45 border-0 shadow-none">
                <CardContent className="pt-6">
                  <h2 className="font-semibold">Saúde das campanhas</h2>
                  <div className="mt-5 flex items-center gap-4">
                    <span
                      className={`size-4 rounded-full ${health === 'healthy' ? 'bg-emerald-500' : health === 'attention' ? 'bg-amber-500' : health === 'critical' ? 'bg-red-500' : 'bg-muted'}`}
                    />
                    <div>
                      <p className="text-xl font-bold">
                        {health === 'healthy'
                          ? 'Saudável'
                          : health === 'attention'
                            ? 'Atenção'
                            : health === 'critical'
                              ? 'Crítico'
                              : 'Sem dados suficientes'}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Baseado em {activeRecs.length} recomendação(ões)
                        aberta(s), sem score arbitrário.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 space-y-3">
                    {activeRecs.slice(0, 3).map((rec) => (
                      <Link
                        key={rec.id}
                        href={`/traffic/recommendations?contact_id=${contactId}`}
                        className="hover:bg-muted/50 block rounded-lg border p-3"
                      >
                        <div className="mb-1 flex gap-2">
                          <Badge
                            variant={
                              rec.priority === 'critical'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {rec.priority}
                          </Badge>
                          <span className="text-sm font-semibold">
                            {rec.problem}
                          </span>
                        </div>
                        <p className="text-muted-foreground line-clamp-2 text-xs">
                          {rec.recommended_action}
                        </p>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card className="from-primary/10 border-0 bg-gradient-to-br to-transparent shadow-none">
                <CardContent className="pt-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Megaphone className="text-primary size-5" />
                    <h2 className="font-semibold">Minha recomendação</h2>
                  </div>
                  <p className="text-lg leading-relaxed font-semibold">
                    {nextSteps ||
                      activeRecs[0]?.recommended_action ||
                      'Defina o próximo passo estratégico deste período.'}
                  </p>
                  <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                    {activeRecs[0]?.expected_impact ||
                      'A recomendação orienta o gestor; nenhuma alteração de campanha é executada automaticamente.'}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6"
                    onClick={() => setSection('actions')}
                  >
                    Abrir plano de ação
                  </Button>
                </CardContent>
              </Card>
            </section>
          )}
          {section === 'performance' && mode === 'manager' && (
            <Card>
              <CardContent className="pt-6">
                <Button
                  variant="ghost"
                  className="mb-3 w-full justify-between"
                  onClick={() => setAdvanced(!advanced)}
                >
                  <span>Métricas avançadas</span>
                  <ChevronDown
                    className={`transition-transform ${advanced ? 'rotate-180' : ''}`}
                  />
                </Button>
                {advanced && (
                  <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                    <Technical
                      label="Impressões"
                      value={number.format(current.impressions)}
                    />
                    <Technical
                      label="Alcance"
                      value={number.format(current.reach)}
                    />
                    <Technical
                      label="Cliques"
                      value={number.format(current.clicks)}
                    />
                    <Technical
                      label="CTR"
                      value={
                        current.ctr == null
                          ? '—'
                          : `${(current.ctr * 100).toFixed(2)}%`
                      }
                    />
                    <Technical
                      label="CPC"
                      value={
                        current.cpc == null ? '—' : money.format(current.cpc)
                      }
                    />
                    <Technical
                      label="CPM"
                      value={
                        current.cpm == null ? '—' : money.format(current.cpm)
                      }
                    />
                    <Technical
                      label="Frequência"
                      value={
                        current.frequency == null
                          ? '—'
                          : `${current.frequency.toFixed(2)}x`
                      }
                    />
                    <Technical
                      label="Receita atribuída"
                      value={
                        current.revenue > 0
                          ? money.format(current.revenue)
                          : 'Sem dado confiável'
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {section === 'actions' && (
            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="pt-6">
                  <h2 className="font-semibold">Análise do gestor</h2>
                  <p className="text-muted-foreground mb-4 text-sm">
                    Interpretação salva especificamente para este cliente e
                    período.
                  </p>
                  {mode === 'manager' && !presentation ? (
                    <Textarea
                      className="min-h-40"
                      value={analysis}
                      onChange={(e) => setAnalysis(e.target.value)}
                      placeholder="Explique o resultado, o que melhorou e o que merece atenção..."
                    />
                  ) : (
                    <p className="min-h-24 text-sm leading-relaxed whitespace-pre-wrap">
                      {analysis ||
                        'Nenhuma análise registrada para este período.'}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card className="border-primary/30 bg-primary/[.03]">
                <CardContent className="pt-6">
                  <h2 className="font-semibold">Próximos passos</h2>
                  <p className="text-muted-foreground mb-4 text-sm">
                    O que vamos fazer agora, sem executar mudanças
                    automaticamente.
                  </p>
                  {mode === 'manager' && !presentation ? (
                    <Textarea
                      className="min-h-40"
                      value={nextSteps}
                      onChange={(e) => setNextSteps(e.target.value)}
                      placeholder="Liste recomendações, responsáveis ou próximos testes..."
                    />
                  ) : (
                    <p className="min-h-24 text-sm leading-relaxed whitespace-pre-wrap">
                      {nextSteps ||
                        activeRecs[0]?.recommended_action ||
                        'Nenhum próximo passo registrado.'}
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
          )}
          {section === 'actions' && mode === 'manager' && !presentation && (
            <div className="no-print flex justify-end">
              <Button onClick={saveReport} disabled={!canManage || saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}{' '}
                Salvar análise do período
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Filter({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Technical({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
function HeroValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wider text-white/60 uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
function MetricCard({
  label,
  short,
  value,
  prior,
  now,
  lowerBetter,
  icon: Icon,
  help,
  clientMode,
  series,
}: {
  label: string;
  short: string;
  value: string | null;
  prior: number | null;
  now: number | null;
  lowerBetter: boolean;
  icon: typeof DollarSign;
  help: string;
  clientMode: boolean;
  series: number[];
}) {
  const change = pctChange(prior, now);
  const improved = change != null && (lowerBetter ? change < 0 : change > 0);
  return (
    <Card
      title={help}
      className="group bg-card/80 border-0 shadow-[0_12px_36px_-28px_rgba(15,23,42,.55)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_45px_-28px_rgba(124,58,237,.45)]"
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-muted-foreground text-sm">
              {clientMode ? label : short}
            </p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
          </div>
          <div className="bg-primary/10 text-primary rounded-xl p-2.5">
            <Icon className="size-5" />
          </div>
        </div>
        <Sparkline values={series} positive={improved} />
        {change != null && (
          <div
            className={`mt-4 flex items-center gap-1 text-xs font-medium ${improved ? 'text-emerald-600' : 'text-amber-600'}`}
          >
            {change < 0 ? (
              <ArrowDownRight className="size-4" />
            ) : (
              <ArrowUpRight className="size-4" />
            )}
            {Math.abs(change).toFixed(1)}% vs. período anterior ·{' '}
            {improved ? 'melhor' : 'atenção'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({
  values,
  positive,
}: {
  values: number[];
  positive: boolean;
}) {
  const usable = values.length > 1 ? values : [0, 0];
  const max = Math.max(...usable, 1);
  const min = Math.min(...usable);
  const range = Math.max(max - min, 1);
  const points = usable
    .map(
      (value, index) =>
        `${(index / (usable.length - 1)) * 100},${30 - ((value - min) / range) * 24}`
    )
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 34"
      className="mt-5 h-9 w-full overflow-visible"
      role="img"
      aria-label="Tendência diária da métrica"
    >
      <polyline
        points={points}
        fill="none"
        stroke={positive ? '#10b981' : 'hsl(var(--primary))'}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
