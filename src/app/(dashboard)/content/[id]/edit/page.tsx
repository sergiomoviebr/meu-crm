"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { PostForm } from "@/components/content/post-form"
import type { ContentPost } from "@/types"

export default function EditContentPostPage() {
  const params = useParams<{ id: string }>()
  const [post, setPost] = useState<
    (Omit<ContentPost, "targets"> & { targets?: { social_profile_id: string }[] }) | null | undefined
  >(undefined)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("content_posts").select("*").eq("id", params.id).maybeSingle(),
      supabase.from("content_post_targets").select("social_profile_id").eq("post_id", params.id),
    ]).then(([postRes, targetsRes]) => {
      if (!postRes.data) {
        setPost(null)
        return
      }
      setPost({ ...(postRes.data as ContentPost), targets: targetsRes.data ?? [] })
    })
  }, [params.id])

  if (post === undefined) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (post === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Not found.</p>
  }
  return <PostForm post={post} />
}
