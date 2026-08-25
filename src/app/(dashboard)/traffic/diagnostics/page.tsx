"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
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
import type { Contact, RecommendationPriority, TrafficRecommendation } from "@/types"

type RecWithContact = TrafficRecommendation & { contact: Pick<Contact, "id" | "name"> | null }

const PRIORITY_EMOJI: Record<RecommendationPriority, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
}

export default function TrafficDiagnosticsPage() {
  const t = useTranslations("Traffic.diagnostics")
  const router = useRouter()
  const searchParams = useSearchParams()
  const canManage = useCan("manage-traffic")
  const contactId = searchParams.get("contact_id")

  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([])
  const [recommendations, setRecommendations] = useState<RecWithContact[] | null>(null)
  const [running, setRunning] = useState(false)

  async function load() {
    const supabase = createClient()
    let query = supabase
      .from("traffic_recommendations")
      .select("*, contact:contacts(id, name)")
      .eq("status", "new")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
    if (contactId) query = query.eq("contact_id", contactId)
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
  }, [contactId])

  async function runDiagnostics() {
    setRunning(true)
    try {
      const res = await fetch("/api/traffic/diagnostics/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contactId ? { contact_id: contactId } : {}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("toasts.runFailed"))
        return
      }
      toast.success(t("toasts.runComplete", { count: body.recommendationsCreated ?? 0 }))
      load()
    } finally {
      setRunning(false)
    }
  }

  const critical = (recommendations ?? []).filter((r) => r.priority === "critical").length
  const high = (recommendations ?? []).filter((r) => r.priority === "high").length
  const opportunities = (recommendations ?? []).filter((r) => r.priority === "low" || r.priority === "medium").length
  const top = recommendations?.[0]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <GatedButton canAct={canManage} gateReason={t("gateReason")} onClick={runDiagnostics} disabled={running}>
          <Sparkles className="h-4 w-4" /> {running ? t("running") : t("runDiagnostics")}
        </GatedButton>
      </div>

      <Select value={contactId ?? "all"} onValueChange={(v) => router.push(v === "all" ? "/traffic/diagnostics" : `/traffic/diagnostics?contact_id=${v}`)}>
        <SelectTrigger className="w-56"><SelectValue placeholder={t("filters.client")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allClients")}</SelectItem>
          {contacts.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name || c.phone}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {recommendations === null ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm text-foreground">
              {t("briefing", { count: recommendations.length })}
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <span>🔴 {t("critical", { count: critical })}</span>
              <span>🟠 {t("highPriority", { count: high })}</span>
              <span>🟢 {t("opportunities", { count: opportunities })}</span>
            </div>
            {top && (
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{t("mainRecommendation")}</p>
                <p className="mt-1 text-sm text-foreground">
                  {PRIORITY_EMOJI[top.priority]} <strong>{top.contact?.name}</strong>: {top.diagnosis}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {top.category === "creative_fatigue" && (
                    <Link href={`/content/new?contact_id=${top.contact_id}`}>
                      <Badge variant="outline" className="cursor-pointer">{t("actions.createCreative")}</Badge>
                    </Link>
                  )}
                  <Link href={`/traffic/recommendations?contact_id=${top.contact_id}`}>
                    <Badge variant="outline" className="cursor-pointer">{t("actions.viewFull")}</Badge>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {recommendations && recommendations.length > 0 && (
        <div className="space-y-2">
          {recommendations.map((rec) => (
            <Link
              key={rec.id}
              href={`/traffic/recommendations?contact_id=${rec.contact_id}`}
              className="flex items-start justify-between gap-2 rounded-lg border border-border p-3 text-sm hover:bg-muted/50"
            >
              <span>
                {PRIORITY_EMOJI[rec.priority]} <strong>{rec.contact?.name}</strong> — {rec.problem}
              </span>
              <Badge variant="outline">{t(`category.${rec.category}`)}</Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
