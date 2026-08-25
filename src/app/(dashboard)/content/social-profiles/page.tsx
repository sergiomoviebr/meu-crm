"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Camera, Users, Briefcase, Plus, Trash2, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { Contact, SocialPlatform, SocialProfile } from "@/types"
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

const PLATFORM_META: Record<SocialPlatform, { icon: typeof Camera; label: string }> = {
  instagram: { icon: Camera, label: "Instagram" },
  facebook: { icon: Users, label: "Facebook" },
  linkedin: { icon: Briefcase, label: "LinkedIn" },
}

type ProfileWithContact = SocialProfile & { contact: Pick<Contact, "id" | "name" | "phone"> | null }

export default function SocialProfilesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = searchParams.get("view") === "contact" ? "contact" : "platform"
  const canManage = useCan("manage-content")
  const t = useTranslations("Content.socialProfiles")

  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([])
  const [profiles, setProfiles] = useState<ProfileWithContact[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ProfileWithContact | null>(null)

  const [contactId, setContactId] = useState("")
  const [platform, setPlatform] = useState<SocialPlatform>("instagram")
  const [handle, setHandle] = useState("")
  const [displayName, setDisplayName] = useState("")

  async function load() {
    const supabase = createClient()
    const [{ data: contactRows }, { data: profileRows, error }] = await Promise.all([
      supabase.from("contacts").select("id, name, phone").order("name", { ascending: true }),
      supabase
        .from("social_profiles")
        .select("*, contact:contacts(id, name, phone)")
        .order("created_at", { ascending: false }),
    ])
    setContacts((contactRows ?? []) as Pick<Contact, "id" | "name" | "phone">[])
    if (error) {
      toast.error(error.message)
      return
    }
    setProfiles((profileRows ?? []) as ProfileWithContact[])
  }

  useEffect(() => {
    load()
  }, [])

  // Land back here after the Meta OAuth redirect (start -> Meta's
  // consent screen -> callback -> here). `meta_oauth` carries the
  // outcome; `meta_oauth_picker` means the callback found more than
  // one Page/IG account and needs the user to choose (handled by
  // <MetaOAuthPicker> below, which then reloads).
  const oauthResult = searchParams.get("meta_oauth")
  const pickerToken = searchParams.get("meta_oauth_picker")
  useEffect(() => {
    if (!oauthResult) return
    if (oauthResult === "connected") toast.success(t("toasts.oauthConnected"))
    else if (oauthResult === "no_pages") toast.error(t("toasts.oauthNoPages"))
    else if (oauthResult === "denied") toast.error(t("toasts.oauthDenied"))
    else toast.error(t("toasts.oauthError"))
    load()
    router.replace("/content/social-profiles?view=contact", { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthResult])

  const grouped = useMemo(() => {
    const rows = profiles ?? []
    const key = view === "contact" ? (p: ProfileWithContact) => p.contact?.name ?? t("unknownClient") : (p: ProfileWithContact) => PLATFORM_META[p.platform].label
    const groups = new Map<string, ProfileWithContact[]>()
    for (const row of rows) {
      const k = key(row)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(row)
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [profiles, view, t])

  async function createProfile() {
    if (!contactId || !handle.trim()) {
      toast.error(t("toasts.missingFields"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/content/social-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contact_id: contactId,
          platform,
          handle: handle.trim(),
          display_name: displayName.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("toasts.createError"))
        return
      }
      toast.success(t("toasts.created"))
      setCreateOpen(false)
      setContactId("")
      setHandle("")
      setDisplayName("")
      load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteProfile() {
    if (!pendingDelete) return
    const res = await fetch(`/api/content/social-profiles/${pendingDelete.id}`, { method: "DELETE" })
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

      <div className="flex gap-2">
        <Button
          variant={view === "platform" ? "default" : "outline"}
          size="sm"
          onClick={() => router.push("/content/social-profiles?view=platform")}
        >
          {t("groupByPlatform")}
        </Button>
        <Button
          variant={view === "contact" ? "default" : "outline"}
          size="sm"
          onClick={() => router.push("/content/social-profiles?view=contact")}
        >
          {t("groupByClient")}
        </Button>
      </div>

      {profiles === null ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : profiles.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        grouped.map(([groupName, rows]) => (
          <div key={groupName} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">{groupName}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.client")}</TableHead>
                  <TableHead>{t("columns.platform")}</TableHead>
                  <TableHead>{t("columns.handle")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((profile) => {
                  const meta = PLATFORM_META[profile.platform]
                  const Icon = meta.icon
                  return (
                    <TableRow key={profile.id}>
                      <TableCell>{profile.contact?.name ?? t("unknownClient")}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="h-4 w-4" /> {meta.label}
                        </span>
                      </TableCell>
                      <TableCell>{profile.handle}</TableCell>
                      <TableCell>
                        <Badge variant={profile.connection_status === "connected" ? "default" : "outline"}>
                          {t(`connectionStatus.${profile.connection_status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <GatedButton
                          canAct={canManage}
                          gateReason={t("gateReason")}
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setPendingDelete(profile)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </GatedButton>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ))
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
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("dialog.clientPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.platform")}</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as SocialPlatform)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{PLATFORM_META[platform].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PLATFORM_META) as SocialPlatform[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(platform === "instagram" || platform === "facebook") && (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <GatedButton
                  canAct={canManage && !!contactId}
                  gateReason={t("gateReason")}
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    window.location.href = `/api/meta-oauth/start?product=${platform}&contact_id=${contactId}`
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
              <Label>{t("dialog.handle")}</Label>
              <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@clinicaexemplo" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.displayName")}</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("dialog.cancel")}
            </Button>
            <Button onClick={createProfile} disabled={saving}>
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
            router.replace("/content/social-profiles?view=contact", { scroll: false })
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
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t("dialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={deleteProfile}>
              {t("deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
