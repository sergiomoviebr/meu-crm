"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Plus, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import { computeCreativeFatigueScore, computeTrend, type FatigueScore, type MetricPoint } from "@/lib/traffic/signals"
import type { Ad, AdCampaign, AdSet } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const FATIGUE_EMOJI: Record<FatigueScore["level"], string> = { healthy: "🟢", monitor: "🟡", test: "🟠", replace: "🔴" }

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const canManage = useCan("manage-traffic")
  const t = useTranslations("Traffic.campaigns.detail")

  const [campaign, setCampaign] = useState<AdCampaign | null | undefined>(undefined)
  const [adSets, setAdSets] = useState<AdSet[]>([])
  const [ads, setAds] = useState<Ad[]>([])
  const [metricsByAd, setMetricsByAd] = useState<Map<string, MetricPoint[]>>(new Map())

  const [createSetOpen, setCreateSetOpen] = useState(false)
  const [createAdOpen, setCreateAdOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [setName, setSetName] = useState("")
  const [adName, setAdName] = useState("")
  const [adHeadline, setAdHeadline] = useState("")
  const [adLaunchedAt, setAdLaunchedAt] = useState("")

  async function load() {
    const supabase = createClient()
    const campaignRes = await supabase.from("ad_campaigns").select("*").eq("id", params.id).maybeSingle()
    setCampaign((campaignRes.data as AdCampaign) ?? null)
    if (!campaignRes.data) return

    const adSetsRes = await supabase.from("ad_sets").select("*").eq("campaign_id", params.id).order("created_at", { ascending: false })
    const sets = (adSetsRes.data ?? []) as AdSet[]
    setAdSets(sets)

    if (sets.length === 0) {
      setAds([])
      return
    }
    const adsRes = await supabase.from("ads").select("*").in("ad_set_id", sets.map((s) => s.id)).order("created_at", { ascending: false })
    const adRows = (adsRes.data ?? []) as Ad[]
    setAds(adRows)

    if (adRows.length > 0) {
      const since = new Date()
      since.setDate(since.getDate() - 30)
      const metricsRes = await supabase
        .from("traffic_metrics_daily")
        .select("entity_id, date, impressions, reach, clicks, spend, leads, conversions, revenue, visits")
        .eq("entity_type", "ad")
        .in("entity_id", adRows.map((a) => a.id))
        .gte("date", since.toISOString().slice(0, 10))
      const map = new Map<string, MetricPoint[]>()
      for (const row of metricsRes.data ?? []) {
        const list = map.get(row.entity_id) ?? []
        list.push(row as MetricPoint)
        map.set(row.entity_id, list)
      }
      setMetricsByAd(map)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  const fatigueByAd = useMemo(() => {
    const now = new Date()
    const currentStart = new Date(now)
    currentStart.setDate(currentStart.getDate() - 7)
    const priorStart = new Date(now)
    priorStart.setDate(priorStart.getDate() - 14)
    const currentStartStr = currentStart.toISOString().slice(0, 10)
    const priorStartStr = priorStart.toISOString().slice(0, 10)

    const map = new Map<string, FatigueScore>()
    for (const ad of ads) {
      const rows = metricsByAd.get(ad.id) ?? []
      const current = rows.filter((r) => r.date >= currentStartStr)
      const prior = rows.filter((r) => r.date >= priorStartStr && r.date < currentStartStr)
      const trend = computeTrend(current, prior)
      map.set(ad.id, computeCreativeFatigueScore({ launchedAt: ad.launched_at ?? null }, trend, now))
    }
    return map
  }, [ads, metricsByAd])

  async function createAdSet() {
    if (!setName.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/traffic/ad-sets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: params.id, name: setName.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.createError"))
        return
      }
      toast.success(t("toasts.setCreated"))
      setCreateSetOpen(false)
      setSetName("")
      load()
    } finally {
      setSaving(false)
    }
  }

  async function createAd() {
    if (!createAdOpen || !adName.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/traffic/ads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ad_set_id: createAdOpen,
          name: adName.trim(),
          headline: adHeadline || undefined,
          launched_at: adLaunchedAt || undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.createError"))
        return
      }
      toast.success(t("toasts.adCreated"))
      setCreateAdOpen(null)
      setAdName("")
      setAdHeadline("")
      setAdLaunchedAt("")
      load()
    } finally {
      setSaving(false)
    }
  }

  if (campaign === undefined) {
    return <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }
  if (campaign === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t("notFound")}</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{campaign.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{campaign.objective ?? "—"} · <Badge variant="outline">{campaign.status}</Badge></p>
        </div>
        <GatedButton canAct={canManage} gateReason={t("gateReason")} onClick={() => setCreateSetOpen(true)}>
          <Plus className="h-4 w-4" /> {t("newAdSet")}
        </GatedButton>
      </div>

      {adSets.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("emptySets")}</p>
      ) : (
        adSets.map((adSet) => {
          const setAds = ads.filter((a) => a.ad_set_id === adSet.id)
          return (
            <div key={adSet.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{adSet.name}</h2>
                <GatedButton canAct={canManage} gateReason={t("gateReason")} size="sm" variant="outline" onClick={() => setCreateAdOpen(adSet.id)}>
                  <Plus className="h-3.5 w-3.5" /> {t("newAd")}
                </GatedButton>
              </div>
              {setAds.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("emptyAds")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.name")}</TableHead>
                      <TableHead>{t("columns.status")}</TableHead>
                      <TableHead>{t("columns.fatigue")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {setAds.map((ad) => {
                      const fatigue = fatigueByAd.get(ad.id)
                      return (
                        <TableRow key={ad.id}>
                          <TableCell>{ad.name}</TableCell>
                          <TableCell><Badge variant="outline">{ad.status}</Badge></TableCell>
                          <TableCell>
                            {fatigue ? (
                              <span title={fatigue.reasons.join("; ")}>
                                {FATIGUE_EMOJI[fatigue.level]} {t(`fatigueLevel.${fatigue.level}`)}
                              </span>
                            ) : "—"}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )
        })
      )}

      <Dialog open={createSetOpen} onOpenChange={setCreateSetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("setDialog.title")}</DialogTitle>
            <DialogDescription>{t("setDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("setDialog.name")}</Label>
            <Input value={setName} onChange={(e) => setSetName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSetOpen(false)}>{t("cancel")}</Button>
            <Button onClick={createAdSet} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createAdOpen} onOpenChange={(open) => !open && setCreateAdOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adDialog.title")}</DialogTitle>
            <DialogDescription>{t("adDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("adDialog.name")}</Label>
              <Input value={adName} onChange={(e) => setAdName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("adDialog.headline")}</Label>
              <Input value={adHeadline} onChange={(e) => setAdHeadline(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("adDialog.launchedAt")}</Label>
              <Input type="date" value={adLaunchedAt} onChange={(e) => setAdLaunchedAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAdOpen(null)}>{t("cancel")}</Button>
            <Button onClick={createAd} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
