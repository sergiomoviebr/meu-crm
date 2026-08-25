"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { cn } from "@/lib/utils"
import type { Contact, ContentPost, ContentPostStatus } from "@/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type PostWithContact = ContentPost & { contact: Pick<Contact, "id" | "name" | "phone"> | null }
type CalendarView = "month" | "week" | "day"

const STATUS_DOT: Record<ContentPostStatus, string> = {
  draft: "bg-muted-foreground",
  pending_approval: "bg-amber-500",
  approved: "bg-sky-500",
  scheduled: "bg-primary",
  publishing: "bg-primary",
  published: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
}

function postDate(post: ContentPost): Date | null {
  const raw = post.scheduled_at ?? post.published_at
  return raw ? new Date(raw) : null
}

export default function ContentCalendarPage() {
  const t = useTranslations("Content.calendar")
  const locale = getDateFnsLocale(useLocale())

  const [view, setView] = useState<CalendarView>("month")
  const [cursor, setCursor] = useState(new Date())
  const [posts, setPosts] = useState<PostWithContact[] | null>(null)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  useEffect(() => {
    createClient()
      .from("content_posts")
      .select("*, contact:contacts(id, name, phone)")
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message)
          return
        }
        setPosts((data ?? []) as PostWithContact[])
      })
  }, [])

  const range = useMemo(() => {
    if (view === "day") return { start: cursor, end: cursor }
    if (view === "week") return { start: startOfWeek(cursor, { locale }), end: endOfWeek(cursor, { locale }) }
    const monthStart = startOfMonth(cursor)
    const monthEnd = endOfMonth(cursor)
    return { start: startOfWeek(monthStart, { locale }), end: endOfWeek(monthEnd, { locale }) }
  }, [view, cursor, locale])

  const days = useMemo(() => eachDayOfInterval(range), [range])

  function postsOn(day: Date) {
    return (posts ?? []).filter((p) => {
      const d = postDate(p)
      return d ? isSameDay(d, day) : false
    })
  }

  function navigate(direction: -1 | 1) {
    if (view === "day") setCursor((c) => (direction === 1 ? addDays(c, 1) : subDays(c, 1)))
    else if (view === "week") setCursor((c) => (direction === 1 ? addWeeks(c, 1) : subWeeks(c, 1)))
    else setCursor((c) => (direction === 1 ? addMonths(c, 1) : subMonths(c, 1)))
  }

  const selectedDayPosts = selectedDay ? postsOn(selectedDay) : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/content/new">
          <Button>{t("newPost")}</Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground">
            {view === "month" ? format(cursor, "MMMM yyyy", { locale }) : format(cursor, "PPP", { locale })}
          </span>
          <Button variant="outline" size="icon-sm" onClick={() => navigate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>
            {t("today")}
          </Button>
        </div>
        <div className="flex gap-1">
          {(["day", "week", "month"] as CalendarView[]).map((v) => (
            <Button key={v} variant={view === v ? "default" : "outline"} size="sm" onClick={() => setView(v)}>
              {t(`views.${v}`)}
            </Button>
          ))}
        </div>
      </div>

      {posts === null ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg pb-1">
        <div
          className={cn(
            "grid min-w-[720px] gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border",
            view === "day" ? "grid-cols-1" : "grid-cols-7",
          )}
        >
          {view !== "day" &&
            days.slice(0, 7).map((d) => (
              <div key={d.toISOString()} className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
                {format(d, "EEE", { locale })}
              </div>
            ))}
          {days.map((day) => {
            const dayPosts = postsOn(day)
            const visible = dayPosts.slice(0, 3)
            const overflow = dayPosts.length - visible.length
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "min-h-24 bg-card p-1.5 text-left align-top transition-colors hover:bg-muted/50",
                  view !== "day" && !isSameMonth(day, cursor) && view === "month" && "bg-muted/30 text-muted-foreground",
                )}
              >
                <span className="text-xs font-medium">{format(day, view === "day" ? "PPPP" : "d", { locale })}</span>
                <div className="mt-1 space-y-1">
                  {visible.map((p) => (
                    <div key={p.id} className="flex items-center gap-1 truncate text-xs">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[p.status])} />
                      <span className="truncate">{p.contact?.name ?? p.caption ?? t("untitled")}</span>
                    </div>
                  ))}
                  {overflow > 0 && (
                    <span className="text-xs text-muted-foreground">{t("moreCount", { count: overflow })}</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        </div>
      )}

      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedDay ? format(selectedDay, "PPPP", { locale }) : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {selectedDayPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPostsThisDay")}</p>
            ) : (
              selectedDayPosts.map((p) => (
                <Link
                  key={p.id}
                  href={`/content/${p.id}/edit`}
                  className="flex items-center justify-between rounded-lg border border-border p-2 text-sm hover:bg-muted/50"
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[p.status])} />
                    {p.contact?.name ?? t("untitled")}
                  </span>
                  <Badge variant="outline">{t(`status.${p.status}`)}</Badge>
                </Link>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
