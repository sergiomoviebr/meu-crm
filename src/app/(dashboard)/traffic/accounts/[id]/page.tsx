"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Plus, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { AdAccount, AdCampaign, Contact } from "@/types"
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

type AdAccountWithContact = AdAccount & { contact: Pick<Contact, "id" | "name"> | null }

export default function AdAccountDetailPage() {
  const params = useParams<{ id: string }>()
  const canManage = useCan("manage-traffic")
  const t = useTranslations("Traffic.accounts.detail")

  const [account, setAccount] = useState<AdAccountWithContact | null | undefined>(undefined)
  const [campaigns, setCampaigns] = useState<AdCampaign[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [objective, setObjective] = useState("")
  const [budget, setBudget] = useState("")

  async function load() {
    const supabase = createClient()
    const [accountRes, campaignsRes] = await Promise.all([
      supabase.from("ad_accounts").select("*, contact:contacts(id, name)").eq("id", params.id).maybeSingle(),
      supabase.from("ad_campaigns").select("*").eq("ad_account_id", params.id).order("created_at", { ascending: false }),
    ])
    setAccount((accountRes.data as AdAccountWithContact) ?? null)
    setCampaigns((campaignsRes.data ?? []) as AdCampaign[])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  async function createCampaign() {
    if (!name.trim()) {
      toast.error(t("toasts.missingFields"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/traffic/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ad_account_id: params.id,
          name: name.trim(),
          objective: objective || undefined,
          budget: budget ? Number(budget) : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("toasts.createError"))
        return
      }
      toast.success(t("toasts.created"))
      setCreateOpen(false)
      setName("")
      setObjective("")
      setBudget("")
      load()
    } finally {
      setSaving(false)
    }
  }

  if (account === undefined) {
    return <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }
  if (account === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t("notFound")}</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{account.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{account.contact?.name} — {account.platform}</p>
        </div>
        <GatedButton canAct={canManage} gateReason={t("gateReason")} onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> {t("newCampaign")}
        </GatedButton>
      </div>

      {campaigns === null ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : campaigns.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.objective")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.budget")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/traffic/campaigns/${c.id}`} className="hover:underline">{c.name}</Link>
                </TableCell>
                <TableCell>{c.objective ?? "—"}</TableCell>
                <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                <TableCell>{c.budget != null ? `R$ ${c.budget.toLocaleString("pt-BR")}` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("dialog.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.objective")}</Label>
              <Input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder={t("dialog.objectivePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.budget")}</Label>
              <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("dialog.cancel")}</Button>
            <Button onClick={createCampaign} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("dialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
