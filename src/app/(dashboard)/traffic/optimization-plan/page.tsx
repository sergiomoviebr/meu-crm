"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { Contact, OptimizationTaskStatus, TrafficOptimizationTask } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type TaskWithContact = TrafficOptimizationTask & { contact: Pick<Contact, "id" | "name"> | null }

const STATUSES: OptimizationTaskStatus[] = ["todo", "in_progress", "done", "cancelled"]

const PRIORITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
}

export default function OptimizationPlanPage() {
  const canManage = useCan("manage-traffic")
  const t = useTranslations("Traffic.optimizationPlan")

  const [tasks, setTasks] = useState<TaskWithContact[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const { data, error } = await createClient()
      .from("traffic_optimization_tasks")
      .select("*, contact:contacts(id, name)")
      .order("created_at", { ascending: false })
    if (error) {
      toast.error(error.message)
      return
    }
    setTasks((data ?? []) as TaskWithContact[])
  }

  useEffect(() => {
    load()
  }, [])

  async function changeStatus(task: TaskWithContact, status: OptimizationTaskStatus) {
    setBusyId(task.id)
    try {
      const res = await fetch(`/api/traffic/optimization-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? t("toasts.updateError"))
        return
      }
      load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {tasks === null ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {STATUSES.map((status) => (
            <div key={status} className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">{t(`status.${status}`)} ({tasks.filter((tk) => tk.status === status).length})</h2>
              <div className="space-y-2">
                {tasks.filter((task) => task.status === status).map((task) => (
                  <Card key={task.id}>
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={PRIORITY_VARIANT[task.priority]}>{t(`priority.${task.priority}`)}</Badge>
                        {task.due_date && <span className="text-xs text-muted-foreground">{task.due_date}</span>}
                      </div>
                      <p className="text-sm text-foreground">{task.title}</p>
                      <p className="text-xs text-muted-foreground">{task.contact?.name ?? "—"}</p>
                      {task.notes && <p className="text-xs text-muted-foreground">{task.notes}</p>}
                      <Select
                        value={task.status}
                        onValueChange={(v) => v && changeStatus(task, v as OptimizationTaskStatus)}
                      >
                        <SelectTrigger className="w-full" disabled={!canManage || busyId === task.id}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
