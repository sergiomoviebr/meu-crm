import { ContentWorkspaceNav } from '@/components/content/content-workspace-nav'

export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <ContentWorkspaceNav />
      <div className="pt-6">{children}</div>
    </div>
  )
}
