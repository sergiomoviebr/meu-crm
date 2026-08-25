"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Copy, Loader2, Pencil, Send, XCircle, CheckCircle2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatDistanceToNow } from "date-fns"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Contact, ContentPost, ContentPostStatus } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const STATUSES: ContentPostStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "published",
  "failed",
  "cancelled",
]

const STATUS_VARIANT: Record<ContentPostStatus, "default" | "outline" | "destructive" | "secondary"> = {
  draft: "outline",
  pending_approval: "secondary",
  approved: "secondary",
  scheduled: "default",
  publishing: "default",
  published: "default",
  failed: "destructive",
  cancelled: "outline",
}

type PostWithContact = ContentPost & { contact: Pick<Contact, "id" | "name" | "phone"> | null }

export default function ContentPostsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const status = (searchParams.get("status") as ContentPostStatus) || "draft"
  const canManage = useCan("manage-content")
  const canApprove = useCan("approve-content")
  const locale = useLocale()
  const t = useTranslations("Content.posts")

  const [posts, setPosts] = useState<PostWithContact[] | null>(null)

  async function load() {
    const { data, error } = await createClient()
      .from("content_posts")
      .select("*, contact:contacts(id, name, phone)")
      .eq("status", status)
      .order("updated_at", { ascending: false })
    if (error) {
      toast.error(error.message)
      return
    }
    setPosts((data ?? []) as PostWithContact[])
  }

  useEffect(() => {
    setPosts(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function callAction(id: string, action: string, successMsg: string) {
    const res = await fetch(`/api/content/posts/${id}/${action}`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.actionFailed"))
      return
    }
    toast.success(successMsg)
    load()
  }

  async function duplicate(id: string) {
    const res = await fetch(`/api/content/posts/${id}/duplicate`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.actionFailed"))
      return
    }
    toast.success(t("toasts.duplicated"))
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <GatedButton canAct={canManage} gateReason={t("gateReason")} onClick={() => router.push("/content/new")}>
          {t("new")}
        </GatedButton>
      </div>

      <Tabs value={status} onValueChange={(v) => router.push(`/content/posts?status=${v}`)}>
        <TabsList>
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`status.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {posts === null ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.client")}</TableHead>
              <TableHead>{t("columns.caption")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.updated")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.map((post) => (
              <TableRow key={post.id}>
                <TableCell>{post.contact?.name ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{post.caption || t("noCaption")}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[post.status]}>{t(`status.${post.status}`)}</Badge>
                  {post.error_message && (
                    <p className="mt-1 max-w-xs truncate text-xs text-destructive">{post.error_message}</p>
                  )}
                </TableCell>
                <TableCell>
                  {formatDistanceToNow(new Date(post.updated_at), { addSuffix: true, locale: getDateFnsLocale(locale) })}
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  {post.status === "pending_approval" && (
                    <GatedButton
                      canAct={canApprove}
                      gateReason={t("gateReason")}
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => callAction(post.id, "approve", t("toasts.approved"))}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </GatedButton>
                  )}
                  {["draft", "pending_approval", "approved"].includes(post.status) && (
                    <GatedButton
                      canAct={canManage}
                      gateReason={t("gateReason")}
                      variant="ghost"
                      size="icon-sm"
                      title={t("actions.publishNow")}
                      onClick={() => callAction(post.id, "publish-now", t("toasts.publishing"))}
                    >
                      <Send className="h-4 w-4" />
                    </GatedButton>
                  )}
                  {["draft", "pending_approval", "approved", "scheduled"].includes(post.status) && (
                    <Link href={`/content/${post.id}/edit`}>
                      <Button variant="ghost" size="icon-sm">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                  <GatedButton
                    canAct={canManage}
                    gateReason={t("gateReason")}
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => duplicate(post.id)}
                  >
                    <Copy className="h-4 w-4" />
                  </GatedButton>
                  {["draft", "pending_approval", "approved", "scheduled"].includes(post.status) && (
                    <GatedButton
                      canAct={canManage}
                      gateReason={t("gateReason")}
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => callAction(post.id, "cancel", t("toasts.cancelled"))}
                    >
                      <XCircle className="h-4 w-4" />
                    </GatedButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
