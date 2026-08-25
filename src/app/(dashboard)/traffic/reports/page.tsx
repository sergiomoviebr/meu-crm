"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { aggregateMetrics, computeFunnelConversionRates, type MetricPoint } from "@/lib/traffic/signals"
import type { Contact, Deal, PipelineStage } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function TrafficReportsPage() {
  const t = useTranslations("Traffic.reports")

  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([])
  const [contactId, setContactId] = useState("")
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<ReturnType<typeof aggregateMetrics> | null>(null)
  const [funnel, setFunnel] = useState<ReturnType<typeof computeFunnelConversionRates>>([])

  useEffect(() => {
    createClient()
      .from("contacts")
      .select("id, name, phone")
      .order("name", { ascending: true })
      .then(({ data }) => setContacts((data ?? []) as Pick<Contact, "id" | "name" | "phone">[]))
  }, [])

  async function generate() {
    if (!contactId) {
      toast.error(t("selectClient"))
      return
    }
    setLoading(true)
    try {
      const supabase = createClient()

      const [adAccountsRes, landingPagesRes] = await Promise.all([
        supabase.from("ad_accounts").select("id").eq("contact_id", contactId),
        supabase.from("landing_pages").select("id").eq("contact_id", contactId),
      ])
      const adAccountIds = (adAccountsRes.data ?? []).map((a) => a.id)

      let campaignIds: string[] = []
      if (adAccountIds.length > 0) {
        const { data } = await supabase.from("ad_campaigns").select("id").in("ad_account_id", adAccountIds)
        campaignIds = (data ?? []).map((c) => c.id)
      }

      const entityIds = [...adAccountIds, ...campaignIds, ...(landingPagesRes.data ?? []).map((l) => l.id)]
      let points: MetricPoint[] = []
      if (entityIds.length > 0) {
        const { data } = await supabase
          .from("traffic_metrics_daily")
          .select("date, impressions, reach, clicks, spend, leads, conversions, revenue, visits")
          .in("entity_id", entityIds)
          .gte("date", from)
          .lte("date", to)
        points = (data ?? []) as MetricPoint[]
      }
      setSummary(aggregateMetrics(points))

      const { data: deals } = await supabase.from("deals").select("*").eq("contact_id", contactId)
      const dealRows = (deals ?? []) as Deal[]
      if (dealRows.length > 0) {
        const pipelineIds = [...new Set(dealRows.map((d) => d.pipeline_id))]
        const { data: stages } = await supabase.from("pipeline_stages").select("*").in("pipeline_id", pipelineIds)
        setFunnel(computeFunnelConversionRates((stages ?? []) as PipelineStage[], dealRows))
      } else {
        setFunnel([])
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>{t("filters.client")}</Label>
            <Select value={contactId} onValueChange={(v) => setContactId(v ?? "")}>
              <SelectTrigger className="w-56"><SelectValue placeholder={t("filters.clientPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.phone}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("filters.from")}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("filters.to")}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("generate")}
          </Button>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardContent>
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t("summary")}</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label={t("stats.spend")} value={`R$ ${summary.spend.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
              <Stat label={t("stats.leads")} value={summary.leads.toLocaleString("pt-BR")} />
              <Stat label={t("stats.ctr")} value={summary.ctr != null ? `${(summary.ctr * 100).toFixed(2)}%` : "—"} />
              <Stat label={t("stats.cpl")} value={summary.cpl != null ? `R$ ${summary.cpl.toFixed(2)}` : "—"} />
              <Stat label={t("stats.cpa")} value={summary.cpa != null ? `R$ ${summary.cpa.toFixed(2)}` : "—"} />
              <Stat label={t("stats.roas")} value={summary.roas != null ? `${summary.roas.toFixed(2)}x` : "—"} />
              <Stat label={t("stats.revenue")} value={`R$ ${summary.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
              <Stat label={t("stats.conversions")} value={summary.conversions.toLocaleString("pt-BR")} />
            </div>
          </CardContent>
        </Card>
      )}

      {funnel.length > 0 && (
        <Card>
          <CardContent>
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t("funnel")}</h2>
            <div className="space-y-1">
              {funnel.map((stage) => (
                <div key={stage.stageId} className="flex items-center justify-between text-sm">
                  <span>{stage.stageName}</span>
                  <span className="text-muted-foreground">
                    {stage.dealsAtOrPastStage} {stage.conversionFromPreviousPct != null ? `(${stage.conversionFromPreviousPct.toFixed(0)}%)` : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}
