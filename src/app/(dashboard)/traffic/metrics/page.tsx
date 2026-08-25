"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Upload } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { TrafficEntityType } from "@/types"
import { GatedButton } from "@/components/ui/gated-button"
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

const ENTITY_TYPES: TrafficEntityType[] = ["ad_account", "campaign", "ad_set", "ad", "landing_page"]
const ENTITY_TABLE: Record<TrafficEntityType, string> = {
  ad_account: "ad_accounts",
  campaign: "ad_campaigns",
  ad_set: "ad_sets",
  ad: "ads",
  landing_page: "landing_pages",
}

const NUMERIC_FIELDS = ["impressions", "reach", "clicks", "spend", "leads", "conversions", "revenue", "visits"] as const

export default function TrafficMetricsPage() {
  const canManage = useCan("manage-traffic")
  const t = useTranslations("Traffic.metrics")

  const [entityType, setEntityType] = useState<TrafficEntityType>("campaign")
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([])
  const [entityId, setEntityId] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [csvText, setCsvText] = useState<string | null>(null)
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; errors: { line: number; message: string }[] } | null>(null)

  useEffect(() => {
    setEntityId("")
    createClient()
      .from(ENTITY_TABLE[entityType])
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data }) => setEntities((data ?? []) as { id: string; name: string }[]))
  }, [entityType])

  async function submitManualEntry() {
    if (!entityId || !date) {
      toast.error(t("toasts.missingFields"))
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { entity_type: entityType, entity_id: entityId, date }
      for (const field of NUMERIC_FIELDS) {
        if (values[field]) payload[field] = Number(values[field])
      }
      const res = await fetch("/api/traffic/metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("toasts.saveError"))
        return
      }
      toast.success(t("toasts.saved"))
      setValues({})
    } finally {
      setSaving(false)
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) return
    setCsvFileName(file.name)
    setImportResult(null)
    const reader = new FileReader()
    reader.onload = () => setCsvText(String(reader.result ?? ""))
    reader.readAsText(file)
  }

  async function submitImport() {
    if (!csvText) return
    setImporting(true)
    try {
      const res = await fetch("/api/traffic/metrics/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("toasts.importError"))
        return
      }
      setImportResult(body)
      toast.success(t("toasts.imported", { count: body.imported }))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">{t("manualEntry")}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("fields.entityType")}</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as TrafficEntityType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((e) => <SelectItem key={e} value={e}>{t(`entityTypes.${e}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("fields.entity")}</Label>
              <Select value={entityId} onValueChange={(v) => setEntityId(v ?? "")}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("fields.entityPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("fields.date")}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NUMERIC_FIELDS.map((field) => (
              <div key={field} className="space-y-1.5">
                <Label>{t(`fields.${field}`)}</Label>
                <Input
                  type="number"
                  min={0}
                  value={values[field] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <GatedButton canAct={canManage} gateReason={t("gateReason")} onClick={submitManualEntry} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
          </GatedButton>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t("csvImport")}</h2>
          <p className="text-xs text-muted-foreground">{t("csvHint")}</p>
          <Input type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files?.[0])} />
          {csvFileName && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{csvFileName}</span>
              <GatedButton canAct={canManage} gateReason={t("gateReason")} size="sm" onClick={submitImport} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4" /> {t("import")}</>}
              </GatedButton>
            </div>
          )}
          {importResult && (
            <div className="space-y-1 rounded-lg border border-border bg-muted/50 p-3 text-sm">
              <p>{t("importSummary", { imported: importResult.imported, errors: importResult.errors.length })}</p>
              {importResult.errors.length > 0 && (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-destructive">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>{t("lineError", { line: e.line })}: {e.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
