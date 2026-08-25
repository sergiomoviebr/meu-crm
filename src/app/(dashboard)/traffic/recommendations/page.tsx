"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Sparkles, ClipboardPlus } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { Contact, RecommendationPriority, RecommendationStatus, TrafficRecommendation } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type RecWithContact = TrafficRecommendation & { contact: Pick<Contact, "id" | "name" | "phone"> | null }

const PRIORITY_META: Record<RecommendationPriority, { emoji: string; variant: "destructive" | "default" | "secondary" | "outline" }> = {
  critical: { emoji: "🔴", variant: "destructive" },
  high: { emoji: "🟠", variant: "default" },
  medium: { emoji: "🟡", variant: "secondary" },
  low: { emoji: "🟢", variant: "outline" },
}

const STATUS_ACTIONS: Record<string, { next: string; label: string }> = {
  new: { next: "review", label: "review" },
  in_review: { next: "approve", label: "approve" },
  approved: { next: "start", label: "start" },
  in_progress: { next: "complete", label: "complete" },
}

export default function TrafficRecommendationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canManage = useCan("manage-traffic")
  const canApprove = useCan("approve-optimization")
  const t = useTranslations("Traffic.recommendations")

  const statusFilter = searchParams.get("status")
  const priorityFilter = searchParams.get("priority")?.split(",").filter(Boolean) ?? []
  const isAlertsView = priorityFilter.length > 0 && statusFilter === "new"

  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([])
  const [recommendations, setRecommendations] = useState<RecWithContact[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    let query = supabase
      .from("traffic_recommendations")
      .select("*, contact:contacts(id, name, phone)")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
    if (statusFilter) query = query.eq("status", statusFilter)
    if (priorityFilter.length > 0) query = query.in("priority", priorityFilter)

    const { data, error } = await query
    if (error) {
      toast.error(error.message)
      return
    }
    setRecommendations((data ?? []) as RecWithContact[])
  }

  useEffect(() => {
    createClient()
      .from("contacts")
      .select("id, name, phone")
      .order("name", { ascending: true })
      .then(({ data }) => setContacts((data ?? []) as Pick<Contact, "id" | "name" | "phone">[]))
  }, [])

  useEffect(() => {
    setRecommendations(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, priorityFilter.join(",")])

  async function runAction(rec: RecWithContact, action: string) {
    setBusyId(rec.id)
    try {
      const res = await fetch(`/api/traffic/recommendations/${rec.id}/${action}`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.actionFailed"))
        return
      }
      toast.success(t("toasts.updated"))
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function addToPlan(rec: RecWithContact) {
    setBusyId(rec.id)
    try {
      const res = await fetch("/api/traffic/optimization-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contact_id: rec.contact_id,
          recommendation_id: rec.id,
          title: rec.recommended_action,
          priority: rec.priority,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.actionFailed"))
        return
      }
      toast.success(t("toasts.addedToPlan"))
    } finally {
      setBusyId(null)
    }
  }

  function updateFilter(key: "status" | "priority" | "contact_id", value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`/traffic/recommendations?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAlertsView ? t("alertsTitle") : t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{isAlertsView ? t("alertsSubtitle") : t("subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={searchParams.get("contact_id") ?? "all"} onValueChange={(v) => updateFilter("contact_id", v === "all" ? null : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder={t("filters.client")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allClients")}</SelectItem>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name || c.phone}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter ?? "all"} onValueChange={(v) => updateFilter("status", v === "all" ? null : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder={t("filters.status")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
            {(["new", "in_review", "approved", "in_progress", "done", "dismissed"] as RecommendationStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {recommendations === null ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : recommendations.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {recommendations
            .filter((r) => {
              const contactId = searchParams.get("contact_id")
              return !contactId || contactId === "all" || r.contact_id === contactId
            })
            .map((rec) => {
              const meta = PRIORITY_META[rec.priority]
              const nextAction = STATUS_ACTIONS[rec.status]
              return (
                <Card key={rec.id}>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={meta.variant}>{meta.emoji} {t(`priority.${rec.priority}`)}</Badge>
                        <Badge variant="outline">{t(`category.${rec.category}`)}</Badge>
                        <Badge variant="outline">{t(`status.${rec.status}`)}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{rec.contact?.name ?? "—"}</span>
                    </div>
                    <p className="text-sm font-semibold text-foreground">{rec.problem}</p>
                    <p className="text-sm text-muted-foreground">{rec.diagnosis}</p>
                    <p className="text-sm text-foreground"><strong>{t("recommendedAction")}:</strong> {rec.recommended_action}</p>
                    {rec.expected_impact && (
                      <p className="text-sm text-muted-foreground"><strong>{t("expectedImpact")}:</strong> {rec.expected_impact}</p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2">
                      {nextAction && (
                        <GatedButton
                          canAct={nextAction.next === "approve" ? canApprove : canManage}
                          gateReason={t("gateReason")}
                          size="sm"
                          variant="outline"
                          disabled={busyId === rec.id}
                          onClick={() => runAction(rec, nextAction.next)}
                        >
                          {busyId === rec.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t(`actions.${nextAction.label}`)}
                        </GatedButton>
                      )}
                      {rec.status !== "done" && rec.status !== "dismissed" && (
                        <GatedButton
                          canAct={canManage}
                          gateReason={t("gateReason")}
                          size="sm"
                          variant="ghost"
                          disabled={busyId === rec.id}
                          onClick={() => runAction(rec, "dismiss")}
                        >
                          {t("actions.dismiss")}
                        </GatedButton>
                      )}
                      {rec.category === "creative_fatigue" && (
                        <Link href={`/content/new?contact_id=${rec.contact_id}`}>
                          <Button size="sm" variant="outline">
                            <Sparkles className="h-3.5 w-3.5" /> {t("actions.createCreative")}
                          </Button>
                        </Link>
                      )}
                      <GatedButton
                        canAct={canManage}
                        gateReason={t("gateReason")}
                        size="sm"
                        variant="outline"
                        disabled={busyId === rec.id}
                        onClick={() => addToPlan(rec)}
                      >
                        <ClipboardPlus className="h-3.5 w-3.5" /> {t("actions.addToPlan")}
                      </GatedButton>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
        </div>
      )}
    </div>
  )
}
