"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Plus, Loader2, Trash2, ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { Contact, LandingPage } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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

type LandingPageWithContact = LandingPage & { contact: Pick<Contact, "id" | "name"> | null }

export default function TrafficLandingPagesPage() {
  const canManage = useCan("manage-traffic")
  const t = useTranslations("Traffic.landingPages")

  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([])
  const [pages, setPages] = useState<LandingPageWithContact[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<LandingPageWithContact | null>(null)

  const [contactId, setContactId] = useState("")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [notes, setNotes] = useState("")

  async function load() {
    const supabase = createClient()
    const [{ data: contactRows }, { data: pageRows, error }] = await Promise.all([
      supabase.from("contacts").select("id, name, phone").order("name", { ascending: true }),
      supabase.from("landing_pages").select("*, contact:contacts(id, name)").order("created_at", { ascending: false }),
    ])
    setContacts((contactRows ?? []) as Pick<Contact, "id" | "name" | "phone">[])
    if (error) {
      toast.error(error.message)
      return
    }
    setPages((pageRows ?? []) as LandingPageWithContact[])
  }

  useEffect(() => {
    load()
  }, [])

  async function createPage() {
    if (!contactId || !name.trim() || !url.trim()) {
      toast.error(t("toasts.missingFields"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/traffic/landing-pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, name: name.trim(), url: url.trim(), notes: notes || undefined }),
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
      setUrl("")
      setNotes("")
      load()
    } finally {
      setSaving(false)
    }
  }

  async function deletePage() {
    if (!pendingDelete) return
    const res = await fetch(`/api/traffic/landing-pages/${pendingDelete.id}`, { method: "DELETE" })
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

      {pages === null ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : pages.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.client")}</TableHead>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.url")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((page) => (
              <TableRow key={page.id}>
                <TableCell>{page.contact?.name ?? "—"}</TableCell>
                <TableCell>{page.name}</TableCell>
                <TableCell>
                  <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    {page.url} <ExternalLink className="h-3 w-3" />
                  </a>
                </TableCell>
                <TableCell className="text-right">
                  <GatedButton canAct={canManage} gateReason={t("gateReason")} variant="ghost" size="icon-sm" onClick={() => setPendingDelete(page)}>
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
                  {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.phone}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.url")}</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.notes")}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("dialog.cancel")}</Button>
            <Button onClick={createPage} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("dialog.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>{t("deleteDialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>{t("dialog.cancel")}</Button>
            <Button variant="destructive" onClick={deletePage}>{t("deleteDialog.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
