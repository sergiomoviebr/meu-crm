"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface Candidate {
  id: string
  name: string
}

/**
 * Shown after the Meta OAuth callback found MORE THAN ONE page/ad
 * account under the connected login — GET /api/meta-oauth/picker
 * decodes the signed blob from the callback's redirect and returns
 * only id/name (never the access tokens); picking one POSTs to
 * /api/meta-oauth/finalize, which does the actual save. Shared
 * between the Content (Instagram/Facebook) and Traffic (Meta Ads)
 * settings pages — same shape either way.
 */
export function MetaOAuthPicker({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useTranslations("MetaOAuth.picker")
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/meta-oauth/picker?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data?.error) {
          toast.error(data.error)
          onDone()
          return
        }
        setCandidates(data.candidates ?? [])
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t("loadFailed"))
          onDone()
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function pick(id: string) {
    setSelecting(id)
    try {
      const res = await fetch("/api/meta-oauth/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, selectedId: id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? t("finalizeFailed"))
        return
      }
      toast.success(t("connected"))
      onDone()
    } finally {
      setSelecting(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {candidates === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                className="w-full justify-start"
                disabled={!!selecting}
                onClick={() => pick(c.id)}
              >
                {selecting === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : c.name}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
