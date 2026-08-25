"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Camera, Users, Briefcase, Loader2, X } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { uploadAccountMedia, MEDIA_MAX_BYTES_BY_KIND } from "@/lib/storage/upload-media"
import type { Contact, ContentMediaItem, ContentPost, PostContentType, SocialPlatform, SocialProfile } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PLATFORM_META: Record<SocialPlatform, { icon: typeof Camera; label: string }> = {
  instagram: { icon: Camera, label: "Instagram" },
  facebook: { icon: Users, label: "Facebook" },
  linkedin: { icon: Briefcase, label: "LinkedIn" },
}

const CONTENT_TYPES: PostContentType[] = ["image", "video", "carousel", "text", "story", "reel"]

interface PostFormProps {
  /** When set, the form edits this existing post instead of creating one. */
  post?: Omit<ContentPost, "targets"> & { targets?: { social_profile_id: string }[] }
  /** Pre-selects the client picker — used by the "Criar novo criativo"
   *  deep link from a Traffic & Performance recommendation
   *  (/content/new?contact_id=...). Ignored in edit mode, where the
   *  post's own contact_id already wins. */
  initialContactId?: string
  /** Loads an Inbox idea into the editor when the user chooses
   *  "Criar conteúdo" from the idea workflow. */
  initialIdeaId?: string
}

export function PostForm({ post, initialContactId, initialIdeaId }: PostFormProps) {
  const router = useRouter()
  const t = useTranslations("Content.form")

  const [contacts, setContacts] = useState<Pick<Contact, "id" | "name" | "phone">[]>([])
  const [profiles, setProfiles] = useState<SocialProfile[]>([])

  const [contactId, setContactId] = useState(post?.contact_id ?? initialContactId ?? "")
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>(
    post?.targets?.map((tgt) => tgt.social_profile_id) ?? [],
  )
  const [contentType, setContentType] = useState<PostContentType>(post?.content_type ?? "image")
  const [caption, setCaption] = useState(post?.caption ?? "")
  const [hashtagsInput, setHashtagsInput] = useState((post?.hashtags ?? []).join(" "))
  const [linkUrl, setLinkUrl] = useState(post?.link_url ?? "")
  const [cta, setCta] = useState(post?.cta ?? "")
  const [media, setMedia] = useState<ContentMediaItem[]>(post?.media ?? [])
  const [scheduledAt, setScheduledAt] = useState("")
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    createClient()
      .from("contacts")
      .select("id, name, phone")
      .order("name", { ascending: true })
      .then(({ data }) => setContacts((data ?? []) as Pick<Contact, "id" | "name" | "phone">[]))
  }, [])

  useEffect(() => {
    if (!initialIdeaId || post) return
    createClient()
      .from("content_ideas")
      .select("body, contact_id")
      .eq("id", initialIdeaId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setCaption((current) => current || data.body)
        if (!initialContactId && data.contact_id) setContactId(data.contact_id)
      })
  }, [initialIdeaId, initialContactId, post])

  useEffect(() => {
    if (!contactId) {
      setProfiles([])
      return
    }
    createClient()
      .from("social_profiles")
      .select("*")
      .eq("contact_id", contactId)
      .then(({ data }) => setProfiles((data ?? []) as SocialProfile[]))
  }, [contactId])

  const hashtags = useMemo(
    () =>
      hashtagsInput
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter(Boolean)
        .map((h) => (h.startsWith("#") ? h : `#${h}`)),
    [hashtagsInput],
  )

  function toggleProfile(id: string) {
    setSelectedProfileIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image"
        const cap = MEDIA_MAX_BYTES_BY_KIND[kind]
        if (file.size > cap) {
          toast.error(t("errors.fileTooLarge", { name: file.name }))
          continue
        }
        const { publicUrl, path } = await uploadAccountMedia("content-media", file)
        setMedia((prev) => [...prev, { url: publicUrl, path, kind, position: prev.length }])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errors.uploadFailed"))
    } finally {
      setUploading(false)
    }
  }

  function removeMedia(path: string) {
    setMedia((prev) => prev.filter((m) => m.path !== path))
  }

  function payload() {
    return {
      contact_id: contactId,
      content_type: contentType,
      caption,
      hashtags,
      media,
      link_url: linkUrl || null,
      cta: cta || null,
      social_profile_ids: selectedProfileIds,
    }
  }

  async function savePost(): Promise<string | null> {
    if (!contactId) {
      toast.error(t("errors.missingClient"))
      return null
    }
    if (selectedProfileIds.length === 0) {
      toast.error(t("errors.missingProfiles"))
      return null
    }
    if (post) {
      const res = await fetch(`/api/content/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload()),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("errors.saveFailed"))
        return null
      }
      return post.id
    }
    const res = await fetch("/api/content/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body?.error ?? t("errors.saveFailed"))
      return null
    }
    return body.post.id as string
  }

  async function handleAction(action: "draft" | "submit" | "schedule" | "publish_now") {
    if (action === "schedule" && !scheduledAt) {
      toast.error(t("errors.missingSchedule"))
      return
    }
    setSaving(action)
    try {
      const id = await savePost()
      if (!id) return

      if (action === "draft") {
        toast.success(t("toasts.savedDraft"))
        router.push("/content/posts?status=draft")
        return
      }
      if (action === "submit") {
        const res = await fetch(`/api/content/posts/${id}/submit`, { method: "POST" })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body?.error ?? t("errors.actionFailed"))
          return
        }
        toast.success(t("toasts.submitted"))
        router.push("/content/posts?status=pending_approval")
        return
      }
      if (action === "schedule") {
        const res = await fetch(`/api/content/posts/${id}/schedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduled_at: new Date(scheduledAt).toISOString() }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body?.error ?? t("errors.actionFailed"))
          return
        }
        toast.success(t("toasts.scheduled"))
        router.push("/content/posts?status=scheduled")
        return
      }
      if (action === "publish_now") {
        const res = await fetch(`/api/content/posts/${id}/publish-now`, { method: "POST" })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body?.error ?? t("errors.actionFailed"))
          return
        }
        toast.success(t("toasts.publishing"))
        router.push("/content/posts?status=scheduled")
      }
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <h1 className="text-2xl font-bold text-foreground">{post ? t("editTitle") : t("createTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <p className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Rascunho · alterações salvas ao confirmar</p>
      </div>

      <Card className="shadow-none">
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-1.5 lg:col-span-2">
            <div className="mb-3"><p className="text-xs font-bold uppercase tracking-wider text-primary">1. Contexto</p><h2 className="mt-1 font-semibold">Para quem e onde será publicado?</h2></div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("client")}</Label>
            <Select value={contactId} onValueChange={(v) => { setContactId(v ?? ""); setSelectedProfileIds([]) }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("clientPlaceholder")} />
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

          {contactId && (
            <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
              <Label>{t("targetProfiles")}</Label>
              {profiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noProfiles")}</p>
              ) : (
                <div className="space-y-2">
                  {profiles.map((p) => {
                    const meta = PLATFORM_META[p.platform]
                    const Icon = meta.icon
                    return (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedProfileIds.includes(p.id)}
                          onCheckedChange={() => toggleProfile(p.id)}
                        />
                        <Icon className="h-4 w-4" />
                        {meta.label} — {p.handle}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("contentType")}</Label>
            <Select value={contentType} onValueChange={(v) => setContentType(v as PostContentType)}>
              <SelectTrigger className="w-full">
                <SelectValue>{t(`contentTypes.${contentType}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`contentTypes.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <div className="mb-3 mt-2 border-t pt-5"><p className="text-xs font-bold uppercase tracking-wider text-primary">2. Conteúdo</p><h2 className="mt-1 font-semibold">Desenvolva a mensagem principal</h2></div>
            <Label>{t("caption")}</Label>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={8} className="resize-y text-base leading-6" placeholder="Escreva a legenda, roteiro ou texto principal..." />
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <Label>{t("hashtags")}</Label>
            <Input value={hashtagsInput} onChange={(e) => setHashtagsInput(e.target.value)} placeholder="#promo #novidade" />
            {hashtags.length > 0 && <p className="text-xs text-muted-foreground">{hashtags.join(" ")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t("media")}</Label>
            <Input type="file" accept="image/*,video/*" multiple onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
            {media.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {media.map((m) => (
                  <div key={m.path} className="relative">
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" className="h-16 w-16 rounded-md object-cover ring-1 ring-border" />
                    ) : (
                      <video src={m.url} className="h-16 w-16 rounded-md object-cover ring-1 ring-border" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMedia(m.path)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t("linkUrl")}</Label>
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" />
          </div>

          <div className="space-y-1.5">
            <Label>{t("cta")}</Label>
            <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder={t("ctaPlaceholder")} />
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <div className="mb-3 mt-2 border-t pt-5"><p className="text-xs font-bold uppercase tracking-wider text-primary">3. Publicação</p><h2 className="mt-1 font-semibold">Defina quando este conteúdo deve ir ao ar</h2></div>
            <Label>{t("scheduleAt")}</Label>
            <Input className="max-w-sm" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <p className="hidden text-xs text-muted-foreground sm:block">Escolha uma ação para salvar este conteúdo.</p>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
        <Button onClick={() => handleAction("draft")} disabled={!!saving}>
          {saving === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("actions.saveDraft")}
        </Button>
        <Button variant="outline" onClick={() => handleAction("submit")} disabled={!!saving}>
          {saving === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("actions.submitForApproval")}
        </Button>
        <Button variant="outline" onClick={() => handleAction("schedule")} disabled={!!saving}>
          {saving === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("actions.schedule")}
        </Button>
        <Button variant="outline" onClick={() => handleAction("publish_now")} disabled={!!saving}>
          {saving === "publish_now" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("actions.publishNow")}
        </Button>
        </div>
      </div>
    </div>
  )
}
