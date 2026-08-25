"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Plus, Loader2, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { AdAccount, AdPlatform, Contact } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { MetaOAuthPicker } from "@/components/settings/meta-oauth-picker"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PLATFORM_LABEL: Record<AdPlatform, string> = { meta: "Meta Ads", google: "Google Ads", other: "Outra" }

type AdAccountWithContact = AdAccount & { contact: Pick<Contact, "id" | "name" | "phone"> | null }

export default function TrafficAdAccountsPage() {
  const canManage = useCan("manage-traffic")
  const t = useTranslations("Traffic.accounts")
  const router = useRouter()
  const searchParams = useSearchParams()

  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([])
  const [accounts, setAccounts] = useState<AdAccountWithContact[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AdAccountWithContact | null>(null)

  const [contactId, setContactId] = useState("")
  const [platform, setPlatform] = useState<AdPlatform>("meta")
  const [name, setName] = useState("")

  async function load() {
    const supabase = createClient()
    const [{ data: contactRows }, { data: accountRows, error }] = await Promise.all([
      supabase.from("contacts").select("id, name, phone").order("name", { ascending: true }),
      supabase.from("ad_accounts").select("*, contact:contacts(id, name, phone)").order("created_at", { ascending: false }),
    ])
    setContacts((contactRows ?? []) as Pick<Contact, "id" | "name" | "phone">[])
    if (error) {
      toast.error(error.message)
      return
    }
    setAccounts((accountRows ?? []) as AdAccountWithContact[])
  }

  useEffect(() => {
    load()
  }, [])

  const oauthResult = searchParams.get("meta_oauth")
  const pickerToken = searchParams.get("meta_oauth_picker")
  useEffect(() => {
    if (!oauthResult) return
    if (oauthResult === "connected") toast.success(t("toasts.oauthConnected"))
    else if (oauthResult === "no_ad_accounts") toast.error(t("toasts.oauthNoAdAccounts"))
    else if (oauthResult === "denied") toast.error(t("toasts.oauthDenied"))
    else toast.error(t("toasts.oauthError"))
    load()
    router.replace("/traffic/accounts", { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthResult])

  async function createAccount() {
    if (!contactId || !name.trim()) {
      toast.error(t("toasts.missingFields"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/traffic/ad-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, platform, name: name.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("toasts.createError"))
        return
      }
      toast.success(t("toasts.created"))
      setCreateOpen(false)
      setContactId("")
      setName("")
      load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteAccount() {
    if (!pendingDelete) return
    const res = await fetch(`/api/traffic/ad-accounts/${pendingDelete.id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.deleteError"))
      return
    }
    toast.success(t("toasts.deleted"))
    setPendingDelete(null)
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <GatedButton canAct={canManage} gateReason={t("gateReason")} onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> {t("new")}
        </GatedButton>
      </div>

      {accounts === null ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : accounts.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.client")}</TableHead>
              <TableHead>{t("columns.platform")}</TableHead>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell>{account.contact?.name ?? "—"}</TableCell>
                <TableCell>{PLATFORM_LABEL[account.platform]}</TableCell>
                <TableCell>
                  <Link href={`/traffic/accounts/${account.id}`} className="hover:underline">
                    {account.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={account.connection_status === "connected" ? "default" : "outline"}>
                    {t(`connectionStatus.${account.connection_status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <GatedButton canAct={canManage} gateReason={t("gateReason")} variant="ghost" size="icon-sm" onClick={() => setPendingDelete(account)}>
                    <Trash2 className="h-4 w-4" />
                  </GatedButton>
                </TableCell>
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
              <Label>{t("dialog.client")}</Label>
              <Select value={contactId} onValueChange={(v) => setContactId(v ?? "")}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("dialog.clientPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name || c.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.platform")}</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as AdPlatform)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PLATFORM_LABEL) as AdPlatform[]).map((p) => (
                    <SelectItem key={p} value={p}>{PLATFORM_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {platform === "meta" && (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <GatedButton
                  canAct={canManage && !!contactId}
                  gateReason={t("gateReason")}
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    window.location.href = `/api/meta-oauth/start?product=ads&contact_id=${contactId}`
                  }}
                >
                  {t("dialog.connectWithMeta")}
                </GatedButton>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {contactId ? t("dialog.connectWithMetaHint") : t("dialog.connectWithMetaNeedsClient")}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("dialog.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("dialog.namePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("dialog.cancel")}</Button>
            <Button onClick={createAccount} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("dialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pickerToken && (
        <MetaOAuthPicker
          token={pickerToken}
          onDone={() => {
            load()
            router.replace("/traffic/accounts", { scroll: false })
          }}
        />
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>{t("deleteDialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>{t("dialog.cancel")}</Button>
            <Button variant="destructive" onClick={deleteAccount}>{t("deleteDialog.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
