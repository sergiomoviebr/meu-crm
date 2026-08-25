"use client"

import { useSearchParams } from "next/navigation"
import { PostForm } from "@/components/content/post-form"

export default function NewContentPostPage() {
  const searchParams = useSearchParams()
  const initialContactId = searchParams.get("contact_id") ?? undefined
  const initialIdeaId = searchParams.get("idea_id") ?? undefined
  return <PostForm initialContactId={initialContactId} initialIdeaId={initialIdeaId} />
}
